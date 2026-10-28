// Regenerates the synthetic test corpus under tests/corpus/.
// Node-side tooling may use MuPDF directly; app code goes through src/pdf/engine/.
// LaTeX (Phase 3) and DOCX (Phase 2) generators are added here as they land.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as mupdf from 'mupdf';
import { buildDocxFixtures } from './docxFixtures.mjs';

const OUT = new URL('../tests/corpus/pdf/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/** Builds a simple A4 PDF with one paragraph of text per page. */
function buildTextPdf(pages) {
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, 'pdf', '');
  const font = new mupdf.Font('Times-Roman');
  pages.forEach((lines) => {
    const dev = writer.beginPage([0, 0, 595, 842]);
    const text = new mupdf.Text();
    lines.forEach((line, i) => text.showString(font, [12, 0, 0, -12, 72, 100 + i * 16], line));
    dev.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0, 0], 1);
    writer.endPage();
  });
  writer.close();
  return buf.asUint8Array().slice();
}

function save(name, bytes) {
  writeFileSync(new URL(name, OUT), bytes);
  console.log(`fixtures: wrote tests/corpus/pdf/${name} (${bytes.length} bytes)`);
}

const smoke = buildTextPdf([
  ['Smoke test document, page one.', 'It exists to check that PDFs open in the browser.'],
  ['Page two.'],
]);
save('smoke-2pages.pdf', smoke);

// PDF with active content (document JavaScript + open action) for the sanitisation test.
{
  const js = mupdf.Document.openDocument(smoke, 'application/pdf').asPDF();
  const root = js.getTrailer().get('Root');
  const action = js.newDictionary();
  action.put('S', js.newName('JavaScript'));
  action.put('JS', js.newString("app.alert('samepage test');"));
  root.put('OpenAction', js.addObject(action));
  const names = js.newDictionary();
  const jsTree = js.newDictionary();
  const arr = js.newArray();
  arr.push(js.newString('init'));
  arr.push(js.addObject(action));
  jsTree.put('Names', arr);
  names.put('JavaScript', jsTree);
  root.put('Names', names);
  save('javascript.pdf', js.saveToBuffer('').asUint8Array().slice());
}

const doc = mupdf.Document.openDocument(smoke, 'application/pdf').asPDF();
save(
  'encrypted.pdf',
  doc
    .saveToBuffer('encrypt=aes-256,user-password=secret,owner-password=owner')
    .asUint8Array()
    .slice(),
);

const DOCX_OUT = new URL('../tests/corpus/docx/', import.meta.url);
mkdirSync(DOCX_OUT, { recursive: true });
for (const [name, bytes] of Object.entries(await buildDocxFixtures())) {
  writeFileSync(new URL(name, DOCX_OUT), bytes);
  console.log(`fixtures: wrote tests/corpus/docx/${name} (${bytes.length} bytes)`);
}

// PPTX corpus: built with pptxgenjs when it is installed (`npm i --no-save pptxgenjs@4.0.1`); it
// is no project dependency (its image-size dependency has open advisories), the files are
// committed.
const PPTX_OUT = new URL('../tests/corpus/pptx/', import.meta.url);
mkdirSync(PPTX_OUT, { recursive: true });
try {
  const { buildPptxFixtures } = await import('./pptxFixtures.mjs');
  for (const [name, bytes] of Object.entries(await buildPptxFixtures())) {
    writeFileSync(new URL(name, PPTX_OUT), bytes);
    console.log(`fixtures: wrote tests/corpus/pptx/${name} (${bytes.length} bytes)`);
  }
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  console.log(
    'fixtures: pptxgenjs not installed — skipping PPTX corpus (committed files are used).',
  );
}

// LaTeX corpus (TESTING.md §2): compiled with tectonic when it is installed; the PDFs are committed.
const SRC = fileURLToPath(new URL('../tests/corpus/src/', import.meta.url));
const PDF_DIR = fileURLToPath(OUT);
let tectonic = true;
try {
  execFileSync('tectonic', ['--version'], { stdio: 'ignore' });
} catch {
  tectonic = false;
  console.log('fixtures: tectonic not found — skipping LaTeX corpus (committed PDFs are used).');
}
if (tectonic) {
  for (const tex of readdirSync(SRC)
    .filter((f) => f.endsWith('.tex') && f !== 'common.tex')
    .sort()) {
    execFileSync('tectonic', ['-X', 'compile', '--outdir', PDF_DIR, tex], {
      cwd: SRC,
      stdio: 'ignore',
    });
    console.log(`fixtures: compiled tests/corpus/pdf/${tex.replace(/\.tex$/, '.pdf')}`);
  }
}

// Scanned paper (P8.4): page 1 of one-column-basic.pdf as a greyscale 180 dpi JPEG, no text
// layer — the OCR path must recognise it. Built after the LaTeX corpus it is made from.
{
  const source = mupdf.Document.openDocument(
    readFileSync(new URL('one-column-basic.pdf', OUT)),
    'application/pdf',
  );
  const page = source.loadPage(0);
  const [x0, y0, x1, y1] = page.getBounds();
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(2.5, 2.5),
    mupdf.ColorSpace.DeviceGray,
    false,
    true,
  );
  // JPEG, as scanners store pages (and small enough to commit).
  const image = new mupdf.Image(pixmap.asJPEG(80));
  const buf = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buf, 'pdf', '');
  const dev = writer.beginPage([0, 0, x1 - x0, y1 - y0]);
  dev.fillImage(image, [x1 - x0, 0, 0, y1 - y0, 0, 0], 1);
  writer.endPage();
  writer.close();
  save('scanned.pdf', buf.asUint8Array().slice());
  image.destroy();
  pixmap.destroy();
  page.destroy();
  source.destroy();
}
