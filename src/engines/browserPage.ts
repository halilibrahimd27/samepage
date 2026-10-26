import { checkByBackTranslation, type ChromeTranslatorBridge } from './chromeBuiltin';
import type { SegmentResult, TranslationEngine } from './types';

const untagged = (t: string) => t.replace(/<\/?t\d+>/g, '');

/**
 * Google drops the spaces around placeholders it must not translate ("Yaklaşım⟦U1⟧Paketler").
 * A space is put back on each side where the source had one and the translation glued the
 * placeholder to a word; Turkish suffixes after an apostrophe ("⟦U1⟧'de") and punctuation stay.
 */
export function respacePlaceholders(source: string, target: string): string {
  let out = target;
  for (const [ph] of source.matchAll(/⟦[A-Z]\d+⟧/g)) {
    const src = untagged(source);
    const i = src.indexOf(ph);
    const tgt = untagged(out);
    const j = tgt.indexOf(ph);
    if (j < 0) continue;
    const before = tgt[j - 1];
    if (/\s/.test(src[i - 1] ?? '') && before && !/[\s([{“"‘'/-]/u.test(before))
      out = out.replace(ph, ` ${ph}`);
    const after = tgt[j + ph.length];
    if (/\s/.test(src[i + ph.length] ?? '') && after && /[\p{L}\p{N}([{“]/u.test(after))
      out = out.replace(ph, `${ph} `);
  }
  return out;
}

/**
 * `browser` engine (ADR-015, ADR-021): Google's website translator in a helper frame, or the
 * browser's own page translation, driven through a main-thread bridge. Tags and placeholders
 * travel as DOM spans, so the returned text is tagged text.
 */
export function createBrowserPageEngine(bridge: ChromeTranslatorBridge): TranslationEngine {
  return {
    id: 'browser',
    label: 'Google Translate',
    runsOn: 'main',
    privacy: 'browser-vendor',
    capabilities: {
      glossary: false,
      lengthBudget: false,
      tagsReliable: false,
      condense: false,
      vision: false,
      fidelityCheck: true,
    },
    // Part of the cache key: bumped when results change (2: spaces around placeholders, 3:
    // sentence-level meaning check).
    model: 'browser-page-3',
    // Each batch must fit on one screen of the translation helper (ADR-021) in tiny type.
    maxBatchChars: 12_000,
    isAvailable: (pair) => bridge.availability(pair),
    checkFidelity: (pairs, ctx, signal) => checkByBackTranslation(bridge, pairs, ctx, signal),
    async translate(batch, ctx, signal): Promise<SegmentResult[]> {
      const texts = await bridge.translate(
        ctx.pair,
        batch.map((s) => s.text),
      );
      signal.throwIfAborted();
      return batch.map((s, i) => ({ id: s.id, text: respacePlaceholders(s.text, texts[i] ?? '') }));
    },
  };
}
