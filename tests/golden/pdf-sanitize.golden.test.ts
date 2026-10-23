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
