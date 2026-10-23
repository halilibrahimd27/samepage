import { tokenize } from '../core/segment/codec';
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
const FILLER = ['ŝåmрļé', 'ţéхţ', 'ğļурħ', 'çövеr', 'Ŵörđ', 'ļоņğ', 'ƒіļļ'];

function substitute(text: string): string {
  let out = '';
  for (const ch of text) out += LOOKALIKE[ch] ?? ch;
  return out;
}

/** Deterministic pseudo-translation preserving tags, placeholders and numbers exactly. */
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
  // At least one filler word, so short outputs such as "[5]" never look like citations.
  let filler = ` ${FILLER[0]}`;
  for (let i = 1; visible + 2 + filler.length < targetLen; i++) {
    filler += ` ${FILLER[i % FILLER.length]}`;
  }
  return `[${body}${filler}]`;
}

/** Shortens a pseudo translation by dropping filler words first (deterministic). */
export function pseudoCondense(current: string, maxChars: number): string {
  if (current.length <= maxChars) return current;
  const fillerTail = new RegExp(`(?: (?:${FILLER.join('|')}))+\\]$`, 'u');
  const words = current.match(fillerTail)?.[0].slice(0, -1).trim().split(' ') ?? [];
  let result = current;
  while (words.length > 0 && result.length > maxChars) {
    words.pop();
    result = current.replace(fillerTail, `${words.length ? ' ' + words.join(' ') : ''}]`);
  }
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
