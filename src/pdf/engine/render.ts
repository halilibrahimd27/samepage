import type { Rect } from '../../core/ir/types';
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

/**
 * Renders page regions (figures, display formulas) to PNG, page content only (no annotations),
 * on white. `scale` 1 = 72 dpi; a region is rendered smaller when it would exceed `maxPixels` on
 * its longer side. Frees all WASM objects.
 */
export async function renderRegionsPng(
  bytes: Uint8Array,
  regions: { page: number; rect: Rect }[],
  scale: number,
  maxPixels = 2400,
): Promise<Thumbnail[]> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const out: Thumbnail[] = [];
  try {
    for (const { page: index, rect } of regions) {
      const page = doc.loadPage(index);
      try {
        const longer = Math.max(rect.x1 - rect.x0, rect.y1 - rect.y0, 1);
        const s = Math.min(scale, maxPixels / longer);
        const box: [number, number, number, number] = [
          Math.floor(rect.x0 * s),
          Math.floor(rect.y0 * s),
          Math.ceil(rect.x1 * s),
          Math.ceil(rect.y1 * s),
        ];
        const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, box, false);
        try {
          pixmap.clear(255);
          const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap);
          try {
            page.runPageContents(device, mupdf.Matrix.scale(s, s));
            device.close();
          } finally {
            device.destroy();
          }
          out.push({
            png: pixmap.asPNG().slice(),
            width: pixmap.getWidth(),
            height: pixmap.getHeight(),
          });
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
  return out;
}
