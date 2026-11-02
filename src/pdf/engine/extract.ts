import type { Rect } from '../../core/ir/types';
import type { RawChar, RawFont, RawLine, RawPage, RawTextBlock } from '../extract/raw';
import { fromCp1251, misreadCp1251 } from './cp1251';
import type { PagePixels } from './render';
import { loadMupdf } from './mupdf';

/**
 * Structured-text options (ARCHITECTURE.md §5). Never add `structured`, `table-hunt` or
 * `segment`: the walker skips struct/grid blocks and their text would be lost.
 */
export const STEXT_OPTIONS = 'preserve-whitespace,preserve-ligatures,preserve-images,vectors';

const quadToRect = (q: number[]): Rect => ({
  x0: Math.min(q[0]!, q[2]!, q[4]!, q[6]!),
  y0: Math.min(q[1]!, q[3]!, q[5]!, q[7]!),
  x1: Math.max(q[0]!, q[2]!, q[4]!, q[6]!),
  y1: Math.max(q[1]!, q[3]!, q[5]!, q[7]!),
});
const toRect = (r: number[]): Rect => ({ x0: r[0]!, y0: r[1]!, x1: r[2]!, y1: r[3]! });
const union = (a: Rect, b: Rect): Rect => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});
/**
 * A glyph box of a horizontal line, from the baseline `y`. Some embedded fonts declare a tiny
 * ascent and no descent (TeX Gyre Termes X: boxes 0.45 of the size, over the x-height only);
 * such a box gets a common font's ascent and descent, or the gaps between lines look three
 * times their height and the paragraphs split, and redaction checks miss the letters' tops.
 */
const glyphBox = (box: Rect, y: number, size: number, horizontal: boolean): Rect =>
  horizontal && size > 0 && box.y1 - box.y0 < 0.6 * size
    ? { ...box, y0: Math.min(box.y0, y - 0.75 * size), y1: Math.max(box.y1, y + 0.2 * size) }
    : box;

/**
 * A line's boxes made sane, then its own box from them. A blank in a size far above its line's
 * ("Angeli." then two Calibri spaces of 1638 pt, a word processor's leftover) is a plain space,
 * and a glyph box taller than three times its size is cut to it: such a box covered the page,
 * and redacting the line wiped every line under it.
 */
export function tidyLine(line: RawLine): void {
  const sizes = line.chars
    .filter((ch) => /\S/u.test(ch.c))
    .map((ch) => ch.size)
    .sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)];
  const horizontal = line.wmode === 0 && line.dir[0] === 1 && line.dir[1] === 0;
  for (const ch of line.chars) {
    const blank = !/\S/u.test(ch.c) && !!median && ch.size > 3 * median;
    const size = blank ? median : ch.size;
    if (horizontal && (blank || ch.bbox.y1 - ch.bbox.y0 > 3 * size))
      Object.assign(ch, {
        size,
        bbox: {
          x0: ch.x,
          y0: ch.y - 0.75 * size,
          x1: blank ? ch.x + 0.25 * size : Math.min(ch.bbox.x1, ch.x + 2 * size),
          y1: ch.y + 0.2 * size,
        },
      });
  }
  line.bbox = line.chars.slice(1).reduce((r, ch) => union(r, ch.bbox), line.chars[0]!.bbox);
}
const round = (n: number) => Math.round(n * 100) / 100;
const rgb = (c: number[]): [number, number, number] =>
  c.length >= 3 ? [c[0]!, c[1]!, c[2]!] : c.length === 1 ? [c[0]!, c[0]!, c[0]!] : [0, 0, 0];

/** "ABCDEF+CMR10" → "CMR10" */
export const stripSubset = (name: string) => name.replace(/^[A-Z]{6}\+/, '');

/** Script capitals A–Z; the gaps of the math block are filled by Letterlike Symbols. */
const SCRIPT_CAPITALS: Record<string, number> = {
  B: 0x212c,
  E: 0x2130,
  F: 0x2131,
  H: 0x210b,
  I: 0x2110,
  L: 0x2112,
  M: 0x2133,
  R: 0x211b,
};

/** Adobe Symbol encoding (Word's "Symbol" font maps it to U+F020–U+F0FF). */
const SYMBOL: Record<number, string> = {
  ...Object.fromEntries([...'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ'].map((ch, i) => [0x41 + i, ch])),
  ...Object.fromEntries([...'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'].map((ch, i) => [0x61 + i, ch])),
  0x22: '∀',
  0x24: '∃',
  0x27: '∋',
  0x2a: '∗',
  0x2d: '−',
  0x40: '≅',
  0x5c: '∴',
  0x5e: '⊥',
  0x7e: '∼',
  0xa3: '≤',
  0xa5: '∞',
  0xac: '←',
  0xad: '↑',
  0xae: '→',
  0xaf: '↓',
  0xb0: '°',
  0xb1: '±',
  0xb3: '≥',
  0xb4: '×',
  0xb5: '∝',
  0xb6: '∂',
  0xb7: '•',
  0xb8: '÷',
  0xb9: '≠',
  0xba: '≡',
  0xbb: '≈',
  0xd6: '√',
  0xd7: '⋅',
  0xe5: '∑',
  0xf2: '∫',
};
/** U+F8EB–U+F8FE: ⎛⎜⎝ ⎡⎢⎣ ⎧⎨⎩⎪ ⎮ ⎞⎟⎠ ⎤⎥⎦ ⎫⎬⎭ (Adobe Glyph List). */
const BRACKET_PIECES = [...'⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪⎮⎞⎟⎠⎤⎥⎦⎫⎬⎭'];

/** Common Wingdings bullets and marks. */
const WINGDINGS: Record<number, string> = {
  0x2a: '✉',
  0x6c: '●',
  0x6e: '■',
  0x71: '❑',
  0x76: '❖',
  0xa7: '▪',
  0xd8: '➢',
  0xe0: '→',
  0xe8: '➔',
  0xfb: '✗',
  0xfc: '✓',
};

/**
 * Repairs characters MuPDF.js reports wrongly:
 * - MuPDF.js 1.28 builds each character with String.fromCharCode, which drops the bits above
 *   U+FFFF: Mathematical Alphanumeric Symbols (U+1D400–U+1D7FF, "𝑁", "𝐲") arrive as
 *   U+D400–U+D7FF. That range is Hangul, which v1 does not support, so it is mapped back to plane 1.
 * - STIX 1.x math fonts (common in Elsevier papers) map calligraphic capitals to the private use
 *   area U+E22D–U+E246; they become the standard script capitals ("ℒ").
 * - Word's Symbol and Wingdings fonts use U+F020–U+F0FF ("" is a bullet •).
 */
export function restoreChar(c: string, fontName: string): string {
  const u = c.length === 1 ? c.charCodeAt(0) : 0;
  if (u >= 0xd400 && u <= 0xd7ff) return String.fromCodePoint(0x10000 + u);
  // Word's symbol fonts put their glyphs in the private use area U+F020–U+F0FF.
  if (u >= 0xf020 && u <= 0xf0ff) {
    const table = /wingding/i.test(fontName) ? WINGDINGS : /symbol/i.test(fontName) ? SYMBOL : null;
    const mapped = table?.[u - 0xf000];
    if (mapped) return mapped;
    // Other symbol-encoded fonts: printable ASCII shifted into the private use area, and the
    // ASCII range of Symbol keeps its characters ("(", "1", "+").
    if (u - 0xf000 <= 0x7e && (!table || table === SYMBOL)) return String.fromCharCode(u - 0xf000);
  }
  // CJK angle brackets in mathematics are the mathematical ones (and only those have a glyph).
  if (u === 0x3008) return '⟨';
  if (u === 0x3009) return '⟩';
  // Adobe's serif ©, ® and ™.
  if (u >= 0xf6d9 && u <= 0xf6db) return '©®™'[u - 0xf6d9]!;
  // Adobe Symbol's private-use bracket pieces (big parentheses, brackets and braces).
  if (u >= 0xf8eb && u <= 0xf8fe) return BRACKET_PIECES[u - 0xf8eb]!;
  if (u >= 0xe22d && u <= 0xe246 && /^STIX/i.test(fontName)) {
    const letter = String.fromCharCode(0x41 + u - 0xe22d);
    return String.fromCodePoint(SCRIPT_CAPITALS[letter] ?? 0x1d49c + u - 0xe22d);
  }
  return c;
}

export interface OpenedPdf {
  pageCount: number;
  extractPage(index: number): RawPage;
  /** The page as PNG and as RGB pixels at `scale` (1 = 72 dpi), for text recognition. */
  renderPage(index: number, scale: number): { png: Uint8Array; pixels: PagePixels };
  close(): void;
}

/** Opens a PDF for extraction. Callers must call close() to free WASM memory. */
export async function openPdfForExtraction(bytes: Uint8Array): Promise<OpenedPdf> {
  const mupdf = await loadMupdf();
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  return {
    pageCount: doc.countPages(),
    close: () => doc.destroy(),
    renderPage(index, scale) {
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
            pixels: {
              data: pixmap.getPixels().slice(),
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
    },
    extractPage(index) {
      const page = doc.loadPage(index);
      const stext = page.toStructuredText(STEXT_OPTIONS);
      try {
        const [x0, y0, x1, y1] = page.getBounds();
        const fonts: Record<string, RawFont> = {};
        const blocks: RawTextBlock[] = [];
        const images: RawPage['images'] = [];
        const vectors: RawPage['vectors'] = [];
        let block: RawTextBlock | null = null;
        let line: RawLine | null = null;

        stext.walk({
          beginTextBlock(bbox) {
            block = { bbox: toRect(bbox), lines: [] };
          },
          beginLine(bbox, wmode, dir) {
            line = { bbox: toRect(bbox), dir: [round(dir[0]), round(dir[1])], wmode, chars: [] };
          },
          onChar(c, origin, font, size, quad, color) {
            const name = stripSubset(font.getName());
            fonts[name] ??= {
              name,
              bold: font.isBold(),
              italic: font.isItalic(),
              serif: font.isSerif(),
              mono: font.isMono(),
            };
            const horizontal = line?.wmode === 0 && line.dir[0] === 1 && line.dir[1] === 0;
            const ch: RawChar = {
              c: restoreChar(c, name),
              x: round(origin[0]),
              y: round(origin[1]),
              bbox: glyphBox(quadToRect(quad), origin[1], size, horizontal),
              font: name,
              size: round(size),
              color: rgb(color),
            };
            line?.chars.push(ch);
          },
          endLine() {
            if (line && block && line.chars.length) {
              tidyLine(line);
              block.lines.push(line);
            }
            line = null;
          },
          endTextBlock() {
            if (block?.lines.length) {
              block.bbox = block.lines
                .slice(1)
                .reduce((r, l) => union(r, l.bbox), block.lines[0]!.bbox);
              blocks.push(block);
            }
            block = null;
          },
          onImageBlock(bbox, _transform, image) {
            images.push({ bbox: toRect(bbox) });
            image.destroy();
          },
          onVector(bbox, flags, color) {
            const f = flags as { isRectangle: boolean; isStroked: boolean };
            vectors.push({
              bbox: toRect(bbox),
              isRectangle: f.isRectangle,
              isStroked: f.isStroked,
              color: rgb(color),
            });
          },
        });

        // A font that maps Cyrillic to Windows-1251 read as Latin-1 ("ÀÍÒÈ" for "АНТИ").
        const letters = new Map<string, string[]>();
        for (const b of blocks)
          for (const l of b.lines)
            for (const ch of l.chars)
              if (/\p{L}|[×÷]/u.test(ch.c))
                letters.set(ch.font, [...(letters.get(ch.font) ?? []), ch.c]);
        const misread = new Set([...letters].filter(([, cs]) => misreadCp1251(cs)).map(([f]) => f));
        if (misread.size)
          for (const b of blocks)
            for (const l of b.lines)
              for (const ch of l.chars) if (misread.has(ch.font)) ch.c = fromCp1251(ch.c);

        const links: RawPage['links'] = [];
        for (const link of page.getLinks()) {
          if (link.isExternal()) links.push({ bbox: toRect(link.getBounds()), uri: link.getURI() });
          link.destroy();
        }

        let rotation: RawPage['rotation'] = 0;
        if (page instanceof mupdf.PDFPage) {
          const rot = page.getObject().getInheritable('Rotate');
          if (rot.isNumber())
            rotation = (((rot.asNumber() % 360) + 360) % 360) as RawPage['rotation'];
        }

        return {
          index,
          width: x1 - x0,
          height: y1 - y0,
          rotation,
          blocks,
          images,
          vectors,
          links,
          fonts,
        };
      } finally {
        stext.destroy();
        page.destroy();
      }
    },
  };
}
