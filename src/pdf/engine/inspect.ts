import { loadMupdf, type MupdfModule } from './mupdf';

type Document = InstanceType<MupdfModule['Document']>;

export interface Thumbnail {
  png: Uint8Array;
  width: number;
  height: number;
}

export type PdfInspection =
  | { ok: true; pageCount: number; thumbnail: Thumbnail; sample: string }
  | { ok: false; reason: 'encrypted' | 'corrupt' }
  | { ok: false; reason: 'too-many-pages'; pageCount: number };

/**
 * Opens a PDF, returns its page count, a PNG thumbnail of page 1 and a text sample of the first
 * pages (for language detection). Frees all WASM objects.
 */
// Enough text to outweigh an English abstract on the first page of a non-English paper.
const SAMPLE_PAGES = 6;
const SAMPLE_CHARS = 24_000;

/**
 * Text of the first pages and of the middle of the document: a thesis or a paper may open with an
 * English title page and abstract before the body in its own language.
 */
function textSample(doc: Document, pages: number): string {
  const count = doc.countPages();
  const middle = Math.floor(count / 2);
  const indices = [
    ...new Set([0, 1, 2, middle - 1, middle, middle + 1].filter((i) => i >= 0 && i < count)),
  ].slice(0, Math.max(pages, 1));
  // An equal share per page, so the opening pages cannot crowd out the middle ones.
  const share = Math.floor(SAMPLE_CHARS / Math.max(1, indices.length));
  let text = '';
  for (const i of indices) {
    const page = doc.loadPage(i);
    try {
      const stext = page.toStructuredText('preserve-whitespace');
      try {
        text += `${stext.asText().slice(0, share)}\n`;
      } finally {
        stext.destroy();
      }
    } catch {
      // A page that cannot be read only makes the sample shorter.
    } finally {
      page.destroy();
    }
  }
  return text.normalize('NFC').slice(0, SAMPLE_CHARS);
}

export async function inspectPdf(
  bytes: Uint8Array,
  options: { maxPages: number; thumbnailWidth: number },
): Promise<PdfInspection> {
  const mupdf = await loadMupdf();
  let doc: InstanceType<typeof mupdf.Document>;
  try {
    doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  try {
    if (doc.needsPassword()) return { ok: false, reason: 'encrypted' };
    const pageCount = doc.countPages();
    if (pageCount === 0) return { ok: false, reason: 'corrupt' };
    if (pageCount > options.maxPages) return { ok: false, reason: 'too-many-pages', pageCount };

    const page = doc.loadPage(0);
    try {
      const [x0, , x1] = page.getBounds();
      const scale = options.thumbnailWidth / Math.max(1, x1 - x0);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        return {
          ok: true,
          pageCount,
          sample: textSample(doc, Math.min(pageCount, SAMPLE_PAGES)),
          thumbnail: {
            png: pixmap.asPNG().slice(),
            width: pixmap.getWidth(),
            height: pixmap.getHeight(),
          },
        };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } catch {
    return { ok: false, reason: 'corrupt' };
  } finally {
    doc.destroy();
  }
}
