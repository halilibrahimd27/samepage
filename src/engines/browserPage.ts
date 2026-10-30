import { checkByBackTranslation, type ChromeTranslatorBridge } from './chromeBuiltin';
import { restoreInline, type InnerTag } from './plainText';
import type { SegmentRequest, SegmentResult, TranslationEngine } from './types';

/**
 * Single-word identifiers ("permutation_importance", "RQ3", URLs), short inline formulas ("κ")
 * and glossary terms travel as text: Google reads a no-translate span as a sentence break ("Biz
 * bunu kullanıyoruz. permutation_importance …"). Frozen numbers (⟦D⟧) too: as spans they cut
 * the retried sentence ("…katsayısı κ = 0,81 olarak hesaplanmıştır" → "…coefficient was
 * calculated. = 0,81 was calculated."); a number the engine changes again fails the restore, and
 * the retry with spans follows.
 */
function inlineIdentifiers(req: SegmentRequest): { text: string; inlined: InnerTag[] } {
  const inlined: InnerTag[] = [];
  const text = req.text.replace(/⟦([A-Z]\d+)⟧/g, (ph, id: string) => {
    const v = req.verbatim?.[id];
    if (!v || !/^\S+$/u.test(v)) return ph;
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
    // A mark on its word ends a sentence ("incelenmiştir⟦N1⟧. Ayrıntılar"): Google returns
    // "systems ⟦N1⟧.See". The mark goes back on the word, the sentence end gets its space.
    if (/\p{L}/u.test(src[i - 1] ?? '') && /\s/.test(tgt[j - 1] ?? ''))
      out = out.replace(new RegExp(`[ \\t]${escapeRe(ph)}`, 'u'), ph);
    const end = /^([.,;:!?])\s/u.exec(src.slice(i + ph.length));
    if (end)
      out = out.replace(new RegExp(`${escapeRe(ph)}${escapeRe(end[1]!)}(?=\\p{L})`, 'u'), `$& `);
    // A bracket opened by a formula ("anlamlıdır (⟦F2⟧ 0,01).") that Google turned into a
    // sentence end ("significant.⟦F2⟧ 0,01)."): the bracket comes back, the full stop after it.
    const now = untagged(out);
    const k = now.indexOf(ph);
    const closes = /^[^()]*\)/u.test(now.slice(k + ph.length));
    if (src[i - 1] === '(' && now[k - 1] !== '(' && closes)
      out = out.replace(new RegExp(`\\s*\\.?\\s*${escapeRe(ph)}`, 'u'), ` (${ph}`);
  }
  return unglue(source, out);
}

/** A label or cell without a full stop gets none ("Anlam korunmuş" → "The meaning has been preserved."). */
export function dropAddedFullStop(source: string, target: string): string {
  const src = untagged(source)
    .replace(/⟦[A-Z]\d+⟧/g, '')
    .trim();
  return /[.!?…:;]$/u.test(src) || !/[^.]\.$/u.test(target.trimEnd())
    ? target
    : target.trimEnd().slice(0, -1);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A sentence end glued to the next sentence, a number glued to the next word. */
const GLUED = [/(?<=[\p{Ll}\d)][.!?;:])(?=\p{Lu}\p{Ll})/u, /(?<=\d)(?=\p{Lu}\p{Ll}{3,})/u];

/**
 * Spaces Google dropped where its sentence breaks fell ("signifikant.p", "0,01Maschinelle"),
 * unless the source itself writes text that way.
 */
export function unglue(source: string, target: string): string {
  let out = target;
  for (const re of GLUED)
    if (!re.test(untagged(source))) out = out.replace(new RegExp(re.source, 'gu'), ' ');
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
    // sentence-level meaning check, 4: identifiers inline, 5: short formulas inline, 6: every
    // inline formula and LaTeX references as text, 7: frozen numbers as text, 8: brackets and full stops).
    model: 'browser-page-8',
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
      // Turkish puts the percent sign before the number; Google glues it to the word before
      // ("F1 skoru%94,2'lik").
      const fix = (t: string) =>
        ctx.pair.target === 'tr' ? t.replace(/(\p{L})%(?=\d)/gu, '$1 %') : t;
      return batch.map((s, i) => ({ id: s.id, text: dropAddedFullStop(s.text, fix(out[i]!)) }));
    },
  };
}
