import { checkByBackTranslation, type ChromeTranslatorBridge } from './chromeBuiltin';
import { functionWords } from '../core/detectLanguage';
import { restoreInline, type InnerTag } from './plainText';
import type { SegmentRequest, SegmentResult, TranslationEngine } from './types';

/**
 * Single-word identifiers ("permutation_importance", "RQ3", URLs), short inline formulas ("κ")
 * and glossary terms travel as text: Google reads a no-translate span as a sentence break ("Biz
 * bunu kullanıyoruz. permutation_importance …"). Frozen numbers (⟦D⟧) too: as spans they cut
 * the retried sentence ("…katsayısı κ = 0,81 olarak hesaplanmıştır" → "…coefficient was
 * calculated. = 0,81 was calculated."); a number the engine changes again fails the restore, and
 * the retry with spans follows.
 */
const SHORT_FORMULA = /^(?=.{3,24}$)(?:[^\p{L}\s]|(?<!\p{L})\p{L}(?!\p{L})|\s)+$/u;

function inlineIdentifiers(
  req: SegmentRequest,
  asSpans: ReadonlySet<string> = new Set(),
): { text: string; inlined: InnerTag[] } {
  const inlined: InnerTag[] = [];
  const text = req.text.replace(/⟦([A-Z]\d+)⟧/g, (ph, id: string) => {
    const v = req.verbatim?.[id];
    // A short formula of signs, digits and one-letter names ("p < 0.01") too: as a span its
    // number is hidden, and Google writes the usual one ("p<0,05").
    const plain = /^\S+$/u.test(v ?? '') || (id.startsWith('F') && SHORT_FORMULA.test(v ?? ''));
    if (!v || !plain || asSpans.has(id)) return ph;
    inlined.push({ id, text: v });
    return v;
  });
  return { text, inlined };
}

/**
 * Month names a target capitalises after a day ("29 Mart", "3 January") and units after a
 * number ("50 Hz"): no new piece.
 */
const MONTH =
  /^(?:Hz|Pa|Gy|Bq|Da|Wb|Sv|Wh|Ma|Ga|Mb|Gb|Kb|Tb)$|^(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|Juni|Juli|Oktober|Dezember)/u;

/**
 * Text Google translated piece by piece around no-translate spans: the pieces open with a capital
 * mid-sentence ("eğer ⟦D7⟧Üçüncü", "⟦U5⟧Ve ⟦U6⟧standart"), or a sentence ends before a number the
 * source has inside one ("Foram analisados 22 estudos" → "analiz edildi. 22 Çoğunluğu") — word
 * salad that keeps every number.
 */
export function piecewise(sent: string, received: string): boolean {
  const SPAN = String.raw`⟦[A-Z]\d+⟧\s*(?:<\/?t\d+>\s*)*`;
  // A name the source writes too ("⟦U1⟧ Gaia", "⟦F2⟧ Kepler") is no piece of a translation.
  const named = new Set(sent.match(/\p{Lu}\p{Ll}+/gu) ?? []);
  const count = (t: string, re: RegExp) =>
    [...t.matchAll(re)].filter((m) => !MONTH.test(m[1]!) && !named.has(m[1]!)).length;
  const inside = new RegExp(String.raw`(?<![.!?:]\s*)${SPAN}(\p{Lu}\p{Ll}+)`, 'gu');
  const after = new RegExp(String.raw`[.!?:]\s*${SPAN}(\p{Lu}\p{Ll}+)`, 'gu');
  const n = count(received, inside);
  return (n >= 2 && n > count(sent, inside)) || count(received, after) > count(sent, after);
}

/**
 * A frozen number sent as a span in running text, where Google may move it out of its sentence;
 * one in brackets ("(entretien, 08/04/22)") or a note stays where it was.
 */
function heldInProse(req: SegmentRequest, sent: string): boolean {
  if (req.role === 'footnote') return false;
  return [...sent.matchAll(/⟦D\d+⟧/gu)].some((m) => {
    const before = sent.slice(0, m.index);
    const depth = (o: string, c: string) => before.split(o).length - before.split(c).length;
    return depth('(', ')') <= 0 && depth('[', ']') <= 0;
  });
}

/**
 * Google writes an inlined number in the target's style ("standard deviation of 0.01" →
 * "standart sapma 0,01"): written either way, it is found, and the source's spelling comes back.
 */
export function relocalize(t: string, inlined: InnerTag[]): string {
  let out = t;
  const wanted = new Map<string, number>();
  const free = (n: string) => new RegExp(`(?<![\\d.,])${escapeRe(n)}(?![\\d])`, 'gu');
  for (const { text } of inlined) {
    // A number, or a short formula with one ("p < 0.01" → "p < 0,01").
    if (!/(?:\d|^)[.,]\d/u.test(text)) continue;
    wanted.set(text, (wanted.get(text) ?? 0) + 1);
    const swapped = text.replace(/(?<=\d|^)[.,](?=\d)/gu, (c) => (c === '.' ? ',' : '.'));
    if ((out.match(free(text)) ?? []).length >= wanted.get(text)!) continue;
    // ".05" also comes back with its zero ("0,05").
    const forms = /^[.,]/u.test(text) ? [swapped, `0${text}`, `0${swapped}`] : [swapped];
    const form = forms.find((f) => free(f).test(out));
    if (form) out = out.replace(new RegExp(free(form).source, 'u'), text);
  }
  return out;
}

/** The inlined identifiers missing from a translation, taken in source order like restoreInline. */
function lostInline(t: string, inlined: InnerTag[]): Set<string> {
  const kept: InnerTag[] = [];
  const lost = new Set<string>();
  for (const it of inlined) {
    if (restoreInline(t, [...kept, it]) === null) lost.add(it.id);
    else kept.push(it);
  }
  return lost;
}

const untagged = (t: string) => t.replace(/<\/?t\d+>/g, '');

/**
 * A heading's section number stays in front: Google moved it into the sentence ("7 THREATS TO
 * VALIDITY" → "GEÇERLİLİĞE YÖNELİK 7 TEHDİT"). So does a research question's label, inside its
 * run-in heading's tag or not ("RQ1: How accurate …" → "RQ1Kötü amaçlı …"). The number or label
 * is set aside and put back, after the tag it opened.
 */
function pinSectionNumber(req: SegmentRequest): {
  req: SegmentRequest;
  number: string;
  tag: string;
} {
  // A note's own number too ("3 Vœux n°18.2003.150" → "318.2003.150 sayılı Karar").
  const m =
    req.role === 'heading'
      ? /^\s*(?:\d{1,2}(?:\.\d{1,2})*|⟦D\d+⟧)\.?\s+(?=\S)/u.exec(req.text)
      : req.role === 'footnote'
        ? /^\s*\d{1,3}\s+(?=\p{L})/u.exec(req.text)
        : null;
  if (m) return { req: { ...req, text: req.text.slice(m[0].length) }, number: m[0], tag: '' };
  // The label may be an identifier set aside as a whole ("⟦U1⟧: How accurate …").
  const label =
    /^(\s*(?:<t\d+>)?)((?:(?:RQ|H|Q)(?:\d{1,2}|⟦D\d+⟧)|⟦U(\d+)⟧)[a-z]?\s*:\s*)(?=\S)/u.exec(
      req.text,
    );
  const isLabel =
    !!label &&
    (!label[3] || /^(?:RQ|H|Q)\d{1,2}[a-z]?$/u.test(req.verbatim?.[`U${label[3]}`] ?? ''));
  return label && isLabel
    ? {
        req: { ...req, text: label[1]! + req.text.slice(label[0].length) },
        number: label[2]!,
        tag: label[1]!.trim(),
      }
    : { req, number: '', tag: '' };
}

/** The pinned number or label back in front of the translation, inside its tag. */
function unpin(text: string, { number, tag }: { number: string; tag: string }): string {
  if (!number) return text;
  return tag && text.startsWith(tag) ? tag + number + text.slice(tag.length) : number + text;
}

/**
 * Google drops the spaces around placeholders it must not translate ("Yaklaşım⟦U1⟧Paketler").
 * A space is put back on each side where the source had one and the translation glued the
 * placeholder to a word; Turkish suffixes after an apostrophe ("⟦U1⟧'de") and punctuation stay.
 */
export function respacePlaceholders(source: string, target: string): string {
  let out = target;
  for (const [ph] of source.matchAll(/⟦[A-Z]\d+⟧/g)) {
    const src = untagged(source);
    const i = src.indexOf(ph);
    const tgt = untagged(out);
    const j = tgt.indexOf(ph);
    if (j < 0) continue;
    const before = tgt[j - 1];
    if (/\s/.test(src[i - 1] ?? '') && before && !/[\s([{“"‘'/-]/u.test(before))
      out = out.replace(ph, ` ${ph}`);
    // Also where the source has a comma or bracket after it that Google dropped ("detection
    // ⟦D1⟧, dynamic" → "tespiti) kapsamaktadır. ⟦D1⟧dinamik", a citation frozen in a retry).
    const after = tgt[j + ph.length];
    if (
      /^(?:\s|[,;:.)\]]{1,3}\s)/u.test(src.slice(i + ph.length)) &&
      after &&
      /[\p{L}\p{N}([{“⟦]/u.test(after)
    )
      out = out.replace(ph, `${ph} `);
    // A mark on its word ends a sentence ("incelenmiştir⟦N1⟧. Ayrıntılar"): Google returns
    // "systems ⟦N1⟧.See". The mark goes back on the word, the sentence end gets its space.
    if (/\p{L}/u.test(src[i - 1] ?? '') && /\s/.test(tgt[j - 1] ?? ''))
      out = out.replace(new RegExp(`[ \\t]${escapeRe(ph)}`, 'u'), ph);
    const end = /^([.,;:!?])\s/u.exec(src.slice(i + ph.length));
    if (end)
      out = out.replace(new RegExp(`${escapeRe(ph)}${escapeRe(end[1]!)}(?=\\p{L})`, 'u'), `$& `);
    // A bracket opened by a formula ("anlamlıdır (⟦F2⟧ 0,01).") that Google turned into a
    // sentence end ("significant.⟦F2⟧ 0,01)."): the bracket comes back, the full stop after it.
    const now = untagged(out);
    const k = now.indexOf(ph);
    const closes = /^[^()]*\)/u.test(now.slice(k + ph.length));
    // Not where the bracket is still there, a space apart ("G Λ ( ⟦F4⟧ )").
    if (src[i - 1] === '(' && !/\(\s*$/u.test(now.slice(0, k)) && closes)
      out = out.replace(new RegExp(`\\s*\\.?\\s*${escapeRe(ph)}`, 'u'), ` (${ph}`);
  }
  return unglue(source, out);
}

/**
 * Google stretches a formatted span up to the next one ("named <t2>typical packages</t2>. … of
 * <t3>143 …" → "<t2>tipik paketler diyoruz. Kötü amaçlı … farklı </t2><t3>143 …"). A span that
 * now runs over a sentence end its source did not have keeps as many words as the source had.
 */
export function confineTags(source: string, target: string): string {
  return target.replace(/<t(\d+)>([^<]*)<\/t\1>/gu, (whole, id: string, inner: string) => {
    const src = new RegExp(`<t${id}>([^<]*)</t${id}>`, 'u').exec(source)?.[1];
    if (src === undefined) return whole;
    // A name or a piece of code kept as written ("<t1>libraries.io</t1>") that took the rest of
    // the sentence along: the span goes back to it.
    const exact = src.trim();
    const at = exact ? inner.indexOf(exact) : -1;
    const words = (t: string) => (t.match(/\S+/gu) ?? []).length;
    if (at >= 0 && words(inner) >= words(exact) + 3)
      return `${inner.slice(0, at)}<t${id}>${exact}</t${id}>${inner.slice(at + exact.length)}`;
    const end = /[.!?;](?=\s+\S)/u;
    if (end.test(src) || !end.test(inner)) return whole;
    if (inner.length < 2 * src.trim().length + 15) return whole;
    const count = (src.trim().match(/\S+/gu) ?? []).length;
    const lead = /^\s*/u.exec(inner)![0];
    const kept = inner
      .trimStart()
      .split(/(?<=\S)(?=\s)/u)
      .slice(0, count)
      .join('');
    return `${lead}<t${id}>${kept}</t${id}>${inner.slice(lead.length + kept.length)}`;
  });
}

/**
 * A short span set on its character in the source — a superscript or subscript ("W/m<t3>2</t3>",
 * "CO<t1>2</t1>", "k<t1>p</t1>") — that Google set a space apart ("W/m <t3>2</t3>") goes back on it.
 */
export function reattachTags(source: string, target: string): string {
  let out = target;
  for (const m of source.matchAll(/(?<=[\p{L}\p{N})\]/])<t(\d+)>([^<]{1,4})<\/t\1>/gu)) {
    out = out.replace(new RegExp(`(?<=[\\p{L}\\p{N})\\]/])[ \\t]+(?=<t${m[1]}>)`, 'u'), '');
  }
  return out;
}

/** A label or cell without a full stop gets none ("Anlam korunmuş" → "The meaning has been preserved."). */
export function dropAddedFullStop(source: string, target: string): string {
  const src = untagged(source)
    .replace(/⟦[A-Z]\d+⟧/g, '')
    .trim();
  const out = /\(\s*\)/u.test(src) ? target : closeEmptyBracket(target);
  return /[.!?…:;]$/u.test(src) || !/[^.]\.$/u.test(out.trimEnd())
    ? out
    : out.trimEnd().slice(0, -1);
}

/** An empty pair Google made of a closing bracket ("(yani, DT, RF, XGBoost( ) sırasıyla"). */
function closeEmptyBracket(target: string): string {
  return target.replace(/\(\s*\)/gu, (_pair, at: number) => {
    const before = target.slice(0, at);
    return before.split('(').length > before.split(')').length ? ')' : '';
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A sentence end glued to the next sentence, a number glued to the next word. */
const GLUED = [
  /(?<=[\p{Ll}\d)][.!?;:])(?=\p{Lu}\p{Ll})/u,
  /(?<=\d)(?=\p{Lu}\p{Ll}{3,})/u,
  // A citation glued to the word after it ("[32]dinamik") or before it ("tespiti[32]").
  /(?<=\])(?=\p{L})/u,
  /(?<=\p{L})(?=\[\d)/u,
  // Two clauses joined where Google dropped ", " ("PyPIGünlük gelen").
  /(?<=\p{Lu}{2})(?=\p{Lu}\p{Ll}{3,})/u,
];

/**
 * Spaces Google dropped where its sentence breaks fell ("signifikant.p", "0,01Maschinelle"),
 * unless the source itself writes text that way.
 */
export function unglue(source: string, target: string): string {
  let out = target;
  for (const re of GLUED)
    if (!re.test(untagged(source))) out = out.replace(new RegExp(re.source, 'gu'), ' ');
  return out;
}

/**
 * A term in Latin letters the source gives in brackets ("(logistics sprawl)", "(Living Labs)")
 * stays as written: Google drops it when translating a Cyrillic or Greek text. It travels as a
 * no-translate span and comes back after.
 */
export function shieldGlosses(text: string, lang: string): { text: string; glosses: string[] } {
  const glosses: string[] = [];
  if (!['bg', 'uk', 'ru', 'el'].includes(lang)) return { text, glosses };
  // The brackets go with it: Google drops brackets around a span it must not translate.
  const out = text.replace(
    /\(\p{Script=Latin}[\p{Script=Latin} '’-]{1,60}\p{Script=Latin}\)/gu,
    (g: string) => {
      glosses.push(g);
      return `⟦Z${glosses.length}⟧`;
    },
  );
  return { text: out, glosses };
}

/** A bracket of words in Latin letters, no figures: "(tool calling)", "(Standard of Care)". */
const LATIN_GLOSS = /\(\p{Script=Latin}[\p{Script=Latin} '’,-]{0,60}\p{Script=Latin}\)/gu;

/**
 * Terms in brackets Google dropped from a translation: a Spanish or German paper names the
 * English term after its own ("Arquitectura de Invocación de Herramientas (Tool Calling)") and
 * Google leaves it out as said twice. Brackets that hold the source language's function words
 * ("(CDSS, en adelante)") are its own text, translated.
 */
export function droppedGlosses(source: string, target: string, lang: string): string[] {
  if (lang === 'en' || ['bg', 'uk', 'ru', 'el'].includes(lang)) return [];
  const count = (t: string) => untagged(t).match(/\(/gu)?.length ?? 0;
  if (count(target) >= count(source)) return [];
  return [...untagged(source).matchAll(LATIN_GLOSS)]
    .map((m) => m[0])
    .filter(
      (g) =>
        functionWords(g.slice(1, -1), lang) === 0 &&
        g.split(/\s+/u).length <= 6 &&
        !untagged(target).includes(g),
    );
}

/** The given glosses as no-translate spans, as shieldGlosses sets them. */
export function shieldThese(text: string, these: string[]): { text: string; glosses: string[] } {
  const glosses: string[] = [];
  let out = text;
  for (const g of these) {
    if (!out.includes(g)) continue;
    glosses.push(g);
    out = out.replace(g, `⟦Z${glosses.length}⟧`);
  }
  return { text: out, glosses };
}

/** Double-quoted terms ("„логистично разрастване“", "“Lojistik yayılması”"), in order. */
const QUOTED = /[„“"«][^„“”"«»]{1,80}?[“”"»]/gu;

/**
 * A gloss the source sets right after a quoted term („логистично разрастване“ (logistics
 * sprawl)) goes back after the same quoted term of the translation: Google moves the span to a
 * sentence end ("… analiz edilmiştir. (logistics sprawl) Kentsel …"). Only when both sides quote
 * as many terms.
 */
export function besideQuotedTerms(source: string, target: string, count: number): string {
  const src = [...source.matchAll(QUOTED)];
  let out = target;
  for (let n = 1; n <= count; n++) {
    const ph = `⟦Z${n}⟧`;
    const at = source.indexOf(ph);
    const k = src.findIndex((m) => {
      const end = m.index + m[0].length;
      return end <= at && /^\s*$/u.test(source.slice(end, at));
    });
    if (k < 0 || !out.includes(ph)) continue;
    const head = out.slice(0, out.indexOf(ph)).trimEnd();
    const tail = out.slice(out.indexOf(ph) + ph.length).trimStart();
    const without = head + (head && tail && !/^[.,;:!?)\]”"»]/u.test(tail) ? ' ' : '') + tail;
    const tgt = [...without.matchAll(QUOTED)];
    if (tgt.length !== src.length) continue;
    // After a suffix on the quote ("\"lojistik yayılması\"dır", "”'nın").
    const quoted = tgt[k]!.index + tgt[k]![0].length;
    const end = quoted + (/^['’]?\p{L}*/u.exec(without.slice(quoted))?.[0].length ?? 0);
    out = without.slice(0, end) + ph + without.slice(end);
  }
  return out;
}

/** The glosses back in place, a space on each side unless punctuation follows or precedes. */
const unshield = (text: string, glosses: string[]) =>
  glosses.reduce((t, g, i) => {
    const ph = `⟦Z${i + 1}⟧`;
    const at = t.indexOf(ph);
    if (at < 0) return t;
    const head = t.slice(0, at).replace(/\s+$/u, '');
    const tail = t.slice(at + ph.length).replace(/^\s+/u, '');
    // A straight quote that closes ("\"Lojistik yayılması\"") is spaced from the gloss.
    const opens = /[([„“«]$/u.test(head) || (/"$/u.test(head) && head.split('"').length % 2 === 0);
    const lead = head && !opens ? ' ' : '';
    const trail = tail && !/^[.,;:!?)\]”"»]/u.test(tail) ? ' ' : '';
    return `${head}${lead}${g}${trail}${tail}`;
  }, text);

/**
 * The year after a date written short ("№ 241 від 09.03.2016 р.", "в 2015 г."): Google read
 * "р." as "river" ("09.03.2016 nehir"); the word itself it translates.
 */
export function spellYears(text: string, lang: string): string {
  const short: Record<string, [RegExp, string]> = {
    uk: [/(\d)\s?р\.(?=[\s,;:)]|$)/gu, '$1 року'],
    ru: [/(\d)\s?г\.(?=[\s,;:)]|$)/gu, '$1 года'],
    bg: [/(\d)\s?г\.(?=[\s,;:)]|$)/gu, '$1 година'],
  };
  const rule = short[lang];
  return rule ? text.replace(rule[0], rule[1]) : text;
}

/**
 * A number held at the end of a bracket after a sign ("(mAP @ IoU = ⟦D1⟧)") that Google moved out
 * with the bracket's end ("(mAP @ IoU =) değerlendiriyoruz. ⟦D1⟧)"): back after its sign. Only
 * where the translation closes one bracket too many.
 */
export function backInBrackets(source: string, target: string): string {
  const count = (t: string, c: string) => t.split(c).length - 1;
  let out = target;
  for (const [ph] of source.matchAll(/⟦D\d+⟧(?=\s*\))/gu)) {
    const sign = /([=<>≤≥±:~≈])\s*$/u.exec(source.slice(0, source.indexOf(ph)))?.[1];
    if (!sign || count(out, ')') <= count(out, '(')) continue;
    // The full stop Google set at the cut goes too ("değerlendiriyoruz. ⟦D1⟧) ve" → "… ve").
    const stray = new RegExp(`(\\.?)\\s*${escapeRe(ph)}\\s*\\)(?=(\\s+\\p{Ll})?)`, 'u');
    const open = new RegExp(`${escapeRe(sign)}\\s*\\)`, 'u');
    const without = out.replace(stray, (_m, stop: string, lower?: string) =>
      stop && !lower ? stop : '',
    );
    if (without === out || !open.test(without)) continue;
    out = without.replace(open, `${sign} ${ph})`);
  }
  return out;
}

/**
 * A closing bracket Google dropped with the sentence end after it ("(Sír. 11,20-21). Luther …"
 * → "(Sir. 11,20-21 Luther …"): where the translation leaves a bracket open, it closes after
 * the token the source closes it after, when that token is a number the translation keeps.
 */
export function closeBrackets(source: string, target: string): string {
  const count = (t: string, c: string) => t.split(c).length - 1;
  let out = target;
  // A comma Google made a closing bracket ("(Conseil de Paris, 09/2006)" → "(Paris Şehir
  // Meclisi) 09/2006)"): the comma comes back.
  out = out.replace(/\(([^()]*?)\)\s+([^\s()]+)\)/gu, (m, inner: string, token: string) =>
    count(out, ')') > count(out, '(') && untagged(source).includes(`, ${token})`)
      ? `(${inner}, ${token})`
      : m,
  );
  for (const m of untagged(source).matchAll(/(\S*\d\S*?)\)([.,;:]?)(?=\s|$)/gu)) {
    if (count(out, '(') <= count(out, ')')) break;
    const token = m[1]!.replace(/^\(/u, '');
    const at = new RegExp(`${escapeRe(token)}(?![)\\d])(?=\\s+\\p{Lu}|\\s*$)`, 'u');
    const hit = at.exec(out);
    if (!hit) continue;
    const before = out.slice(0, hit.index);
    if (count(before, '(') <= count(before, ')')) continue;
    const end = hit.index + token.length;
    out = `${out.slice(0, end)})${m[2] ?? ''}${out.slice(end)}`;
  }
  return out;
}

/**
 * Spaces Google puts inside punctuation, mostly at the edge of a formatted span ("grevleri ,",
 * "eserlerinde ,", "( yani", "\"Sosyal Devrim \"") — unless the source spaces it so, or French
 * typography wants a space before ; : ! ?.
 */
export function unspace(source: string, target: string, lang: string): string {
  const src = untagged(source);
  const tags = '((?:</?t\\d+>)*)';
  const class_ = (cs: string[]) => `[${cs.map(escapeRe).join('')}]`;
  const before = [...(lang === 'fr' ? ',.)]”' : ',.;:!?)]”')].filter(
    (c) => !new RegExp(`\\s${escapeRe(c)}`, 'u').test(src),
  );
  const after = [...'([“'].filter((c) => !new RegExp(`${escapeRe(c)}\\s`, 'u').test(src));
  let out = target;
  if (before.length)
    out = out.replace(new RegExp(`[ \\t]+${tags}(?=${class_(before)})`, 'gu'), '$1');
  if (after.length) out = out.replace(new RegExp(`(${class_(after)})${tags}[ \\t]+`, 'gu'), '$1$2');
  // Straight quotes, as Google writes „…“ and «…»: no space after an opening one, none before a
  // closing one (they alternate).
  if ((out.match(/"/g)?.length ?? 0) % 2 === 0)
    out = out.replace(
      new RegExp(`"${tags}[ \\t]+|[ \\t]+${tags}"`, 'gu'),
      (m, open: string | undefined, close: string | undefined, at: number) => {
        const quote = open !== undefined ? at : at + m.length - 1;
        const opening = (out.slice(0, quote).match(/"/g)?.length ?? 0) % 2 === 0;
        if (open !== undefined) return opening ? `"${open}` : m;
        return opening ? m : `${close ?? ''}"`;
      },
    );
  return out;
}

/**
 * `browser` engine (ADR-015, ADR-021): Google's website translator in a helper frame, or the
 * browser's own page translation, driven through a main-thread bridge. Tags and placeholders
 * travel as DOM spans, so the returned text is tagged text.
 */
export function createBrowserPageEngine(bridge: ChromeTranslatorBridge): TranslationEngine {
  return {
    id: 'browser',
    label: 'Google Translate',
    runsOn: 'main',
    privacy: 'browser-vendor',
    capabilities: {
      glossary: false,
      lengthBudget: false,
      tagsReliable: false,
      condense: false,
      vision: false,
      fidelityCheck: true,
    },
    // Part of the cache key: bumped when results change (2: spaces around placeholders, 3:
    // sentence-level meaning check, 4: identifiers inline, 5: short formulas inline, 6: every
    // inline formula and LaTeX references as text, 7: frozen numbers as text, 8: brackets and full stops, 9: empty brackets, 10: section numbers, 11: research question labels, citations unglued, 12: no space before punctuation, 13: dropped closing brackets, 14: a comma made a bracket, 15: short years spelled out, 16: Latin glosses kept, 17: only a changed number as a span, 18: a number held in place flagged, 19: a note's number pinned, 20: a gloss after its quoted term, 21: decimals found either way, 22: with or without their leading zero, 23: a held number back in its bracket, 24: short formulas as text, 25: signs as themselves, 26: punctuation as itself, 27: no bracket opened twice, 28: chemical formulas whole, 29: text translated piece by piece between spans refused, 30: superscripts on their character, 31: dropped bracketed terms kept).
    model: 'browser-page-31',
    // Each batch must fit on one screen of the translation helper (ADR-021) in tiny type.
    maxBatchChars: 12_000,
    isAvailable: (pair) => bridge.availability(pair),
    checkFidelity: (pairs, ctx, signal) => checkByBackTranslation(bridge, pairs, ctx, signal),
    async translate(whole, ctx, signal): Promise<SegmentResult[]> {
      const pinned = whole.map(pinSectionNumber);
      const batch = pinned.map((p) => p.req);
      const prepared = batch.map((s) => inlineIdentifiers(s));
      const shielded = prepared.map((p) => shieldGlosses(p.text, ctx.pair.source));
      const first = (
        await bridge.translate(
          ctx.pair,
          shielded.map((p) => spellYears(p.text, ctx.pair.source)),
        )
      ).map((t, i) => {
        const { text, glosses } = shielded[i]!;
        const placed = unshield(besideQuotedTerms(text, t, glosses.length), glosses);
        return relocalize(placed, prepared[i]!.inlined);
      });
      signal.throwIfAborted();
      const out = batch.map((s, i): string | null => {
        const { inlined } = prepared[i]!;
        const text = first[i] ?? '';
        const restored = inlined.length ? restoreInline(text, inlined) : text;
        return restored === null ? null : respacePlaceholders(s.text, restored);
      });
      // An identifier the engine changed: the segment again, that one as a no-translate span.
      // Only that one: Google translates the text between spans apart ("passe de 4,4 % en 2001
      // à 8,6 %" with every number a span → "%4,4 içinde 2001 sahip olmak %8,6").
      const partly = out.flatMap((t, i) => (t === null ? [i] : []));
      // A number held in place may read out of place ("… kaldı. 2024. Belediye"): flagged.
      const held = new Set<number>();
      const pieced = new Set<number>();
      if (partly.length) {
        const retry = partly.map((i) =>
          inlineIdentifiers(batch[i]!, lostInline(first[i] ?? '', prepared[i]!.inlined)),
        );
        const texts = await bridge.translate(
          ctx.pair,
          retry.map((r) => r.text),
        );
        signal.throwIfAborted();
        partly.forEach((i, k) => {
          const { inlined } = retry[k]!;
          const restored = restoreInline(relocalize(texts[k] ?? '', inlined), inlined);
          if (restored !== null) out[i] = respacePlaceholders(batch[i]!.text, restored);
          if (restored !== null && piecewise(retry[k]!.text, texts[k] ?? '')) pieced.add(i);
          if (restored !== null && heldInProse(batch[i]!, retry[k]!.text)) held.add(i);
        });
      }
      // Changed again: every identifier as a span.
      const again = out.flatMap((t, i) => (t === null ? [i] : []));
      if (again.length) {
        const texts = await bridge.translate(
          ctx.pair,
          again.map((i) => batch[i]!.text),
        );
        signal.throwIfAborted();
        again.forEach((i, k) => {
          out[i] = respacePlaceholders(batch[i]!.text, texts[k] ?? '');
          if (heldInProse(batch[i]!, batch[i]!.text)) held.add(i);
          if (piecewise(batch[i]!.text, texts[k] ?? '')) pieced.add(i);
        });
      }
      // Terms in brackets Google dropped: the segment again, those kept as written.
      const dropped = out.map((t, i) =>
        t === null || partly.includes(i) || again.includes(i)
          ? []
          : droppedGlosses(prepared[i]!.text, t, ctx.pair.source),
      );
      const glossed = dropped.flatMap((g, i) => (g.length ? [i] : []));
      if (glossed.length) {
        const retry = glossed.map((i) => shieldThese(prepared[i]!.text, dropped[i]!));
        const texts = await bridge.translate(
          ctx.pair,
          retry.map((r) => spellYears(r.text, ctx.pair.source)),
        );
        signal.throwIfAborted();
        glossed.forEach((i, k) => {
          const { text, glosses } = retry[k]!;
          const placed = unshield(besideQuotedTerms(text, texts[k] ?? '', glosses.length), glosses);
          const { inlined } = prepared[i]!;
          const relocal = relocalize(placed, inlined);
          const restored = inlined.length ? restoreInline(relocal, inlined) : relocal;
          if (restored !== null && !piecewise(text, texts[k] ?? ''))
            out[i] = respacePlaceholders(batch[i]!.text, restored);
        });
      }
      // Turkish puts the percent sign before the number; Google glues it to the word before
      // ("F1 skoru%94,2'lik").
      const fix = (t: string, source: string) =>
        unspace(
          source,
          closeBrackets(
            source,
            backInBrackets(
              source,
              ctx.pair.target === 'tr' ? t.replace(/(\p{L})%(?=\d)/gu, '$1 %') : t,
            ),
          ),
          ctx.pair.target,
        );
      // Google sometimes writes zero-width spaces into a term ("Cyber \u200b\u200bSecurity").
      const visible = (t: string, source: string) =>
        /[\u200b\ufeff]/u.test(source) ? t : t.replace(/[\u200b\ufeff]/gu, '');
      return batch.map((s, i) => ({
        id: s.id,
        text: visible(
          unpin(
            dropAddedFullStop(
              s.text,
              reattachTags(s.text, confineTags(s.text, fix(out[i]!, s.text))),
            ),
            pinned[i]!,
          ),
          s.text,
        ),
        ...(held.has(i) || pieced.has(i)
          ? {
              notes: [
                ...(held.has(i) ? ['numbers-held'] : []),
                ...(pieced.has(i) ? ['pieced'] : []),
              ],
            }
          : {}),
      }));
    },
  };
}
