import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { loadFaces } from '../../src/pdf/engine';
import { translatePdf } from '../../src/pdf/pipeline';

/** P9.4: the editable Word document of a translated PDF loses no text and keeps the structure. */
const CASES = [
  { file: 'tests/corpus/pdf/formulas-tables.pdf', name: 'formulas-tables', factor: 1.35 },
  { file: 'tests/corpus/pdf/two-column-floats.pdf', name: 'two-column-floats', factor: 1.35 },
  { file: 'media/demo-paper.pdf', name: 'demo-paper', factor: 1.35 },
  // Identity: the pseudo engine's brackets would hide where a footnote's mark is.
  { file: 'media/demo-paper.pdf', name: 'demo-paper-identity', factor: 1 },
];
// Letters only: footnote marks become Word's own numbered references.
const letters = (t: string) => t.replace(/[^\p{L}]/gu, '');

describe('editable Word output of PDFs', () => {
  it.each(CASES)('$name: every translated paragraph, table and figure is there', async ({ file, name, factor }) => {
    const faces = await loadFaces((f) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))));
    const { editable: asPdf, editableFlow: editable, report } = await translatePdf(new Uint8Array(readFileSync(file)), {
      engine: createPseudoEngine({ factor, substitute: factor > 1 }),
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      faces,
      maxPages: 50,
      dual: false,
      editable: true,
      signal: new AbortController().signal,
    });
    faces.destroy();
    expect(editable).not.toBeNull();
    mkdirSync('tests/golden/__out__', { recursive: true });
    writeFileSync(`tests/golden/__out__/${name}.editable.docx`, editable!);
    writeFileSync(`tests/golden/__out__/${name}.pages.docx`, asPdf!);

    const zip = await JSZip.loadAsync(editable!);
    const xml = await zip.file('word/document.xml')!.async('string');
    const notes = (await zip.file('word/footnotes.xml')?.async('string')) ?? '';
    const text = letters(
      [...(xml + notes).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
        .map((m) => m[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
        .join(''),
    );
    // Running text is never only in a picture: it reads as text in Word.
    const missing = report.units
      .filter((u) => ['body', 'heading', 'caption', 'footnote', 'reference', 'table-cell'].includes(u.role))
      .filter((u) => u.status !== 'untranslated' && u.target)
      .filter((u) => !text.includes(letters(u.target)));
    expect(missing.map((u) => `${u.id}: ${u.target.slice(0, 60)}`)).toEqual([]);
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    const pictures = Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !zip.files[f]!.dir);
    expect(pictures.length).toBeGreaterThan(0);
    for (const p of pictures) expect(xml).toContain(`name="${p.split('/').pop()}"`);
    if (name === 'formulas-tables') expect(xml).toContain('<w:tbl>');

    // Laid out as the PDF: a section per page, every translated word there as text too (a
    // paragraph on both sides of a table is in two frames). Untranslated, the page's own words
    // stay in its picture.
    const pagesXml = await (await JSZip.loadAsync(asPdf!)).file('word/document.xml')!.async('string');
    expect(pagesXml.match(/<w:sectPr>/g)).toHaveLength(report.summary.pages);
    if (factor > 1) {
      const pagesText = letters(
        [...pagesXml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]!).join(''),
      );
      expect(
        report.units
          .filter((u) => u.status !== 'untranslated' && u.status !== 'kept-original' && u.target)
          // Names read as they are: the PDF leaves them, so does the page's picture.
          .filter((u) => letters(u.target) !== letters(u.source))
          .flatMap((u) => u.target.split(/\s+/u).map((w) => [u.id, letters(w)] as const))
          .filter(([, w]) => w.length > 1 && !pagesText.includes(w))
          .map(([id, w]) => `${id}: ${w}`),
      ).toEqual([]);
    }
    // The demo paper's footnote is a Word footnote, referenced where its mark was.
    if (name === 'demo-paper-identity') {
      expect(xml).toContain('<w:footnoteReference w:id="1"/>');
      expect(notes).toContain('<w:footnote w:id="1">');
    }
  }, 300_000);
});
