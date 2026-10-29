import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { protectTerms, restoreTerms, withBuiltInNames } from '../../src/core/glossary/protect';
import { translateSegments } from '../../src/core/pipeline/translate';
import { keepNumberSpelling } from '../../src/core/validate/numbers';
import { createPseudoEngine } from '../../src/engines/pseudo';
import type { SegmentRequest, TranslationEngine } from '../../src/engines/types';

const protect = (text: string, glossary: { source: string; target: string }[] = []) =>
  protectTerms(text, withBuiltInNames(glossary), 'en');

describe('built-in software names', () => {
  it('protects names whole-word and case-sensitive', () => {
    expect(protect('Python and npm on GitHub; pandas, NumPy.').text).toBe(
      '⟦G1⟧ and ⟦G2⟧ on ⟦G3⟧; ⟦G4⟧, ⟦G5⟧.',
    );
    for (const plain of [
      'The python is a snake.',
      'Pandas live in China.',
      'Javascript, Pythonic, Python3 and python.',
      'Time Windows and Go, R, Swift.',
      'See GPT-3.5 results.',
      'github.com/Python/x',
    ])
      expect(protect(plain).text, plain).toBe(plain);
    expect(protect('We use C++, C# and GPT-4.').text).toBe('We use ⟦G1⟧, ⟦G2⟧ and ⟦G3⟧.');
  });

  it('brings a name back exactly as written, even at a sentence start', () => {
    const p = protect('npm and PyPI are used.');
    expect(restoreTerms('⟦G1⟧ ve ⟦G2⟧ kullanılır.', p.targets, 'G', p.exact)).toBe(
      'npm ve PyPI kullanılır.',
    );
    const g = protectTerms('precision', [{ source: 'precision', target: 'kesinlik' }], 'en');
    expect(restoreTerms('⟦G1⟧ yüksek.', g.targets, 'G', g.exact)).toBe('Kesinlik yüksek.');
  });

  it('lets the user glossary win without protecting a name twice', () => {
    const entries = withBuiltInNames([{ source: 'python', target: 'piton' }]);
    expect(entries.filter((e) => e.source.toLowerCase() === 'python')).toHaveLength(1);
    const p = protectTerms('Python is not python.', entries, 'en');
    expect(p.targets).toEqual(['piton', 'piton']);
  });

  it('leaves names inside placeholders alone', () => {
    expect(protect('Install ⟦U1⟧ with npm.').text).toBe('Install ⟦U1⟧ with ⟦G1⟧.');
  });
});

/** A machine engine that translates the inlined names the way Google does ("Python" → "Piton"). */
function googleLike(
  seen: string[] = [],
  map: Record<string, string> = { Python: 'Piton', npm: 'NPM' },
): TranslationEngine {
  return {
    ...createPseudoEngine(),
    id: 'browser',
    capabilities: { ...createPseudoEngine().capabilities, glossary: false },
    translate(batch) {
      seen.push(...batch.map((b) => b.text));
      return Promise.resolve(
        batch.map((b) => ({
          id: b.id,
          // ⟦G1⟧ stands for the name; the engine mangles it only when it is shown in the text.
          text: b.text.replace(/⟦G(\d+)⟧/g, (m, n: string) => {
            const v = b.verbatim?.[`G${n}`] ?? m;
            return map[v] ?? v;
          }),
        })),
      );
    },
  };
}

const run = (segments: SegmentRequest[], engine: TranslationEngine, loc = false) =>
  translateSegments({
    engine,
    segments,
    ctx: { pair: { source: 'en', target: 'tr' }, glossary: [], numberLocalization: loc },
    cache: new MemoryCache(),
    signal: new AbortController().signal,
  });

describe('pipeline with a machine engine', () => {
  it('keeps built-in names for every segment, with no user glossary', async () => {
    const seen: string[] = [];
    const out = await run(
      [
        { id: 'h', text: 'Python', role: 'heading' },
        { id: 'b', text: 'npm and PyPI host packages.', role: 'body' },
      ],
      googleLike(seen, { Python: 'Piton', npm: 'NPM' }),
    );
    expect(seen).toContain('⟦G1⟧');
    expect(out.find((o) => o.id === 'h')?.text).toBe('Python');
    expect(out.find((o) => o.id === 'b')?.text).toBe('npm and PyPI host packages.');
  });
});

describe('number spelling', () => {
  it('restores the source spelling when the value is unambiguous', () => {
    expect(
      keepNumberSpelling('Accuracy 100.0±0.0 and 96.2±1.0.', 'Doğruluk 100,0±0,0 ve 96.2±1.0.'),
    ).toBe('Doğruluk 100.0±0.0 ve 96.2±1.0.');
    expect(keepNumberSpelling('We saw 31,292 cases.', 'Biz 31.292 vaka gördük.')).toBe(
      'Biz 31,292 vaka gördük.',
    );
  });

  it('leaves ambiguous, different or tagged numbers and percent signs', () => {
    // two source spellings of one value
    expect(keepNumberSpelling('1,5 and 1.5', 'a 1,5 b')).toBe('a 1,5 b');
    expect(keepNumberSpelling('Rate 81%', 'Oran %81')).toBe('Oran %81');
    expect(keepNumberSpelling('Value 3.5', 'Değer 3,6')).toBe('Değer 3,6');
    expect(keepNumberSpelling('Year 2020 and 2021', '<t12>2020</t12> ve ⟦N12⟧ 2021')).toBe(
      '<t12>2020</t12> ve ⟦N12⟧ 2021',
    );
  });

  it('applies in the pipeline for machine engines unless numbers are localised', async () => {
    const engine: TranslationEngine = {
      ...googleLike(),
      translate: (batch) =>
        Promise.resolve(batch.map((b) => ({ id: b.id, text: 'Sonuç 100,0±0,0 ve 31.292.' }))),
    };
    const seg: SegmentRequest = { id: 'a', text: 'Result 100.0±0.0 and 31,292.', role: 'body' };
    expect((await run([seg], engine)).find((o) => o.id === 'a')?.text).toBe(
      'Sonuç 100.0±0.0 ve 31,292.',
    );
    expect((await run([seg], engine, true)).find((o) => o.id === 'a')?.text).toBe(
      'Sonuç 100,0±0,0 ve 31.292.',
    );
  });
});
