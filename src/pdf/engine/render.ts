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

export interface PagePixels {
  /** RGB, 3 bytes per pixel, row-major. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Renders one page to raw RGB pixels (render-diff checks, Phase 5 post-apply verification). */
export async function renderPagePixels(
  bytes: Uint8Array,
  index: number,
  scale: number,
): Promise<PagePixels> {
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
          data: pixmap.getPixels().slice(),
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

export interface OpenedRenderer {
  pixels(index: number, scale: number): PagePixels;
  close(): void;
}

/** Keeps one document open for many page renders (post-apply verification of long documents). */
export async function openRenderer(bytes: Uint8Array): Promise<OpenedRenderer> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  return {
    pixels(index, scale) {
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
            data: pixmap.getPixels().slice(),
            width: pixmap.getWidth(),
            height: pixmap.getHeight(),
          };
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    },
    close: () => doc.destroy(),
  };
}
