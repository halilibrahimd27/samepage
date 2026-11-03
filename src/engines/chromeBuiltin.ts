import { tokenize } from '../core/segment/codec';
import {
  confineTags,
  dropAddedFullStop,
  inCapitals,
  reattachTags,
  restoreSigns,
  sentenceCase,
} from './browserPage';
import { backTranslationFindings, cueText, inSourceLanguage } from '../core/validate/meaning';
import {
  assemblePieces,
  matchInitialCase,
  pieceTexts,
  planPieces,
  splitClauses,
  splitSentences,
} from './plainText';
import type {
  Availability,
  FidelityPair,
  FidelityResult,
  LangPair,
  SegmentResult,
  TranslateContext,
  TranslationEngine,
} from './types';

/**
 * Chrome's Translator API exists only on the main thread, so the worker talks to it through
 * this bridge (implemented in src/app/bridges/chromeTranslator.ts, passed via Comlink).
 */
export interface ChromeTranslatorBridge {
  availability(pair: LangPair): Promise<Availability>;
  translate(pair: LangPair, texts: string[]): Promise<string[]>;
  /**
   * Translation for the back-translation check, only when it needs no user action (no model
   * download, no manual sheet); null otherwise.
   */
  backTranslate?(pair: LangPair, texts: string[]): Promise<string[] | null>;
  /**
   * The browser's own language model, when the user polishes on the device: the model's answer
   * to `user` under the instructions `system`, shaped by `schema`; null when it cannot answer.
   */
  revise?(pair: LangPair, system: string, user: string, schema: object): Promise<string | null>;
}

/** Back-translation meaning check (ADR-022) shared by the machine-translation engines. */
/** Texts back into the source language through the bridge (empty strings when it cannot). */
export async function backThrough(
  bridge: ChromeTranslatorBridge,
  texts: string[],
  ctx: TranslateContext,
  signal: AbortSignal,
): Promise<string[]> {
  const back = await bridge
    .backTranslate?.({ source: ctx.pair.target, target: ctx.pair.source }, texts)
    .catch(() => null);
  signal.throwIfAborted();
  return texts.map((_, i) => back?.[i] ?? '');
}

export async function checkByBackTranslation(
  bridge: ChromeTranslatorBridge,
  pairs: FidelityPair[],
  ctx: TranslateContext,
  signal: AbortSignal,
): Promise<FidelityResult> {
  const { source, target } = ctx.pair;
  const back = await bridge
    .backTranslate?.(
      { source: target, target: source },
      pairs.map((p) => cueText(p.target, p.verbatim)),
    )
    .catch(() => null);
  signal.throwIfAborted();
  if (!back) return { findings: [] };
  const kept = pairs.flatMap((p, i) => {
    const text = back[i]?.trim();
    return text && inSourceLanguage(text, source, target) ? [[p.id, text] as const] : [];
  });
  return {
    findings: backTranslationFindings(pairs, back, source, target),
    back: Object.fromEntries(kept),
  };
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
  const plain = plainEngine(bridge);
  return {
    ...plain,
    async translate(given, ctx, signal): Promise<SegmentResult[]> {
      const lang = ctx.pair.target;
      // A label in capitals goes in sentence case and comes back in capitals, as with Google:
      // the model read "GİRİŞ · PROBLEM" as a name ("Login Problem").
      const caps = given.map((s) =>
        sentenceCase(s.text, ctx.pair.source, ctx.retryFeedback !== undefined),
      );
      const batch = given.map((s, i) => (caps[i] ? { ...s, text: caps[i] } : s));
      const results = await plain.translate(batch, ctx, signal);
      // The repairs of Google's answers fit the model's too: a mark it moved its span off, a
      // span stretched over the sentence, a full stop added to a label.
      return results.map((r, i) => {
        if (!r?.text) return r;
        const source = given[i]!.text;
        const text = dropAddedFullStop(
          source,
          reattachTags(source, restoreSigns(source, confineTags(source, r.text))),
        );
        return { ...r, text: caps[i] ? inCapitals(text, lang) : text };
      });
    },
  };
}

function plainEngine(bridge: ChromeTranslatorBridge): TranslationEngine {
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
      fidelityCheck: true,
    },
    model: 'chrome-translator-2',
    maxBatchChars: 4000,
    isAvailable: (pair) => bridge.availability(pair),
    checkFidelity: (pairs, ctx, signal) => checkByBackTranslation(bridge, pairs, ctx, signal),
    translateBack: (texts, ctx, signal) => backThrough(bridge, texts, ctx, signal),

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
