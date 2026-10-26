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
 * URLs, DOIs, arXiv ids, e-mail addresses and snake_case identifiers (`has_long_str`,
 * `n_estimators`) are never translated (⟦U…⟧).
 */
const URL_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>⟦⟧]+[^\s<>⟦⟧.,;:!?)\]}'"]|\b10\.\d{4,9}\/[^\s<>⟦⟧]+[^\s<>⟦⟧.,;:!?)\]}'"]|\barXiv:\d{4}\.\d{4,5}(?:v\d+)?\b|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/gi;

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
  const protect = (text: string) =>
    text
      .replace(LITERAL_RE, (lit) => addPlaceholder('L', lit))
      .replace(URL_RE, (url) => addPlaceholder('U', url));

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
