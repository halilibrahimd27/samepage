import { describe, expect, it } from 'vitest';
import type { RawPage } from '../../src/pdf/extract/raw';
import {
  inkColor,
  layerPage,
  needsOcr,
  ocrPage,
  paperColor,
  textOverPicture,
  unseenText,
} from '../../src/pdf/ocr/page';
import { parseTsv } from '../../src/pdf/ocr/tesseract';

const page = (chars: number, imageArea: number): RawPage => ({
  index: 0,
  width: 100,
  height: 100,
  rotation: 0,
  blocks: chars
    ? [
        {
          bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
          lines: [
            {
              bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
              dir: [1, 0],
              wmode: 0,
              chars: Array.from({ length: chars }, () => ({
                c: 'a',
                x: 0,
                y: 0,
                bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
                font: 'F',
                size: 10,
                color: [0, 0, 0] as [number, number, number],
              })),
            },
          ],
        },
      ]
    : [],
  images: imageArea ? [{ bbox: { x0: 0, y0: 0, x1: 100, y1: imageArea / 100 } }] : [],
  vectors: [],
  links: [],
  fonts: {},
});

/** A white 60×20 image with a black bar where the "text" is (rows 8–11, columns 10–49). */
function pixels() {
  const width = 60;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 3).fill(255);
  for (let y = 8; y < 12; y++)
    for (let x = 10; x < 50; x++) data.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3);
  return { width, height, data };
}

describe('OCR', () => {
  it('takes pages without text that are mostly an image for scans', () => {
    expect(needsOcr(page(0, 9000))).toBe(true);
    expect(needsOcr(page(0, 2000))).toBe(false);
    expect(needsOcr(page(40, 9000))).toBe(false);
  });

  it('parses word rows of the TSV output', () => {
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '4\t1\t1\t1\t1\t0\t10\t8\t40\t4\t-1\t',
      '5\t1\t1\t1\t1\t1\t10\t8\t18\t4\t96.5\tAnlam',
      '5\t1\t1\t1\t1\t2\t32\t8\t18\t4\t91\tkayması',
      '5\t1\t1\t1\t1\t3\t52\t8\t2\t4\t95\t ',
    ].join('\n');
    expect(parseTsv(tsv).map((w) => [w.text, w.left, w.conf])).toEqual([
      ['Anlam', 10, 96.5],
      ['kayması', 32, 91],
    ]);
  });

  it('turns recognised words into lines of characters in page space', () => {
    const words = parseTsv(
      '5\t1\t1\t1\t1\t1\t10\t8\t18\t4\t96\tAnlam\n5\t1\t1\t1\t1\t2\t32\t8\t18\t4\t90\tkayması',
    );
    const { page: p, info } = ocrPage(page(0, 9000), words, pixels(), 2);
    const line = p.blocks[0]!.lines[0]!;
    expect(line.chars.map((c) => c.c).join('')).toBe('Anlam kayması');
    expect(line.bbox).toEqual({ x0: 5, y0: 4, x1: 25, y1: 6 });
    expect(line.chars[0]!.color).toEqual([0, 0, 0]);
    expect(info.confidence).toBe(93);
    expect(info.lines[0]!.background).toEqual([1, 1, 1]);
    // The scan is the page's picture, not a figure.
    expect(p.images).toEqual([]);
  });

  it('reads the paper and ink colours around and inside a line', () => {
    const px = pixels();
    expect(paperColor(px, { x0: 10, y0: 8, x1: 50, y1: 12 })).toEqual([1, 1, 1]);
    expect(inkColor(px, { x0: 10, y0: 8, x1: 50, y1: 12 })).toEqual([0, 0, 0]);
  });

  it('reads a text layer unseen over a picture of the page like a scan', () => {
    // A dark slide: light words drawn in the picture, the same words as an unseen text layer.
    const dark = () => {
      const width = 60;
      const height = 20;
      const data = new Uint8ClampedArray(width * height * 3);
      for (let i = 0; i < data.length; i += 3) data.set([20, 30, 50], i);
      // Thin strokes: about a fifth of the line, as type is.
      for (let y = 9; y < 11; y++)
        for (let x = 10; x < 50; x += 4) data.set([240, 240, 240], (y * width + x) * 3);
      return { width, height, data };
    };
    const slide: RawPage = {
      ...page(30, 10000),
      width: 30,
      height: 10,
      blocks: [
        {
          bbox: { x0: 5, y0: 3.5, x1: 25, y1: 6.5 },
          lines: [
            { ...page(30, 0).blocks[0]!.lines[0]!, bbox: { x0: 5, y0: 3.5, x1: 25, y1: 6.5 } },
          ],
        },
      ],
      images: [{ bbox: { x0: 0, y0: 0, x1: 30, y1: 10 } }],
    };
    expect(textOverPicture(slide)).toBe(true);
    // Taking the text off changes no pixel: it is not what shows.
    expect(unseenText(slide, dark(), dark(), 2)).toBe(true);
    const plain = dark();
    plain.data.fill(20);
    expect(unseenText(slide, dark(), plain, 2)).toBe(false);
    const { page: read, info } = layerPage(slide, dark(), 2);
    expect(info.layer).toBe(true);
    // Light ink on the dark paper, set anew in a sans on a slide.
    const c = read.blocks[0]!.lines[0]!.chars[0]!;
    expect(c.color[0]).toBeGreaterThan(0.9);
    expect(c.font).toMatch(/Sans/u);
    expect(info.lines[0]!.background[2]).toBeCloseTo(50 / 255, 1);
  });
});
