import type { Rect } from '../../core/ir/types';
import type { PagePixels } from '../engine/render';
import type { RawChar, RawLine, RawPage, RawTextBlock } from '../extract/raw';
import type { OcrWord } from './tesseract';

/** Font name given to recognised text (no font is known for a scan). */
export const OCR_FONT = 'OCR';
/** Render scale for recognition: 216 dpi. */
export const OCR_SCALE = 3;

export type Color = [number, number, number];

export interface OcrLine {
  /** Page space (points). */
  bbox: Rect;
  /** Mean word confidence, 0–100. */
  conf: number;
  /** The paper under the line (covers the original text in the output). */
  background: Color;
}

export interface OcrPageInfo {
  /** Mean word confidence of the page, 0–100. */
  confidence: number;
  lines: OcrLine[];
}

/** A page with (almost) no text that is mostly an image: a scan. */
export function needsOcr(page: RawPage): boolean {
  let chars = 0;
  for (const b of page.blocks)
    for (const l of b.lines) for (const c of l.chars) if (c.c.trim()) chars++;
  if (chars >= 20) return false;
  const area = page.width * page.height;
  const covered = page.images.reduce(
    (n, i) => n + Math.max(0, i.bbox.x1 - i.bbox.x0) * Math.max(0, i.bbox.y1 - i.bbox.y0),
    0,
  );
  return area > 0 && covered >= 0.5 * area;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 1;
};

/** Pixels of `box` (pixel space, clipped), every `step`th. */
function samples(px: PagePixels, box: Rect, step = 2): Color[] {
  const out: Color[] = [];
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(px.width, Math.ceil(box.x1));
  const y1 = Math.min(px.height, Math.ceil(box.y1));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * px.width + x) * 3;
      out.push([px.data[i]! / 255, px.data[i + 1]! / 255, px.data[i + 2]! / 255]);
    }
  }
  return out;
}

const channelMedian = (cs: Color[]): Color =>
  cs.length
    ? [median(cs.map((c) => c[0])), median(cs.map((c) => c[1])), median(cs.map((c) => c[2]))]
    : [1, 1, 1];

/** The paper colour: the median of thin strips just above and below the box. */
export function paperColor(px: PagePixels, box: Rect): Color {
  const pad = Math.max(2, (box.y1 - box.y0) * 0.15);
  return channelMedian([
    ...samples(px, { x0: box.x0, y0: box.y0 - pad, x1: box.x1, y1: box.y0 }),
    ...samples(px, { x0: box.x0, y0: box.y1, x1: box.x1, y1: box.y1 + pad }),
  ]);
}

/** The ink colour: the median of the darkest tenth of the box. */
export function inkColor(px: PagePixels, box: Rect): Color {
  const cs = samples(px, box).sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const dark = cs.slice(0, Math.max(1, Math.floor(cs.length / 10)));
  const c = channelMedian(dark);
  // Antialiased edges make thin type look grey; near-black is black.
  return c[0] + c[1] + c[2] < 0.45 ? [0, 0, 0] : c;
}

const DESCENDER = /[gjpqyçşğţșJQ,;()[\]{}|]/u;

/**
 * The page with its recognised text as lines of characters, as if the PDF had a text layer:
 * the analysis builds paragraphs, columns and roles from it like from any page. Characters are
 * spread evenly over their word's box; the size comes from the tallest word of the line.
 */
export function ocrPage(
  page: RawPage,
  words: OcrWord[],
  px: PagePixels,
  scale: number,
): { page: RawPage; info: OcrPageInfo } {
  const groups = new Map<string, OcrWord[]>();
  for (const w of words) {
    const key = `${w.block}.${w.par}.${w.line}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(w);
  }
  const blocks = new Map<number, RawTextBlock>();
  const lines: OcrLine[] = [];
  for (const ws of groups.values()) {
    const box: Rect = {
      x0: Math.min(...ws.map((w) => w.left)),
      y0: Math.min(...ws.map((w) => w.top)),
      x1: Math.max(...ws.map((w) => w.left + w.width)),
      y1: Math.max(...ws.map((w) => w.top + w.height)),
    };
    const tallest = Math.max(...ws.map((w) => w.height));
    const text = ws.map((w) => w.text).join(' ');
    // Ascender to descender is about 0.9 em; capitals and x-height letters alone about 0.72.
    const em = tallest / (DESCENDER.test(text) ? 0.9 : 0.72);
    const size = Math.round(Math.min(72, Math.max(4, em / scale)) * 10) / 10;
    const flat = ws.filter((w) => !DESCENDER.test(w.text)).map((w) => w.top + w.height);
    const baseline = (flat.length ? median(flat) : box.y1 - 0.2 * em) / scale;
    const color = inkColor(px, box);
    const chars: RawChar[] = [];
    ws.forEach((w, k) => {
      const letters = [...w.text];
      const step = w.width / letters.length / scale;
      const x0 = w.left / scale;
      letters.forEach((c, i) => {
        const x = x0 + i * step;
        chars.push({
          c,
          x,
          y: baseline,
          bbox: { x0: x, y0: w.top / scale, x1: x + step, y1: (w.top + w.height) / scale },
          font: OCR_FONT,
          size,
          color,
        });
      });
      const next = ws[k + 1];
      if (next) {
        const gap0 = (w.left + w.width) / scale;
        const gap1 = next.left / scale;
        chars.push({
          c: ' ',
          x: gap0,
          y: baseline,
          bbox: {
            x0: gap0,
            y0: w.top / scale,
            x1: Math.max(gap0, gap1),
            y1: (w.top + w.height) / scale,
          },
          font: OCR_FONT,
          size,
          color,
        });
      }
    });
    const bbox: Rect = {
      x0: box.x0 / scale,
      y0: box.y0 / scale,
      x1: box.x1 / scale,
      y1: box.y1 / scale,
    };
    const line: RawLine = { bbox, dir: [1, 0], wmode: 0, chars };
    const blockId = ws[0]!.block;
    const block = blocks.get(blockId) ?? { bbox: { ...bbox }, lines: [] };
    block.lines.push(line);
    block.bbox = {
      x0: Math.min(block.bbox.x0, bbox.x0),
      y0: Math.min(block.bbox.y0, bbox.y0),
      x1: Math.max(block.bbox.x1, bbox.x1),
      y1: Math.max(block.bbox.y1, bbox.y1),
    };
    blocks.set(blockId, block);
    lines.push({
      bbox,
      conf: ws.reduce((n, w) => n + w.conf, 0) / ws.length,
      background: paperColor(px, box),
    });
  }
  const confidence = words.length ? words.reduce((n, w) => n + w.conf, 0) / words.length : 0;
  return {
    page: {
      ...page,
      blocks: [...blocks.values()],
      // The scan itself is the page's picture; recognised text is not inside a figure.
      images: page.images.filter(
        (i) => (i.bbox.x1 - i.bbox.x0) * (i.bbox.y1 - i.bbox.y0) < 0.5 * page.width * page.height,
      ),
      fonts: {
        ...page.fonts,
        [OCR_FONT]: { name: OCR_FONT, bold: false, italic: false, serif: true, mono: false },
      },
    },
    info: { confidence, lines },
  };
}
