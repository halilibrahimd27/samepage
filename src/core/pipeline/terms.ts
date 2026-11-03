import type { TranslateContext, TranslationEngine } from '../../engines/types';
import {
  confirmVariance,
  termVariance,
  type TermPair,
  type TermVariance,
} from '../glossary/consistency';
import type { GlossaryEntry } from '../validate/validate';

/**
 * Terms of a translated document rendered two ways, as the engine confirms them: its own
 * translation of the term, and each rendering translated back. An engine that cannot answer, or
 * fails, leaves the list empty: a term is shown only when confirmed.
 */
export async function termsRenderedTwoWays(
  engine: TranslationEngine,
  ctx: TranslateContext,
  pairs: TermPair[],
  glossary: GlossaryEntry[],
  signal: AbortSignal,
): Promise<TermVariance[]> {
  const candidates = termVariance(pairs, ctx.pair.source, ctx.pair.target, glossary);
  if (!candidates.length) return [];
  const reversed = { ...ctx, pair: { source: ctx.pair.target, target: ctx.pair.source } };
  const viaEngine = async (texts: string[], c: TranslateContext) => {
    const out = await engine.translate(
      texts.map((text, i) => ({ id: `term${i}`, text, role: 'label' as const })),
      c,
      signal,
    );
    const byId = new Map(out.map((r) => [r.id, r.text]));
    return texts.map((_, i) => byId.get(`term${i}`) ?? '');
  };
  const back = engine.translateBack
    ? (texts: string[]) => engine.translateBack!(texts, ctx, signal)
    : engine.capabilities.glossary
      ? (texts: string[]) => viaEngine(texts, reversed)
      : undefined;
  try {
    return await confirmVariance(candidates, ctx.pair.source, ctx.pair.target, {
      forward: (texts) => viaEngine(texts, ctx),
      ...(back ? { back } : {}),
    });
  } catch {
    signal.throwIfAborted();
    return [];
  }
}
