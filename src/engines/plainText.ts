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
      /** The piece ends with punctuation that sits outside the wrapping tag. */
      punctOutside?: boolean;
      /** Tags stripped from inside the piece. */
      inner: InnerTag[];
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
  | { kind: 'atom'; raw: string; cell: boolean; lettered: boolean }
  | { kind: 'styled'; id: string; text: string; lettered: boolean };

const LETTER = /\p{L}/u;
const SENTENCE_END = /[.!?:;]$/;

function toUnits(tagged: string): Unit[] {
  const tokens = tokenize(tagged);
  const units: Unit[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'text') units.push({ kind: 'text', text: t.text });
    else if (t.type === 'ph') {
      units.push({ kind: 'atom', raw: `⟦${t.id}⟧`, cell: t.id.startsWith('T'), lettered: false });
    } else if (t.type === 'open') {
      let raw = '';
      let text = '';
      let hasPlaceholder = false;
      let j = i + 1;
      for (; j < tokens.length; j++) {
        const u = tokens[j]!;
        if (u.type === 'close' && u.id === t.id) break;
        if (u.type === 'text') {
          raw += u.text;
          text += u.text;
        } else if (u.type === 'ph') {
          raw += `⟦${u.id}⟧`;
          hasPlaceholder = true;
        }
      }
      i = j;
      const lettered = LETTER.test(text);
      if (hasPlaceholder || !text.trim()) {
        units.push({ kind: 'atom', raw: `<${t.id}>${raw}</${t.id}>`, cell: false, lettered });
      } else {
        units.push({ kind: 'styled', id: t.id, text, lettered });
      }
    }
  }
  return units;
}

function textPiece(
  text: string,
  inner: InnerTag[],
  sentenceStart: boolean,
  wrap?: string,
  punctOutside = false,
): Piece {
  const lead = /^\s*/.exec(text)![0];
  const core = text.slice(lead.length).trimEnd();
  const trail = text.slice(lead.length + core.length);
  if (!LETTER.test(core)) {
    // Nothing to translate: put the stripped tags back where they were.
    let raw = '';
    let rest = text;
    for (const t of inner) {
      const at = rest.indexOf(t.text);
      raw += `${rest.slice(0, at)}<${t.id}>${t.text}</${t.id}>`;
      rest = rest.slice(at + t.text.length);
    }
    return { kind: 'keep', raw: raw + rest };
  }
  return {
    kind: 'text',
    text: core,
    lead,
    trail,
    inner,
    sentenceStart,
    ...(wrap ? { wrap } : {}),
    ...(punctOutside ? { punctOutside } : {}),
  };
}

export function planPieces(tagged: string): PiecePlan {
  const units = toUnits(tagged);
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
  let current: { text: string; inner: InnerTag[]; start: boolean } | null = null;
  const atSentenceStart = () =>
    afterCell || before.trim() === '' || SENTENCE_END.test(before.trimEnd());
  const flush = () => {
    if (current) pieces.push(textPiece(current.text, current.inner, current.start));
    current = null;
  };
  const keep = (raw: string) => {
    flush();
    pieces.push({ kind: 'keep', raw });
  };

  for (let i = 0; i < units.length; i++) {
    const u = units[i]!;
    if (u.kind === 'atom') {
      keep(u.raw);
      keptVerbatim ||= u.lettered;
      afterCell = u.cell;
      continue;
    }
    // Marks without letters stay where they are at the edges; inside the text they travel with
    // it ("Samaana¹, Costa²", "[³⁵]") and are put back around the same characters.
    if (
      u.kind === 'styled' &&
      !u.lettered &&
      (before.trim() === '' || plainAfter[i]!.trim() === '')
    ) {
      keep(`<${u.id}>${u.text}</${u.id}>`);
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
    if (sentence) {
      flush();
      const outside = !SENTENCE_END.test(u.text.trimEnd()) && punct !== undefined;
      if (outside && next?.kind === 'text') next.text = next.text.slice(1);
      pieces.push(textPiece(outside ? u.text + punct : u.text, [], true, u.id, outside));
      before += outside ? u.text + punct : u.text;
    } else {
      current ??= { text: '', inner: [], start: atSentenceStart() };
      if (u.kind === 'styled') current.inner.push({ id: u.id, text: u.text });
      current.text += u.text;
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
  for (const m of text.matchAll(/[.!?]["”’)]?\s+(?=[\p{Lu}\d[(“"])/gu)) {
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
  for (const tag of tags) {
    const taken = spans.map((s): [number, number] => [s.at, s.end]);
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
  const src = plainText(source).trimStart();
  const s = src[0];
  if (!s || !/\p{L}/u.test(s) || s === s.toLowerCase()) return target;
  const m = new RegExp(String.raw`^((?:<\/?t\d+>|[${OPENING}])*)(\p{L})`, 'u').exec(target);
  if (!m) return target;
  const c = m[2]!;
  const upper = c.toLocaleUpperCase(lang);
  if (c === upper || c !== c.toLocaleLowerCase(lang)) return target;
  return m[1]! + upper + target.slice(m[0].length);
}

/**
 * Rebuilds the tagged translation from the engine's answers (one per text piece). Returns null
 * when a piece came back empty, so the pipeline retries instead of dropping text.
 */
export function assemblePieces(
  plan: PiecePlan,
  answers: string[],
  lang: string,
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
    if (p.sentenceStart) t = matchInitialCase(p.text, t, lang);
    const placed = placeTags(t, p.inner);
    lostTags.push(...placed.lost);
    let body = placed.text;
    if (p.wrap) {
      const m = p.punctOutside ? /[.:;!?]$/.exec(body) : null;
      body = m
        ? `<${p.wrap}>${body.slice(0, -1)}</${p.wrap}>${m[0]}`
        : `<${p.wrap}>${body}</${p.wrap}>`;
    }
    out += p.lead + body + p.trail;
  }
  return { text: out + lostTags.map((id) => `<${id}></${id}>`).join(''), lostTags };
}
