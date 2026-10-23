import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { loadFaces } from '../../src/pdf/engine';
import { translatePdf } from '../../src/pdf/pipeline';

/** Layout fidelity thresholds (TESTING.md §4) on the corpus. */
const FIXTURES = ['one-column-basic', 'two-column', 'formulas-tables', 'colored-figures'];
const HARD = ['OUT_OF_BOUNDS', 'COLLISION', 'COLLATERAL_DAMAGE', 'RESIDUAL_SOURCE', 'MISSING_GLYPH', 'TEXT_NOT_EXTRACTABLE'];

describe.each([1.35, 1.6])('layout fidelity, pseudo ×%s', (factor) => {
  it('meets the thresholds', async () => {
    const faces = await loadFaces((f) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))));
    let units = 0;
    let green = 0;
    for (const name of FIXTURES) {
      const { report } = await translatePdf(new Uint8Array(readFileSync(`tests/corpus/pdf/${name}.pdf`)), {
        engine: createPseudoEngine({ factor, substitute: true }),
        pair: { source: 'tr', target: 'en' },
        glossary: [],
        numberLocalization: false,
        fidelityCheck: false,
        faces,
        maxPages: 50,
        dual: false,
        signal: new AbortController().signal,
      });
      units += report.units.length;
      green += report.units.filter((u) => u.score >= 90 && !u.layoutIssues.some((i) => i.severity === 'error')).length;
      const hard = report.issues.filter((i) => HARD.includes(i.code));
      if (factor < 1.5) expect(hard, name).toEqual([]);
      // Every remaining problem is reported against a unit with a recorded repair or fallback.
      for (const i of report.issues.filter((x) => x.unitId && x.severity === 'error')) {
        const u = report.units.find((x) => x.id === i.unitId)!;
        expect(u.fallback ?? u.status, `${name} ${i.code}`).toBeTruthy();
      }
    }
    if (factor < 1.5) expect(green / units).toBeGreaterThanOrEqual(0.95);
    faces.destroy();
  }, 600_000);
});
