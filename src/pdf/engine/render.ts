import type { Thumbnail } from './inspect';
import { loadMupdf } from './mupdf';

/** Renders one page to PNG at `scale` (1 = 72 dpi). Frees all WASM objects. */
export async function renderPagePng(
  bytes: Uint8Array,
  index: number,
  scale: number,
): Promise<Thumbnail> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const page = doc.loadPage(index);
    try {
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
      try {
        return {
          png: pixmap.asPNG().slice(),
          width: pixmap.getWidth(),
          height: pixmap.getHeight(),
        };
      } finally {
        pixmap.destroy();
      }
    } finally {
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
}
