import type { ChromeTranslatorBridge } from './chromeBuiltin';
import {
  postEditSystemPrompt,
  postEditUserMessage,
  TRANSLATION_SCHEMA,
  unescapeXml,
} from './prompt';
import { EngineError, type SegmentResult, type TranslationEngine } from './types';

/**
 * The browser's own language model as the post-editor (P9.3, free and on the device): it revises
 * what the meaning check flags, one item at a time — a small model keeps a short prompt — with
 * the same instructions Claude gets. Its revisions are validated like Claude's; one it cannot
 * give leaves the flagged translation and its finding as they were.
 */
export function createOnDeviceEditor(bridge: ChromeTranslatorBridge): TranslationEngine {
  return {
    // Chrome's own, as its translator; the model sets its revisions apart in the cache.
    id: 'chrome-builtin',
    label: 'Chrome built-in AI',
    runsOn: 'main',
    privacy: 'on-device',
    capabilities: {
      glossary: true,
      lengthBudget: false,
      tagsReliable: false,
      condense: false,
      vision: false,
      fidelityCheck: false,
    },
    model: 'gemini-nano',
    maxBatchChars: 2000,
    isAvailable: () => Promise.resolve('available'),
    translate() {
      return Promise.reject(new EngineError('unavailable', 'The on-device model only revises.'));
    },
    async postEdit(items, ctx, signal) {
      if (!bridge.revise) return [];
      const system = postEditSystemPrompt(ctx);
      const out: SegmentResult[] = [];
      for (const item of items) {
        signal.throwIfAborted();
        const answer = await bridge
          .revise(ctx.pair, system, postEditUserMessage([item]), TRANSLATION_SCHEMA)
          .catch(() => null);
        if (!answer) continue;
        try {
          const parsed = JSON.parse(answer) as { segments?: { id?: unknown; text?: unknown }[] };
          const s = parsed.segments?.find((x) => x.id === item.id) ?? parsed.segments?.[0];
          if (typeof s?.text === 'string' && s.text.trim())
            out.push({ id: item.id, text: unescapeXml(s.text) });
        } catch {
          // Not the JSON asked for: the flagged translation stays.
        }
      }
      return out;
    },
  };
}
