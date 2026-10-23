import { plainText, tokenize } from '../core/segment/codec';
import type { CondenseRequest, SegmentRequest, SegmentResult, TranslationEngine } from './types';

export interface PseudoOptions {
  /** Length expansion factor (default 1.35, stress 1.6). 1.0 + substitute:false = identity. */
  factor: number;
  /** Replace letters with look-alikes that exercise glyph coverage. */
  substitute: boolean;
}

const LOOKALIKE: Record<string, string> = {
  a: 'å',
  c: 'ç',
  e: 'е',
  g: 'ğ',
  i: 'ı',
  o: 'ö',
  p: 'р',
  s: 'ş',
  u: 'ü',
  y: 'у',
  A: 'Å',
  C: 'Ç',
  E: 'É',
  G: 'Ğ',
  I: 'İ',
  O: 'Ö',
  S: 'Ş',
  U: 'Ü',
};
/** Filler words appended to reach the expansion factor (breakable, glyph-diverse). */
/** Filler groups (breakable): tildes in groups of at most 7, so lines can still break. */
const GROUP = 7;
function filler(chars: number): string {
  let out = '';
  while (chars > 1) {
    const n = Math.min(GROUP, chars - 1);
    out += ` ${'~'.repeat(n)}`;
    chars -= n + 1;
  }
  return out;
}

function substitute(text: string): string {
  let out = '';
  for (const ch of text) out += LOOKALIKE[ch] ?? ch;
  return out;
}

/**
 * Deterministic pseudo-translation preserving tags, placeholders and numbers exactly:
 * look-alike letters, brackets, and "~" filler up to the expansion factor (`[Ŕéşüļţş ~~~]`).
 */
export function pseudoTranslate(source: string, opts: PseudoOptions): string {
  const identity = opts.factor === 1 && !opts.substitute;
  if (identity || source.trim() === '') return source;
  let body = '';
  for (const tok of tokenize(source)) {
    if (tok.type === 'text') body += opts.substitute ? substitute(tok.text) : tok.text;
    else
      body +=
        tok.type === 'open' ? `<${tok.id}>` : tok.type === 'close' ? `</${tok.id}>` : `⟦${tok.id}⟧`;
  }
  const visible = source.length;
  const targetLen = Math.round(visible * opts.factor);
  // A letterless segment gets some filler, so "[5]" never looks like a citation.
  const missing = Math.max(targetLen - (visible + 2), /\p{L}/u.test(plainText(source)) ? 0 : 4);
  return `[${body}${filler(missing)}]`;
}

/** Shortens a pseudo translation by dropping filler first (deterministic). */
export function pseudoCondense(current: string, maxChars: number): string {
  let result = current;
  while (result.length > maxChars && / ~+\]$/.test(result)) result = result.replace(/ ~+\]$/, ']');
  return result;
}

export function createPseudoEngine(
  opts: PseudoOptions = { factor: 1.35, substitute: true },
): TranslationEngine {
  return {
    id: 'pseudo',
    label: 'Pseudo (test)',
    runsOn: 'worker',
    privacy: 'on-device',
    capabilities: {
      glossary: false,
      lengthBudget: false,
      tagsReliable: true,
      condense: true,
      vision: false,
      fidelityCheck: false,
    },
    model: `pseudo-x${opts.factor}${opts.substitute ? '' : '-nosub'}`,
    maxBatchChars: 100_000,
    isAvailable: () => Promise.resolve('available'),
    translate(batch: SegmentRequest[], _ctx, signal): Promise<SegmentResult[]> {
      signal.throwIfAborted();
      return Promise.resolve(batch.map((s) => ({ id: s.id, text: pseudoTranslate(s.text, opts) })));
    },
    condense(req: CondenseRequest, signal): Promise<string> {
      signal.throwIfAborted();
      return Promise.resolve(pseudoCondense(req.current, req.maxChars));
    },
  };
}
