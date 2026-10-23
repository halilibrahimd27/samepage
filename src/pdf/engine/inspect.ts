import { loadMupdf } from './mupdf';

export interface Thumbnail {
  png: Uint8Array;
  width: number;
  height: number;
}

export type PdfInspection =
  | { ok: true; pageCount: number; thumbnail: Thumbnail }
  | { ok: false; reason: 'encrypted' | 'corrupt' }
  | { ok: false; reason: 'too-many-pages'; pageCount: number };

/** Opens a PDF, returns its page count and a PNG thumbnail of page 1. Frees all WASM objects. */
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
