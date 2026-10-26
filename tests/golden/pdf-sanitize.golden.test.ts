import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { loadFaces } from '../../src/pdf/engine';
import { translatePdf } from '../../src/pdf/pipeline';

it('removes document JavaScript and open actions from the output and reports them', async () => {
  const faces = await loadFaces((f) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))));
  const { mono, report } = await translatePdf(new Uint8Array(readFileSync('tests/corpus/pdf/javascript.pdf')), {
    engine: createPseudoEngine({ factor: 1.35, substitute: true }),
    pair: { source: 'tr', target: 'en' },
    glossary: [],
    numberLocalization: false,
    fidelityCheck: false,
    faces,
    maxPages: 50,
    dual: false,
    signal: new AbortController().signal,
  });
  faces.destroy();
  expect(report.sanitization.removed).toEqual(expect.arrayContaining(['document open action (JavaScript)', 'document-level JavaScript']));
  const text = new TextDecoder('latin1').decode(mono);
  expect(text).not.toContain('/JavaScript');
  expect(text).not.toContain('app.alert');
}, 120_000);

it('translates bookmarks and honours the page range', async () => {
  const { readOutlineAndTitle } = await import('../../src/pdf/engine');
  const faces = await loadFaces((f) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))));
  const input = new Uint8Array(readFileSync('tests/corpus/pdf/one-column-basic.pdf'));
  const { mono, report } = await translatePdf(input, {
    engine: createPseudoEngine({ factor: 1.35, substitute: true }),
    pair: { source: 'tr', target: 'en' },
    glossary: [],
    numberLocalization: false,
    fidelityCheck: false,
    faces,
    maxPages: 50,
    dual: false,
    translateMetadata: true,
    pageRange: { from: 1, to: 1 },
    signal: new AbortController().signal,
  });
  faces.destroy();
  const before = await readOutlineAndTitle(input);
  const after = await readOutlineAndTitle(mono);
  expect(before.outline.length).toBeGreaterThan(0);
  expect(after.outline).toHaveLength(before.outline.length);
  expect(after.outline[0]).toMatch(/^\[/);
  // Only units entirely on page 2 were translated.
  expect(report.units.every((u) => u.pages.every((p) => p === 1))).toBe(true);
}, 120_000);

it('refuses malformed and encrypted PDFs politely', async () => {
  const { inspectPdf } = await import('../../src/pdf/engine');
  const malformed = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> garbage');
  const result = await inspectPdf(malformed, { maxPages: 500, thumbnailWidth: 100 });
  expect(result.ok ? 'ok' : result.reason).toBe('corrupt');
  const encrypted = await inspectPdf(new Uint8Array(readFileSync('tests/corpus/pdf/encrypted.pdf')), { maxPages: 500, thumbnailWidth: 100 });
  expect(encrypted.ok ? 'ok' : encrypted.reason).toBe('encrypted');
});

it('handles pages without annotations and Type 3 fonts, also side by side (regressions)', async () => {
  // Minimal hand-written PDF (MuPDF repairs the missing xref): no /Annots, no /Names, and a
  // Type 3 font like the bitmap fonts of LaTeX/arXiv papers.
  const pdf = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    '5 0 obj << /Length 98 >> stream',
    'BT /F1 12 Tf 20 100 Td (Bu kisa bir deneme metnidir.) Tj ET BT /F2 10 Tf 20 40 Td (aaa) Tj ET',
    'endstream endobj',
    '6 0 obj << /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a 7 0 R >> /Encoding << /Type /Encoding /Differences [97 /a] >> /FirstChar 97 /LastChar 97 /Widths [1000] /Resources << >> >> endobj',
    '7 0 obj << /Length 44 >> stream',
    '1000 0 0 0 1000 1000 d1 0 0 1000 1000 re f',
    'endstream endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
  const { inspectPdf } = await import('../../src/pdf/engine');
  const faces = await loadFaces((f) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))));
  const { report, dual } = await translatePdf(new TextEncoder().encode(pdf), {
    engine: createPseudoEngine({ factor: 1.2, substitute: true }),
    pair: { source: 'tr', target: 'en' },
    glossary: [],
    numberLocalization: false,
    fidelityCheck: false,
    faces,
    maxPages: 50,
    dual: true,
    signal: new AbortController().signal,
  });
  faces.destroy();
  expect(report.units.length).toBeGreaterThan(0);
  expect(report.sanitization.removed).toEqual([]);
  const side = await inspectPdf(dual!, { maxPages: 10, thumbnailWidth: 300 });
  expect(side.ok && side.pageCount).toBe(1);
  expect(side.ok && side.thumbnail.height).toBe(100); // 600 × 200 page scaled to 300 wide
}, 120_000);
