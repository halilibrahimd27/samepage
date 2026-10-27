import { checkByBackTranslation, type ChromeTranslatorBridge } from './chromeBuiltin';
import { restoreInline, type InnerTag } from './plainText';
import type { SegmentRequest, SegmentResult, TranslationEngine } from './types';

/**
 * Single-word identifiers ("permutation_importance", "RQ3", URLs) and glossary terms travel as
 * text: Google reads a no-translate span as a sentence break ("Biz bunu kullanıyoruz.
 * permutation_importance …"). Frozen numbers (⟦D⟧) stay spans — they are frozen because the
 * engine changed them.
 */
function inlineIdentifiers(req: SegmentRequest): { text: string; inlined: InnerTag[] } {
  const inlined: InnerTag[] = [];
  const text = req.text.replace(/⟦([A-Z]\d+)⟧/g, (ph, id: string) => {
    const v = req.verbatim?.[id];
    if (!v || id.startsWith('D') || !/^\S+$/u.test(v)) return ph;
    inlined.push({ id, text: v });
    return v;
  });
  return { text, inlined };
}

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
    // sentence-level meaning check, 4: identifiers inline).
    model: 'browser-page-4',
    // Each batch must fit on one screen of the translation helper (ADR-021) in tiny type.
    maxBatchChars: 12_000,
    isAvailable: (pair) => bridge.availability(pair),
    checkFidelity: (pairs, ctx, signal) => checkByBackTranslation(bridge, pairs, ctx, signal),
    async translate(batch, ctx, signal): Promise<SegmentResult[]> {
      const prepared = batch.map(inlineIdentifiers);
      const first = await bridge.translate(
        ctx.pair,
        prepared.map((p) => p.text),
      );
      signal.throwIfAborted();
      const out = batch.map((s, i): string | null => {
        const { inlined } = prepared[i]!;
        const text = first[i] ?? '';
        const restored = inlined.length ? restoreInline(text, inlined) : text;
        return restored === null ? null : respacePlaceholders(s.text, restored);
      });
      // An identifier the engine changed: the segment again, identifiers as no-translate spans.
      const again = out.flatMap((t, i) => (t === null ? [i] : []));
      if (again.length) {
        const texts = await bridge.translate(
          ctx.pair,
          again.map((i) => batch[i]!.text),
        );
        signal.throwIfAborted();
        again.forEach((i, k) => (out[i] = respacePlaceholders(batch[i]!.text, texts[k] ?? '')));
      }
      return batch.map((s, i) => ({ id: s.id, text: out[i]! }));
    },
  };
}
