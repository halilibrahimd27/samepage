import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { loadFaces } from '../../src/pdf/engine';
import { extractAndAnalyze, blockText } from '../../src/pdf/analyze';
import { createOcr, type OcrLoader, type TessFactory } from '../../src/pdf/ocr/tesseract';
import { translatePdf } from '../../src/pdf/pipeline';

/** The same engine and models as in the browser, read from node_modules. */
const nodeLoader: OcrLoader = {
  async core() {
    const mod = (await import('tesseract.js-core/tesseract-core-simd-lstm.js')) as {
      default: TessFactory;
    };
    return { factory: mod.default };
  },
  model: (lang) =>
    Promise.resolve(
      new Uint8Array(
        gunzipSync(
          readFileSync(`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`),
        ),
      ),
    ),
};
const ocr = { engine: () => createOcr(['tr', 'en'], nodeLoader) };
const scanned = () => new Uint8Array(readFileSync('tests/corpus/pdf/scanned.pdf'));

describe('scanned PDF (OCR)', () => {
  it('reads the scan as text paragraphs with the original wording', async () => {
    expect((await extractAndAnalyze(scanned(), 5)).flatMap((p) => p.blocks)).toEqual([]);
    const [page] = await extractAndAnalyze(scanned(), 5, ocr);
    expect(page!.ocr!.confidence).toBeGreaterThan(85);
    const text = page!.blocks.map(blockText).join('\n');
    expect(text).toContain('Türkçe Akademik Metinlerde Anlam Kayması');
    expect(text).toContain('Bu çalışmada makine çevirisinde anlam kaymasının');
  }, 120_000);

  it('translates the scan and covers the recognised text', async () => {
    const faces = await loadFaces((f) =>
      Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))),
    );
    const { mono, report } = await translatePdf(scanned(), {
      engine: createPseudoEngine({ factor: 1.2, substitute: true }),
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      faces,
      maxPages: 5,
      dual: false,
      signal: new AbortController().signal,
      ocr,
    });
    expect(report.summary.translated).toBeGreaterThan(3);
    expect(report.summary.untranslated).toBe(0);
    expect(report.issues.filter((i) => i.code === 'COLLATERAL_DAMAGE')).toEqual([]);
    // The output has a text layer now: the translation reads back from it.
    const [out] = await extractAndAnalyze(mono, 5);
    expect(out!.blocks.length).toBeGreaterThan(3);
    faces.destroy();
  }, 300_000);
});
