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

function textSample(doc: Document, pages: number): string {
  let text = '';
  for (let i = 0; i < pages && text.length < SAMPLE_CHARS; i++) {
    const page = doc.loadPage(i);
    try {
      const stext = page.toStructuredText('preserve-whitespace');
      try {
        text += `${stext.asText()}\n`;
      } finally {
        stext.destroy();
      }
    } catch {
      // A page that cannot be read only makes the sample shorter.
    } finally {
      page.destroy();
    }
  }
  return text.slice(0, SAMPLE_CHARS);
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
