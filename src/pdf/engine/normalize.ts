import { loadMupdf } from './mupdf';

/**
 * The PDF with the content streams of the given pages rewritten by MuPDF ("sanitize"): the same
 * drawing in plain operators. Some producers set a whole page as one text object positioned in
 * ways that MuPDF's text redaction gets wrong (the glyphs left beside a removed word move); on
 * the rewritten streams the redaction is exact. Only the pages' contents and resources change:
 * the page objects stay, so bookmarks and links keep their targets. Used only when the check
 * after writing found changes outside the text areas, and only for pages the rewrite draws
 * exactly like the original (the caller checks).
 */
export async function normalizedCopy(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const target = mupdf.Document.openDocument(bytes, 'application/pdf');
  const rewritten = mupdf.Document.openDocument(bytes, 'application/pdf');
  let clean: InstanceType<typeof mupdf.Document> | null = null;
  try {
    const out = target.asPDF();
    const src = rewritten.asPDF();
    if (!out || !src) throw new Error('Not a PDF');
    clean = mupdf.Document.openDocument(
      src.saveToBuffer('sanitize').asUint8Array().slice(),
      'application/pdf',
    );
    const normal = clean.asPDF()!;
    const map = out.newGraftMap();
    for (const p of pages) {
      const page = out.findPage(p);
      const from = normal.findPage(p);
      page.put('Contents', map.graftObject(from.get('Contents')));
      page.put('Resources', map.graftObject(from.getInheritable('Resources')));
    }
    return out.saveToBuffer('compress').asUint8Array().slice();
  } finally {
    clean?.destroy();
    rewritten.destroy();
    target.destroy();
  }
}
