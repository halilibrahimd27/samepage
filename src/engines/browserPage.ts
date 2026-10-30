import { checkByBackTranslation, type ChromeTranslatorBridge } from './chromeBuiltin';
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
function inlineIdentifiers(req: SegmentRequest): { text: string; inlined: InnerTag[] } {
  const inlined: InnerTag[] = [];
  const text = req.text.replace(/⟦([A-Z]\d+)⟧/g, (ph, id: string) => {
    const v = req.verbatim?.[id];
    if (!v || !/^\S+$/u.test(v)) return ph;
    inlined.push({ id, text: v });
    return v;
  });
  return { text, inlined };
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
  const m = req.role === 'heading' ? /^\s*\d{1,2}(?:\.\d{1,2})*\.?\s+(?=\S)/u.exec(req.text) : null;
  if (m) return { req: { ...req, text: req.text.slice(m[0].length) }, number: m[0], tag: '' };
  const label = /^(\s*(?:<t\d+>)?)((?:RQ|H|Q)\d{1,2}[a-z]?\s*:\s*)(?=\S)/u.exec(req.text);
  return label
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
    const after = tgt[j + ph.length];
    if (/\s/.test(src[i + ph.length] ?? '') && after && /[\p{L}\p{N}([{“]/u.test(after))
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
    if (src[i - 1] === '(' && now[k - 1] !== '(' && closes)
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
    const end = /[.!?;](?=\s+\S)/u;
    if (src === undefined || end.test(src) || !end.test(inner)) return whole;
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
    // inline formula and LaTeX references as text, 7: frozen numbers as text, 8: brackets and full stops, 9: empty brackets, 10: section numbers, 11: research question labels, citations unglued).
    model: 'browser-page-11',
    // Each batch must fit on one screen of the translation helper (ADR-021) in tiny type.
    maxBatchChars: 12_000,
    isAvailable: (pair) => bridge.availability(pair),
    checkFidelity: (pairs, ctx, signal) => checkByBackTranslation(bridge, pairs, ctx, signal),
    async translate(whole, ctx, signal): Promise<SegmentResult[]> {
      const pinned = whole.map(pinSectionNumber);
      const batch = pinned.map((p) => p.req);
      const prepared = batch.map(inlineIdentifiers);
      const first = await bridge.translate(
        ctx.pair,
        prepared.map((p) => p.text),
      );
      signal.throwIfAborted();
      const out = batch.map((s, i): string | null => {
        const { inlined } = prepared[i]!;
        const text = first[i] ?? '';
        const restored = inlined.length ? restoreInline(text, inlined) : text;
        return restored === null ? null : respacePlaceholders(s.text, restored);
      });
      // An identifier the engine changed: the segment again, identifiers as no-translate spans.
      const again = out.flatMap((t, i) => (t === null ? [i] : []));
      if (again.length) {
        const texts = await bridge.translate(
          ctx.pair,
          again.map((i) => batch[i]!.text),
        );
        signal.throwIfAborted();
        again.forEach((i, k) => (out[i] = respacePlaceholders(batch[i]!.text, texts[k] ?? '')));
      }
      // Turkish puts the percent sign before the number; Google glues it to the word before
      // ("F1 skoru%94,2'lik").
      const fix = (t: string) =>
        ctx.pair.target === 'tr' ? t.replace(/(\p{L})%(?=\d)/gu, '$1 %') : t;
      return batch.map((s, i) => ({
        id: s.id,
        text: unpin(dropAddedFullStop(s.text, confineTags(s.text, fix(out[i]!))), pinned[i]!),
      }));
    },
  };
}
