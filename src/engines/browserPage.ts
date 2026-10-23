import type { ChromeTranslatorBridge } from './chromeBuiltin';
import type { SegmentResult, TranslationEngine } from './types';

/**
 * `browser` engine (ADR-015): the browser's own page translation, driven through a main-thread
 * bridge. Tags and placeholders travel as DOM spans, so the returned text is tagged text.
 */
export function createBrowserPageEngine(bridge: ChromeTranslatorBridge): TranslationEngine {
  return {
    id: 'browser',
    label: 'Browser translation',
    runsOn: 'main',
    privacy: 'browser-vendor',
    capabilities: {
      glossary: false,
      lengthBudget: false,
      tagsReliable: false,
      condense: false,
      vision: false,
      fidelityCheck: false,
    },
    model: 'browser-page',
    // Large batches: the user triggers translation once; later batches translate automatically.
    maxBatchChars: 200_000,
    isAvailable: (pair) => bridge.availability(pair),
    async translate(batch, ctx, signal): Promise<SegmentResult[]> {
      const texts = await bridge.translate(
        ctx.pair,
        batch.map((s) => s.text),
      );
      signal.throwIfAborted();
      return batch.map((s, i) => ({ id: s.id, text: texts[i] ?? '' }));
    },
  };
}
