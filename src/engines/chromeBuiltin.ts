import { tokenize } from '../core/segment/codec';
import {
  assemblePieces,
  matchInitialCase,
  pieceTexts,
  planPieces,
  splitClauses,
  splitSentences,
} from './plainText';
import type { Availability, LangPair, SegmentResult, TranslationEngine } from './types';

/**
 * Chrome's Translator API exists only on the main thread, so the worker talks to it through
 * this bridge (implemented in src/app/bridges/chromeTranslator.ts, passed via Comlink).
 */
export interface ChromeTranslatorBridge {
  availability(pair: LangPair): Promise<Availability>;
  translate(pair: LangPair, texts: string[]): Promise<string[]>;
}

const tagIds = (t: string) =>
  tokenize(t)
    .filter((x) => x.type === 'open')
    .map((x) => (x as { id: string }).id)
    .sort();
const phIds = (t: string) =>
  tokenize(t)
    .filter((x) => x.type === 'ph')
    .map((x) => (x as { id: string }).id)
    .sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function structureKept(source: string, target: string): boolean {
  const stack: string[] = [];
  for (const t of tokenize(target)) {
    if (t.type === 'open') stack.push(t.id);
    if (t.type === 'close' && stack.pop() !== t.id) return false;
  }
  return (
    stack.length === 0 && same(tagIds(source), tagIds(target)) && same(phIds(source), phIds(target))
  );
}

export function createChromeEngine(bridge: ChromeTranslatorBridge): TranslationEngine {
  return {
    id: 'chrome-builtin',
    label: 'Chrome built-in translator',
    runsOn: 'main',
    privacy: 'on-device',
    capabilities: {
      glossary: false,
      lengthBudget: false,
      tagsReliable: false,
      condense: false,
      vision: false,
      fidelityCheck: false,
    },
    model: 'chrome-translator',
    maxBatchChars: 4000,
    isAvailable: (pair) => bridge.availability(pair),

    /**
     * First the tagged text as is; segments whose tags or placeholders did not survive are
     * translated again piece by piece (plainText.ts), which keeps every placeholder. When the
     * pipeline retries a segment that failed validation (a dropped citation or number), each
     * piece is translated sentence by sentence, and on the last retry clause by clause — the
     * on-device model drops content from long inputs, shorter ones come back complete.
     */
    async translate(batch, ctx, signal): Promise<SegmentResult[]> {
      const lang = ctx.pair.target;
      const retrying = ctx.retryFeedback !== undefined;
      // The last retry (one segment alone) goes down to clauses.
      const clauses = retrying && batch.length === 1;
      const split = (t: string) =>
        !retrying ? [t] : splitSentences(t).flatMap((x) => (clauses ? splitClauses(x) : [x]));
      const first = retrying
        ? []
        : await bridge.translate(
            ctx.pair,
            batch.map((s) => s.text),
          );
      signal.throwIfAborted();
      const results: SegmentResult[] = [];
      const retry: number[] = [];
      batch.forEach((s, i) => {
        const text = first[i] ?? '';
        if (text.trim() && structureKept(s.text, text)) {
          results[i] = {
            id: s.id,
            text: matchInitialCase(s.text, text, lang),
            notes: tagIds(s.text).length > 0 ? ['tags-survived'] : [],
          };
        } else {
          retry.push(i);
        }
      });
      if (retry.length) {
        // Identifiers travel inline first; a segment whose identifier the engine changed is
        // translated again with the text cut at its placeholders.
        const run = async (indices: number[], soft: boolean) => {
          const plans = indices.map((i) =>
            planPieces(batch[i]!.text, soft ? batch[i]!.verbatim : undefined),
          );
          const parts = plans.map((p) => pieceTexts(p).map(split));
          const answers = await bridge.translate(ctx.pair, parts.flat(2));
          signal.throwIfAborted();
          let k = 0;
          const lost: number[] = [];
          indices.forEach((i, n) => {
            const plan = plans[n]!;
            const joined = parts[n]!.map((sentences) => {
              const out = answers.slice(k, k + sentences.length);
              k += sentences.length;
              return out.some((a) => !a.trim()) ? '' : out.map((a) => a.trim()).join(' ');
            });
            const built = assemblePieces(plan, joined, lang, ctx.pair.source);
            if (!built && soft && batch[i]!.verbatim) {
              lost.push(i);
              return;
            }
            const notes = ['pieces'];
            if (parts[n]!.some((p) => p.length > 1)) notes.push(clauses ? 'clauses' : 'sentences');
            if (built?.lostTags.length) notes.push('style-approximated');
            if (plan.keptVerbatim) notes.push('kept-verbatim');
            results[i] = { id: batch[i]!.id, text: built?.text ?? '', notes };
          });
          return lost;
        };
        const lost = await run(retry, true);
        if (lost.length) await run(lost, false);
      }
      return results;
    },
  };
}
