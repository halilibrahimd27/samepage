import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { loadFaces } from '../../src/pdf/engine';
import { translatePdf } from '../../src/pdf/pipeline';

/** P9.6: reference entries stay as published; titles in another language get brackets. */
describe('PDF reference titles in brackets', () => {
  it('brackets the Turkish and German titles, leaves the English one, fits the page', async () => {
    const faces = await loadFaces((f) =>
      Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))),
    );
    const run = (referenceTitles: boolean) =>
      translatePdf(new Uint8Array(readFileSync('tests/corpus/pdf/references.pdf')), {
        engine: createPseudoEngine({ factor: 1, substitute: true }),
        pair: { source: 'tr', target: 'en' },
        glossary: [],
        numberLocalization: false,
        fidelityCheck: false,
        faces,
        maxPages: 5,
        dual: false,
        referenceTitles,
        signal: new AbortController().signal,
      });
    const off = await run(false);
    const { report } = await run(true);
    faces.destroy();

    expect(off.report.units.filter((u) => u.role === 'reference')).toEqual([]);
    const refs = report.units.filter((u) => u.role === 'reference');
    const text = refs.map((u) => u.target).join(' ');
    // The title's translation follows the title, before its period.
    expect(text).toMatch(/parametrik analizi \[.+?\]\. Fırat Üniversitesi/);
    expect(text).toMatch(/Wissenschaftssprache \[.+?\]\. Zeitschrift/);
    expect(text).toMatch(/terim tutarlılığı \[.+?\]\. Ankara/);
    // English titles are not touched.
    expect(text).toMatch(/Statistical machine translation\. Cambridge/);
    const hard = report.issues.filter((i) =>
      ['OUT_OF_BOUNDS', 'COLLISION', 'RESIDUAL_SOURCE', 'TEXT_NOT_EXTRACTABLE'].includes(i.code),
    );
    expect(hard).toEqual([]);
  }, 300_000);
});
