import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pseudoCondense, pseudoTranslate } from '../../src/engines/pseudo';
import { validateTranslation } from '../../src/core/validate/validate';

/** Random tagged segments: words, numbers, balanced tags and placeholders. */
const segment = fc
  .array(
    fc.oneof(
      fc.stringMatching(/^[a-zA-Zçğışöü]{1,10}$/),
      fc.stringMatching(/^\d{1,4}(,\d{1,2})?$/),
      fc.constantFrom('⟦F1⟧', '⟦N1⟧', '⟦U1⟧'),
      fc.stringMatching(/^[a-z]{1,8}$/).map((w) => `<t1>${w}</t1>`),
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((parts) => {
    // Each tag/placeholder id must be unique in a segment.
    const seen = new Set<string>();
    return parts
      .filter(
        (p) =>
          (!p.startsWith('⟦') && !p.startsWith('<')) ||
          (!seen.has(p.slice(0, 4)) && seen.add(p.slice(0, 4))),
      )
      .join(' ');
  });

describe('pseudo engine', () => {
  it('preserves every tag, placeholder and number, deterministically', () => {
    fc.assert(
      fc.property(segment, fc.constantFrom(1.35, 1.6), (src, factor) => {
        const out = pseudoTranslate(src, { factor, substitute: true });
        expect(pseudoTranslate(src, { factor, substitute: true })).toBe(out);
        const issues = validateTranslation({
          source: src,
          target: out,
          sourceLang: 'tr',
          targetLang: 'en',
          checkLanguage: false,
        });
        expect(issues.filter((i) => i.code !== 'LENGTH_RATIO')).toEqual([]);
        expect(out.length).toBeGreaterThanOrEqual(Math.round(src.length * factor) - 8);
      }),
    );
  });

  it('identity mode returns the source unchanged; condense drops filler first', () => {
    expect(pseudoTranslate('Merhaba <t1>dünya</t1> ⟦F1⟧', { factor: 1, substitute: false })).toBe(
      'Merhaba <t1>dünya</t1> ⟦F1⟧',
    );
    const long = pseudoTranslate('kısa metin burada', { factor: 1.6, substitute: true });
    const short = pseudoCondense(long, 20);
    expect(short.length).toBeLessThan(long.length);
    expect(short.startsWith('[kışå')).toBe(true);
  });
});
