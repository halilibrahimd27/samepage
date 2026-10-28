import type { PlaceholderDef, PlaceholderKind, TagDef } from './types';

/** One inline piece of a paragraph before encoding / after decoding. */
export type InlineRun<S> =
  | { type: 'text'; text: string; style: S }
  | { type: 'atom'; kind: Exclude<PlaceholderKind, 'L' | 'U'>; text: string; ref?: string };

export interface Encoded<S> {
  source: string;
  baseStyle: S;
  tags: TagDef<S>[];
  placeholders: PlaceholderDef[];
}

export type Token =
  | { type: 'text'; text: string }
  | { type: 'open'; id: string }
  | { type: 'close'; id: string }
  | { type: 'ph'; id: string };

const TOKEN_RE = /<(\/?)(t\d+)>|⟦([A-Z]\d+)⟧/g;
/** Text that would be mistaken for markup; escaped as ⟦L…⟧ placeholders. */
const LITERAL_RE = /<\/?t\d+>|[⟦⟧]/g;
/**
 * URLs, DOIs, arXiv ids, e-mail addresses and identifiers are never translated (⟦U…⟧):
 * snake_case (`has_long_str`), versioned package names (`requests-3.0.0`), names with digits
 * (`bandit4mal`, `urllib2`) and names with inner capitals (`MalOSS`, `PyPI`, `OSSGadget`) —
 * machine translation turns them into words ("Kötülük", "haydut4mal"). Slash-joined
 * abbreviations (`M/B`, `TP/FP`) too: their meaning is defined by the paper, not the dictionary
 * ("M/B" became "Erkek/Kadın"). Plurals of acronyms ("PDFs", "APIs") stay translatable.
 */
const URL_RE =
  /\b(?:[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ww][Ww][Ww]\.)[^\s<>⟦⟧]+[^\s<>⟦⟧.,;:!?)\]}'"]|\b10\.\d{4,9}\/[^\s<>⟦⟧]+[^\s<>⟦⟧.,;:!?)\]}'"]|\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\b|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b|\b[A-Za-z0-9][\w.-]*-\d+(?:\.\d+)+\b|\b[A-Za-z]+\d+[A-Za-z\d]*\b(?![- ](?:score|measure))|\b[A-Za-z]*[a-z][A-Z][A-Za-z]*\b|\b[A-Z]{2,}[a-z]{2,}[A-Za-z]*\b|\b[A-Z]{1,4}(?:\/[A-Z]{1,4})+\b/g;

/** Splits tagged text into tokens. Unknown-looking markup stays as plain text. */
export function tokenize(tagged: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of tagged.matchAll(TOKEN_RE)) {
    if (m.index > last) tokens.push({ type: 'text', text: tagged.slice(last, m.index) });
    if (m[3]) tokens.push({ type: 'ph', id: m[3] });
    else tokens.push({ type: m[1] ? 'close' : 'open', id: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < tagged.length) tokens.push({ type: 'text', text: tagged.slice(last) });
  return tokens;
}

/** Tagged text without tags and placeholders (for language/number checks). */
export function plainText(tagged: string): string {
  return tokenize(tagged)
    .filter((t) => t.type === 'text')
    .map((t) => (t as { text: string }).text)
    .join('');
}

/**
 * Encodes inline runs into tagged text. The style covering most characters becomes the base
 * style (untagged); every other contiguous style run gets its own `<tN>` tag. Styles are
 * compared with `styleKey`. URLs/DOIs/e-mails and markup-looking literals become placeholders.
 */
export function encode<S>(runs: InlineRun<S>[], styleKey: (s: S) => string): Encoded<S> {
  // Merge adjacent text runs with the same style. Whitespace-only runs have no visible style of
  // their own: they join the text before them (or adopt the style of the text after them).
  const blank = (t: string) => /^\s*$/.test(t);
  const merged: InlineRun<S>[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (run.type === 'text' && prev?.type === 'text') {
      if (styleKey(prev.style) === styleKey(run.style) || blank(run.text)) {
        merged[merged.length - 1] = { ...prev, text: prev.text + run.text };
        continue;
      }
      if (blank(prev.text)) {
        merged[merged.length - 1] = { ...run, text: prev.text + run.text };
        continue;
      }
    }
    if (run.type !== 'text' || run.text.length > 0) merged.push(run);
  }

  const weight = new Map<string, { style: S; chars: number; first: number }>();
  merged.forEach((run, i) => {
    if (run.type !== 'text') return;
    const key = styleKey(run.style);
    const w = weight.get(key) ?? { style: run.style, chars: 0, first: i };
    w.chars += run.text.length;
    weight.set(key, w);
  });
  // Deterministic: most characters wins, ties broken by first appearance.
  const base = [...weight.values()].sort((a, b) => b.chars - a.chars || a.first - b.first)[0];
  const baseKey = base ? styleKey(base.style) : '';

  const tags: TagDef<S>[] = [];
  const placeholders: PlaceholderDef[] = [];
  const counters: Partial<Record<PlaceholderKind, number>> = {};
  const addPlaceholder = (kind: PlaceholderKind, text: string, ref?: string) => {
    const n = (counters[kind] ?? 0) + 1;
    counters[kind] = n;
    const def: PlaceholderDef = { id: `${kind}${n}`, kind, text };
    if (ref !== undefined) def.ref = ref;
    placeholders.push(def);
    return `⟦${def.id}⟧`;
  };
  // Literals first; URLs and identifiers only outside the placeholders just made ("⟦L1⟧").
  const protect = (text: string) =>
    text
      .replace(LITERAL_RE, (lit) => addPlaceholder('L', lit))
      .split(/(⟦[A-Z]\d+⟧)/)
      .map((part, i) => (i % 2 ? part : part.replace(URL_RE, (url) => addPlaceholder('U', url))))
      .join('');

  let source = '';
  for (const run of merged) {
    if (run.type === 'atom') {
      source += addPlaceholder(run.kind, run.text, run.ref);
    } else if (styleKey(run.style) === baseKey) {
      source += protect(run.text);
    } else {
      const id = `t${tags.length + 1}`;
      tags.push({ id, style: run.style });
      source += `<${id}>${protect(run.text)}</${id}>`;
    }
  }
  return { source, baseStyle: base?.style as S, tags, placeholders };
}

/**
 * Tagged text as a person reads it (quality report): tags dropped, placeholders shown as their
 * content (URLs, identifiers, formulas, code, note marks), tabs and breaks as spaces.
 */
export function readableText(tagged: string, placeholders: PlaceholderDef[] = []): string {
  const byId = new Map(placeholders.map((p) => [p.id, p]));
  return tokenize(tagged)
    .map((t) => {
      if (t.type === 'text') return t.text;
      if (t.type !== 'ph') return '';
      const p = byId.get(t.id);
      if (!p || p.kind === 'T' || p.kind === 'B') return ' ';
      // Fields, deleted revisions and drawings are not text a reader sees inline.
      return p.kind === 'R' || p.kind === 'I' ? '' : p.text;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether an inline formula can travel to the engine as its own text: one short token that is
 * no word of either language. A one-letter formula as a no-translate span reads as a sentence
 * break ("uyum katsayısı κ = 0,81" became "…was calculated. κ The accuracy was 0.81"). Not
 * lower-case Latin letters ("e", "a", "y" are words) nor letters of the pair's own script.
 */
function inlineFormula(text: string, pair?: { source: string; target: string }): boolean {
  if (!/^\S{1,12}$/u.test(text) || [...text].length > 12 || !/\p{L}/u.test(text)) return false;
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]+$/.test(text)) return /^(?:[B-HJ-NP-XZ]|[A-Za-z]{1,3}\d+)$/.test(text);
  const langs = pair ? [pair.source, pair.target] : [];
  if (langs.includes('el') && /\p{Script=Greek}/u.test(text)) return false;
  if (langs.some((l) => ['ru', 'uk', 'bg'].includes(l)) && /\p{Script=Cyrillic}/u.test(text))
    return false;
  return true;
}

/**
 * Ref of the ⟦I⟧ placeholder that marks a display formula inside a sentence (PDF): nothing is
 * drawn for it, the formula stays where it is on the page.
 */
export const DISPLAY_FORMULA = 'display-formula';
/**
 * What engines read for that marker: a formula symbol, so that a verb after the formula keeps
 * its object ("…alınırsa [formula] olur" is "taking …, [formula] is obtained", not "It will
 * work if taken").
 */
const DISPLAY_STAND_IN = '𝛯';

/**
 * Text of the placeholders that travel as text (for SegmentRequest.verbatim): identifiers and
 * URLs (⟦U⟧), short inline formulas (⟦F⟧) for the given language pair, and display-formula
 * markers as a symbol.
 */
export function verbatimOf(
  placeholders: PlaceholderDef[],
  pair?: { source: string; target: string },
): { verbatim?: Record<string, string> } {
  const entries = placeholders.flatMap((p): [string, string][] => {
    if (p.kind === 'U' || (p.kind === 'F' && inlineFormula(p.text, pair))) return [[p.id, p.text]];
    return p.kind === 'I' && p.ref === DISPLAY_FORMULA ? [[p.id, DISPLAY_STAND_IN]] : [];
  });
  return entries.length ? { verbatim: Object.fromEntries(entries) } : {};
}

export interface DecodedRun<S> {
  type: 'text' | 'atom';
  text: string;
  style?: S;
  placeholder?: PlaceholderDef;
}

/**
 * Decodes a (validated) tagged translation back into runs. Text outside tags gets the base
 * style; ⟦U⟧/⟦L⟧ placeholders become text again, other placeholders become atoms.
 * Throws on unknown ids — run the validators first.
 */
export function decode<S>(tagged: string, enc: Omit<Encoded<S>, 'source'>): DecodedRun<S>[] {
  const tagById = new Map(enc.tags.map((t) => [t.id, t]));
  const phById = new Map(enc.placeholders.map((p) => [p.id, p]));
  const out: DecodedRun<S>[] = [];
  const stack: string[] = [];
  const style = () => {
    const top = stack[stack.length - 1];
    return top ? tagById.get(top)!.style : enc.baseStyle;
  };
  const pushText = (text: string) => {
    const prev = out[out.length - 1];
    const s = style();
    if (prev?.type === 'text' && prev.style === s) prev.text += text;
    else out.push({ type: 'text', text, style: s });
  };
  for (const tok of tokenize(tagged)) {
    if (tok.type === 'text') pushText(tok.text);
    else if (tok.type === 'open') {
      if (!tagById.has(tok.id)) throw new Error(`Unknown tag ${tok.id}`);
      stack.push(tok.id);
    } else if (tok.type === 'close') {
      if (stack.pop() !== tok.id) throw new Error(`Unbalanced tag ${tok.id}`);
    } else {
      const ph = phById.get(tok.id);
      if (!ph) throw new Error(`Unknown placeholder ${tok.id}`);
      if (ph.kind === 'U' || ph.kind === 'L') pushText(ph.text);
      else out.push({ type: 'atom', text: ph.text, placeholder: ph });
    }
  }
  if (stack.length > 0) throw new Error(`Unclosed tag ${stack[stack.length - 1]}`);
  return out;
}
