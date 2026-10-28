import { academicTerm } from '../core/glossary/academic';
import { plainText, tokenize } from '../core/segment/codec';

/**
 * Support for engines that translate plain text only (Chrome's Translator API drops or mangles
 * `<tN>` tags and `⟦…⟧` placeholders). A tagged segment is cut into pieces:
 * - kept verbatim: placeholders, and tags without letters at the very start or end of the
 *   segment (affiliation marks "¹An Najah …");
 * - translated alone with its tag kept exactly: style runs that span whole sentences
 *   ("<t1>Background.</t1> In modern …", "<t1>Background</t1>. In …", an all-italic paragraph);
 * - translated as running text: everything else, with the remaining tags stripped and put back
 *   only where their text survived verbatim (names, numbers, citations) — otherwise reported.
 */

export interface InnerTag {
  id: string;
  text: string;
}

export type Piece =
  | { kind: 'keep'; raw: string }
  | {
      kind: 'text';
      /** Text sent to the engine, without surrounding whitespace. */
      text: string;
      lead: string;
      trail: string;
      /** Tag wrapping the whole piece (a sentence-level style run). */
      wrap?: string;
      /** Final punctuation of a wrapped piece, not sent ("Test dataset" is a noun phrase,
       * "Test dataset." reads like an imperative); `punctInside` = it belongs inside the tag. */
      punct?: string;
      punctInside?: boolean;
      /** Tags stripped from inside the piece. */
      inner: InnerTag[];
      /** Placeholders sent as their text (identifiers, URLs), put back after translation. */
      inlined: InnerTag[];
      /** The piece starts a sentence or a table cell (its first letter's case is kept). */
      sentenceStart: boolean;
    };

export interface PiecePlan {
  pieces: Piece[];
  /** A tag with letters and a link inside could not be split and stays untranslated. */
  keptVerbatim: boolean;
}

type Unit =
  | { kind: 'text'; text: string }
  | { kind: 'inline'; id: string; text: string }
  | { kind: 'atom'; raw: string; cell: boolean; lettered: boolean }
  | {
      kind: 'styled';
      id: string;
      /** Text sent (identifiers inline). */
      text: string;
      /** The same with its placeholders (what the tag wraps in the tagged result). */
      raw: string;
      lettered: boolean;
      inlined: InnerTag[];
    };

const LETTER = /\p{L}/u;
const SENTENCE_END = /[.!?:;]$/;

function toUnits(tagged: string, verbatim?: Record<string, string>): Unit[] {
  const tokens = tokenize(tagged);
  const units: Unit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'text') units.push({ kind: 'text', text: t.text });
    else if (t.type === 'ph') {
      const v = verbatim?.[t.id];
      // Single words (identifiers, URLs) and glossary terms travel inline.
      if (v && (/^\S+$/u.test(v) || t.id.startsWith('G'))) {
        units.push({ kind: 'inline', id: t.id, text: v });
      } else {
        units.push({ kind: 'atom', raw: `⟦${t.id}⟧`, cell: t.id.startsWith('T'), lettered: false });
      }
    } else if (t.type === 'open') {
      let raw = '';
      let text = '';
      let plain = '';
      let hasPlaceholder = false;
      const inlined: InnerTag[] = [];
      let j = i + 1;
      for (; j < tokens.length; j++) {
        const u = tokens[j]!;
        if (u.type === 'close' && u.id === t.id) break;
        if (u.type === 'text') {
          raw += u.text;
          text += u.text;
          plain += u.text;
        } else if (u.type === 'ph') {
          raw += `⟦${u.id}⟧`;
          const v = verbatim?.[u.id];
          if (v && /^\S+$/u.test(v)) {
            text += v;
            inlined.push({ id: u.id, text: v });
          } else hasPlaceholder = true;
        }
      }
      i = j;
      const lettered = LETTER.test(plain);
      // A styled run of one or two letters is a mark (author/affiliation letters "a", "b"), not
      // a word to translate ("a" would become "bir"). Digit marks (citation numbers) travel
      // with the text instead, so sentences are not cut at every citation.
      const letterMark = lettered && /^\s*\S{1,2}\s*$/u.test(plain);
      if (hasPlaceholder || !text.trim() || letterMark) {
        units.push({
          kind: 'atom',
          raw: `<${t.id}>${raw}</${t.id}>`,
          cell: false,
          lettered: lettered && hasPlaceholder,
        });
      } else {
        units.push({ kind: 'styled', id: t.id, text, raw, lettered, inlined });
      }
    }
  }
  return units;
}

interface Chunk {
  text: string;
  /** The same content as tagged text (used when there is nothing to translate). */
  raw: string;
  inner: InnerTag[];
  inlined: InnerTag[];
  start: boolean;
}

function chunkPiece(c: Chunk): Piece {
  const lead = /^\s*/.exec(c.text)![0];
  const core = c.text.slice(lead.length).trimEnd();
  if (!LETTER.test(core)) return { kind: 'keep', raw: c.raw };
  return {
    kind: 'text',
    text: core,
    lead,
    trail: c.text.slice(lead.length + core.length),
    inner: c.inner,
    inlined: c.inlined,
    sentenceStart: c.start,
  };
}

/**
 * `verbatim` maps ⟦U⟧ placeholders to their text: single-word ones (identifiers, URLs) are sent
 * inline so sentences stay whole, and are put back after translation.
 */
export function planPieces(tagged: string, verbatim?: Record<string, string>): PiecePlan {
  const units = toUnits(tagged, verbatim);
  const plainAfter: string[] = [];
  let suffix = '';
  for (let i = units.length - 1; i >= 0; i--) {
    plainAfter[i] = suffix;
    const u = units[i]!;
    if (u.kind !== 'atom') suffix = u.text + suffix;
  }

  const pieces: Piece[] = [];
  let keptVerbatim = false;
  let before = '';
  let afterCell = false;
  let current: Chunk | null = null;
  const atSentenceStart = () =>
    afterCell || before.trim() === '' || SENTENCE_END.test(before.trimEnd());
  const flush = () => {
    if (current) pieces.push(chunkPiece(current));
    current = null;
  };
  const keep = (raw: string) => {
    flush();
    pieces.push({ kind: 'keep', raw });
  };
  const chunk = () =>
    (current ??= { text: '', raw: '', inner: [], inlined: [], start: atSentenceStart() });

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === 'atom') {
      keep(u.raw);
      keptVerbatim ||= u.lettered;
      afterCell = u.cell;
      continue;
    }
    if (u.kind === 'inline') {
      const c = chunk();
      c.text += u.text;
      c.raw += `⟦${u.id}⟧`;
      c.inlined.push({ id: u.id, text: u.text });
      before += u.text;
      afterCell = false;
      continue;
    }
    // Marks without letters stay where they are at the edges; inside the text they travel with
    // it ("Samaana¹, Costa²", "[³⁵]") and are put back around the same characters.
    if (
      u.kind === 'styled' &&
      !u.lettered &&
      (before.trim() === '' || plainAfter[i]!.trim() === '')
    ) {
      keep(`<${u.id}>${u.raw}</${u.id}>`);
      before += u.text;
      continue;
    }
    const next = units[i + 1];
    const punct = next?.kind === 'text' ? /^[.:;!?]/.exec(next.text)?.[0] : undefined;
    const sentence =
      u.kind === 'styled' &&
      u.lettered &&
      atSentenceStart() &&
      (SENTENCE_END.test(u.text.trimEnd()) || plainAfter[i]!.trim() === '' || punct !== undefined);
    if (u.kind === 'styled' && sentence) {
      flush();
      const core = u.text.trimEnd();
      const outside = !SENTENCE_END.test(core) && punct !== undefined;
      if (outside && next?.kind === 'text') next.text = next.text.slice(1);
      const inside = outside ? '' : (/[.:;!?]$/.exec(core)?.[0] ?? '');
      const sent = inside ? core.slice(0, -1) + u.text.slice(core.length) : u.text;
      const lead = /^\s*/.exec(sent)![0];
      const text = sent.trim();
      pieces.push({
        kind: 'text',
        text,
        lead,
        trail: sent.slice(lead.length + text.length),
        wrap: u.id,
        ...(outside ? { punct } : inside ? { punct: inside, punctInside: true } : {}),
        inner: [],
        inlined: u.inlined,
        sentenceStart: true,
      });
      before += u.text + (outside ? punct : '');
    } else {
      const c = chunk();
      if (u.kind === 'styled') {
        // The needle is the tag's content as it reads after inlined identifiers are restored.
        c.inner.push({ id: u.id, text: u.raw });
        c.inlined.push(...u.inlined);
        c.raw += `<${u.id}>${u.raw}</${u.id}>`;
      } else c.raw += u.text;
      c.text += u.text;
      before += u.text;
    }
    afterCell = false;
  }
  flush();
  return { pieces, keptVerbatim };
}

const ABBREVIATION =
  /(?:\b(?:e\.g|i\.e|et al|cf|vs|etc|Fig|Figs|Eq|Eqs|Ref|Refs|Sec|Tab|No|Vol|pp|Dr|Prof|approx|resp|ark|bkz|vb|örn|Şek|Tbl)|\b\p{Lu})\.$/u;

/**
 * Splits running text into sentences (after . ! ? followed by a capital, digit or bracket),
 * not after common abbreviations or initials. Used when a long piece came back incomplete.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  // A tag or placeholder may open the next sentence ("<t1>Results</t1> show …").
  for (const m of text.matchAll(/[.!?]["”’)]?\s+(?=(?:<t\d+>|⟦[A-Z]\d+⟧)*[\p{Lu}\d[(“"])/gu)) {
    const end = m.index + m[0].trimEnd().length;
    if (ABBREVIATION.test(text.slice(start, end).trimEnd())) continue;
    out.push(text.slice(start, end));
    start = m.index + m[0].length;
  }
  out.push(text.slice(start));
  return out.filter((t) => t.trim());
}

const words = (t: string) => t.trim().split(/\s+/).length;

/**
 * Splits a sentence into clauses after ; and : and after commas outside brackets when both
 * sides have at least three words. Last resort when an engine keeps dropping part of a sentence.
 */
export function splitClauses(sentence: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < sentence.length; i++) {
    const c = sentence[i]!;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ',;:'.includes(c) && /\s/.test(sentence[i + 1] ?? '')) {
      const left = sentence.slice(start, i + 1);
      const right = sentence.slice(i + 1);
      if (c !== ',' || (words(left) >= 3 && words(right) >= 3)) {
        out.push(left);
        start = i + 1;
      }
    }
  }
  out.push(sentence.slice(start));
  return out.map((t) => t.trim()).filter(Boolean);
}

/** Texts to send to the engine, in piece order. */
export const pieceTexts = (plan: PiecePlan): string[] =>
  plan.pieces.flatMap((p) => (p.kind === 'text' ? [p.text] : []));

/** Letters may not continue letters, digits may not continue digits ("Samaana1" is fine). */
const glued = (a: string | undefined, b: string | undefined) =>
  a !== undefined &&
  b !== undefined &&
  ((/\p{L}/u.test(a) && /\p{L}/u.test(b)) || (/\p{N}/u.test(a) && /\p{N}/u.test(b)));

/**
 * Finds `needle` as a whole word, not overlapping `taken`, searching from `from` first; ignores
 * letter case ("Packj" → "PackJ") when that keeps string positions intact.
 */
function findFree(text: string, needle: string, from: number, taken: [number, number][]): number {
  const caseless = text.toLowerCase().length === text.length;
  const hay = caseless ? text.toLowerCase() : text;
  const pin = caseless ? needle.toLowerCase() : needle;
  const free = (at: number) =>
    taken.every(([a, b]) => at + needle.length <= a || at >= b) &&
    !glued(text[at - 1], needle[0]) &&
    !glued(needle[needle.length - 1], text[at + needle.length]);
  for (const start of [from, 0]) {
    for (let at = hay.indexOf(pin, start); at >= 0; at = hay.indexOf(pin, at + 1)) {
      if (free(at)) return at;
    }
  }
  return -1;
}

/**
 * Puts stripped tags back around their source text where it survived verbatim in the
 * translation (in source order, whole words only, never overlapping). The others are reported
 * in `lost` so the caller can keep the structure valid.
 */
export function placeTags(translated: string, tags: InnerTag[]): { text: string; lost: string[] } {
  const spans: { at: number; end: number; id: string }[] = [];
  const lost: string[] = [];
  let cursor = 0;
  const placeholders = [...translated.matchAll(/⟦[A-Z]\d+⟧/gu)].map((m): [number, number] => [
    m.index,
    m.index + m[0].length,
  ]);
  for (const tag of tags) {
    const taken = [...placeholders, ...spans.map((s): [number, number] => [s.at, s.end])];
    // Punctuation inside the tag may move or change ("1," → "1'de"); retry without it.
    let needle = tag.text.trim();
    let at = needle ? findFree(translated, needle, cursor, taken) : -1;
    const bare = needle.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '');
    if (at < 0 && bare && bare !== needle) {
      needle = bare;
      at = findFree(translated, needle, cursor, taken);
    }
    if (at < 0) {
      lost.push(tag.id);
      continue;
    }
    spans.push({ at, end: at + needle.length, id: tag.id });
    cursor = at + needle.length;
  }
  spans.sort((a, b) => a.at - b.at);
  let text = '';
  let pos = 0;
  for (const s of spans) {
    text += `${translated.slice(pos, s.at)}<${s.id}>${translated.slice(s.at, s.end)}</${s.id}>`;
    pos = s.end;
  }
  return { text: text + translated.slice(pos), lost };
}

const OPENING = String.raw`\s"'“‘«(\[¿¡`;

/**
 * Plain-text engines often lower-case the first word ("Background." → "arka plan."). When the
 * source starts with a capital letter, so does the translation (locale-aware: i → İ in Turkish).
 * Leading tags and opening punctuation are skipped; a translation that starts with a number is
 * left alone.
 */
export function matchInitialCase(source: string, target: string, lang: string): string {
  // Section numbers and list marks before the first word ("2 Background", "(a) Results") are
  // skipped when the translation starts with the same ones.
  const plain = plainText(source).trimStart();
  const numbering = /^[\d.()[\]•\-–—:]+\s+/u.exec(plain)?.[0] ?? '';
  const s = plain[numbering.length];
  if (!s || !/\p{L}/u.test(s) || s === s.toLowerCase()) return target;
  const m = new RegExp(String.raw`^((?:<\/?t\d+>|[${OPENING}])*)`, 'u').exec(target)!;
  let at = m[0].length;
  if (numbering) {
    if (!target.slice(at).startsWith(numbering.trim())) return target;
    at += numbering.trim().length;
    at += /^\s*/.exec(target.slice(at))![0].length;
  }
  const c = target[at];
  if (!c || !/\p{L}/u.test(c)) return target;
  const upper = c.toLocaleUpperCase(lang);
  if (c === upper || c !== c.toLocaleLowerCase(lang)) return target;
  return target.slice(0, at) + upper + target.slice(at + 1);
}

/**
 * Rebuilds the tagged translation from the engine's answers (one per text piece). Returns null
 * when a piece came back empty, so the pipeline retries instead of dropping text.
 */
/**
 * Puts inlined placeholders back where their text survived (any letter case), or null. Never
 * inside the placeholders and tags the engine kept: a formula "F" is not the F of "⟦F1⟧".
 */
export function restoreInline(t: string, inlined: InnerTag[]): string | null {
  const markup = [...t.matchAll(/⟦[A-Z]\d+⟧|<\/?t\d+>/gu)].map((m): [number, number] => [
    m.index,
    m.index + m[0].length,
  ]);
  const spans: { at: number; end: number; id: string }[] = [];
  let cursor = 0;
  for (const it of inlined) {
    const at = findFree(t, it.text, cursor, [
      ...markup,
      ...spans.map((s): [number, number] => [s.at, s.end]),
    ]);
    if (at < 0) return null;
    spans.push({ at, end: at + it.text.length, id: it.id });
    cursor = at + it.text.length;
  }
  spans.sort((a, b) => a.at - b.at);
  let out = '';
  let pos = 0;
  for (const s of spans) {
    out += `${t.slice(pos, s.at)}⟦${s.id}⟧`;
    pos = s.end;
  }
  return out + t.slice(pos);
}

export function assemblePieces(
  plan: PiecePlan,
  answers: string[],
  lang: string,
  sourceLang?: string,
): { text: string; lostTags: string[] } | null {
  let k = 0;
  let out = '';
  const lostTags: string[] = [];
  for (const p of plan.pieces) {
    if (p.kind === 'keep') {
      out += p.raw;
      continue;
    }
    let t = (answers[k++] ?? '').trim();
    if (!t) return null;
    if (p.wrap && p.punct) t = t.replace(/[.:;!?]+$/u, '');
    // Run-in headings of structured abstracts ("Background.", "Results.") from the table.
    const term = p.wrap && sourceLang ? academicTerm(p.text, sourceLang, lang) : null;
    if (term) t = term;
    if (p.sentenceStart) t = matchInitialCase(p.text, t, lang);
    if (p.inlined.length) {
      const restored = restoreInline(t, p.inlined);
      if (restored === null) return null; // an identifier was translated: retry
      t = restored;
    }
    const placed = placeTags(t, p.inner);
    lostTags.push(...placed.lost);
    let body = placed.text;
    if (p.wrap) {
      body = p.punctInside
        ? `<${p.wrap}>${body}${p.punct}</${p.wrap}>`
        : `<${p.wrap}>${body}</${p.wrap}>${p.punct ?? ''}`;
    }
    out += p.lead + body + p.trail;
  }
  return { text: out + lostTags.map((id) => `<${id}></${id}>`).join(''), lostTags };
}
