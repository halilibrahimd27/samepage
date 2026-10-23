import type { DecodedRun } from '../../core/segment/codec';
import type { BlockIR } from '../../core/ir/types';
import type { MathPart, PdfStyle } from './segments';
import { faceKey, type FaceKey, type Measurer } from './types';

export interface LayoutRun {
  text: string;
  face: FaceKey;
  size: number;
  color: [number, number, number];
  /** x of the run start (page space). */
  x: number;
  width: number;
  /** Vertical offset from the baseline (superscripts), in points, positive = up. */
  rise: number;
  linkUri?: string;
}

export interface LayoutLine {
  /** Text direction (unit vector, page space). Absent = horizontal; then run.x is absolute. */
  dir?: [number, number];
  /** For rotated lines: baseline origin; run.x is the offset along `dir`. */
  origin?: { x: number; y: number };
  baseline: number;
  x0: number;
  x1: number;
  runs: LayoutRun[];
  /** Extra space added to each inter-word gap for justification (points). */
  wordSpacing: number;
}

export interface BlockLayout {
  blockId: string;
  unitId: string;
  lines: LayoutLine[];
  /** Text that did not fit in this unit's boxes (only set on the last block of a unit). */
  overflow: boolean;
  scale: number;
}

export interface LayoutOptions {
  /** Width-matching factor per source font name (Noto size = source size × factor × scale). */
  sizeFactor: (fontName: string) => number;
  /** Uniform scale applied by layout repair (1 = none). */
  scale?: number;
}

interface Piece {
  text: string;
  face: FaceKey;
  size: number;
  color: [number, number, number];
  rise: number;
  linkUri?: string;
  /** Whitespace piece (a break opportunity). */
  space: boolean;
}

const MATH_LETTER = /\p{L}/u;
/** Spacing modifier accent → combining accent. */
const COMBINING: Record<string, string> = Object.fromEntries(
  [
    [0x02c6, 0x0302],
    [0x02dc, 0x0303],
    [0x00af, 0x0304],
    [0x02d9, 0x0307],
    [0x00a8, 0x0308],
  ].map(([a, c]) => [String.fromCharCode(a!), String.fromCharCode(c!)]),
);

/** Decoded runs → styled pieces split at spaces (each space is its own piece). */
function toPieces(runs: DecodedRun<PdfStyle>[], baseStyle: PdfStyle, opts: LayoutOptions): Piece[] {
  const scale = opts.scale ?? 1;
  const pieces: Piece[] = [];
  for (const run of runs) {
    if (run.type === 'atom') {
      const kind = run.placeholder!.kind;
      const size = baseStyle.size * opts.sizeFactor(baseStyle.fontName) * scale;
      if (kind === 'N') {
        pieces.push({
          text: run.text,
          face: faceKey(baseStyle.family, false, false),
          size: size * 0.7,
          color: baseStyle.color,
          rise: size * 0.33,
          space: false,
        });
      } else {
        // Inline math is re-set in the serif face: letters italic, everything else upright, each
        // part with its original relative size and baseline shift. Spacing accents ("ˆy") become
        // combining marks ("ŷ").
        const parts = run.placeholder?.ref
          ? (JSON.parse(run.placeholder.ref) as MathPart[])
          : [{ t: run.text, r: 1, d: 0 }];
        let pending = '';
        parts.forEach((part, k) => {
          let text = pending + part.t;
          pending = '';
          if (/[\p{Sk}\p{Lm}]$/u.test(text) && k + 1 < parts.length) {
            pending = text.slice(-1);
            text = text.slice(0, -1);
          }
          text = text.replace(/([\p{Sk}\p{Lm}])(\p{L})/gu, (m, acc: string, base: string) =>
            COMBINING[acc] ? (base + COMBINING[acc]).normalize('NFC') : m,
          );
          for (const piece of text.match(/(?:\p{L}\p{M}*)+|[^\p{L}]+/gu) ?? []) {
            pieces.push({
              text: piece,
              face: faceKey('serif', false, MATH_LETTER.test(piece)),
              size: size * part.r,
              color: baseStyle.color,
              rise: size * part.d,
              space: false,
            });
          }
        });
      }
      continue;
    }
    const s = run.style ?? baseStyle;
    const size = s.size * opts.sizeFactor(s.fontName) * scale;
    for (const part of run.text.split(/( +)/)) {
      if (!part) continue;
      const piece: Piece = {
        text: part,
        face: faceKey(s.family, s.bold, s.italic),
        size,
        color: s.color,
        rise: 0,
        space: /^ +$/.test(part),
      };
      if (s.linkUri) piece.linkUri = s.linkUri;
      pieces.push(piece);
    }
  }
  return pieces;
}

/** Line slots of a box: original baselines and left edges, continued at the original leading. */
function slots(block: BlockIR): { baseline: number; x0: number }[] {
  return block.lines.map((l) => ({ baseline: l.baseline, x0: l.bbox.x0 }));
}

const leading = (block: BlockIR, fallback: number) => {
  const gaps = block.lines
    .slice(1)
    .map((l, i) => l.baseline - block.lines[i]!.baseline)
    .filter((g) => g > 0);
  return gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]! : fallback;
};

/**
 * Greedy line breaking of a unit's translation through its chain of boxes. Lines reuse the
 * original baselines (and indents); extra lines continue at the original leading while they
 * stay inside the box. Returns one layout per box; `overflow` marks text that did not fit.
 */
export function layoutUnit(
  unitId: string,
  blocks: BlockIR[],
  runs: DecodedRun<PdfStyle>[],
  baseStyle: PdfStyle,
  measurer: Measurer,
  opts: LayoutOptions,
): BlockLayout[] {
  const pieces = toPieces(runs, baseStyle, opts);
  const widthOf = (p: Piece) => measurer.width(p.text, p.face, p.size);
  const out: BlockLayout[] = [];
  let i = 0;
  // Skip leading spaces.
  while (i < pieces.length && pieces[i]!.space) i++;

  for (const block of blocks) {
    if (block.direction[1] !== 0) {
      // Rotated text (chart axis labels): one line along the block's long side, centred.
      const [dx, dy] = block.direction;
      const line: Piece[] = [];
      while (i < pieces.length) line.push(pieces[i++]!);
      const length =
        Math.abs(dy) > Math.abs(dx) ? block.bbox.y1 - block.bbox.y0 : block.bbox.x1 - block.bbox.x0;
      const width = line.reduce((w, p) => w + widthOf(p), 0);
      const size = line.find((p) => !p.space)?.size ?? baseStyle.size;
      const descent = size * 0.22;
      // Glyph "up" is perpendicular to the direction; the baseline sits on the opposite side.
      const origin =
        dy < 0
          ? { x: block.bbox.x1 - descent, y: block.bbox.y1 }
          : { x: block.bbox.x0 + descent, y: block.bbox.y0 };
      let x = Math.max(0, (length - width) / 2);
      const runs: LayoutRun[] = [];
      for (const p of line) {
        const w = widthOf(p);
        if (!p.space)
          runs.push({
            text: p.text,
            face: p.face,
            size: p.size,
            color: p.color,
            x,
            width: w,
            rise: p.rise,
          });
        x += w;
      }
      out.push({
        blockId: block.id,
        unitId,
        lines: [
          { dir: [dx, dy], origin, baseline: origin.y, x0: 0, x1: length, runs, wordSpacing: 0 },
        ],
        overflow: width > length + 0.5,
        scale: opts.scale ?? 1,
      });
      continue;
    }
    const lines: LayoutLine[] = [];
    const lead = leading(block, baseStyle.size * 1.2);
    const boxSlots = slots(block);
    const lastBaseline =
      block.bbox.y1 -
      (block.lines[block.lines.length - 1]!.bbox.y1 -
        block.lines[block.lines.length - 1]!.baseline);
    for (let slot = 0; i < pieces.length; slot++) {
      const s = boxSlots[slot] ?? {
        baseline: boxSlots[boxSlots.length - 1]!.baseline + lead * (slot - boxSlots.length + 1),
        x0: block.bbox.x0,
      };
      if (s.baseline > lastBaseline + 0.5) break;
      const maxWidth = block.bbox.x1 - s.x0;
      const line: Piece[] = [];
      let width = 0;
      // Lines break only at spaces: a "word" is every non-space piece up to the next space, so
      // inline math and the text glued to it ("0,01", "ŷᵢ'nin") stay together.
      while (i < pieces.length) {
        if (pieces[i]!.space) {
          line.push(pieces[i]!);
          width += widthOf(pieces[i]!);
          i++;
          continue;
        }
        let end = i;
        let w = 0;
        while (end < pieces.length && !pieces[end]!.space) w += widthOf(pieces[end++]!);
        if (width + w > maxWidth + 0.01 && line.some((x) => !x.space)) break;
        for (; i < end; i++) line.push(pieces[i]!);
        width += w;
      }
      while (line.length && line[line.length - 1]!.space) width -= widthOf(line.pop()!);
      while (i < pieces.length && pieces[i]!.space) i++;
      const isLast = i >= pieces.length;
      const gaps = line.filter((p) => p.space).length;
      const justify = block.align === 'justify' && !isLast && gaps > 0;
      const wordSpacing = justify ? (maxWidth - width) / gaps : 0;
      let x = s.x0;
      if (block.align === 'center') x = s.x0 + (block.bbox.x1 - s.x0 - width) / 2;
      else if (block.align === 'right') x = block.bbox.x1 - width;
      const laid: LayoutRun[] = [];
      for (const p of line) {
        const w = widthOf(p) + (p.space ? wordSpacing : 0);
        if (!p.space) {
          const run: LayoutRun = {
            text: p.text,
            face: p.face,
            size: p.size,
            color: p.color,
            x,
            width: w,
            rise: p.rise,
          };
          if (p.linkUri) run.linkUri = p.linkUri;
          laid.push(run);
        }
        x += w;
      }
      lines.push({ baseline: s.baseline, x0: s.x0, x1: block.bbox.x1, runs: laid, wordSpacing });
    }
    out.push({ blockId: block.id, unitId, lines, overflow: false, scale: opts.scale ?? 1 });
  }
  if (i < pieces.length && out.length) out[out.length - 1]!.overflow = true;
  return out;
}

/**
 * Width-matching size factors: for every source font, the median ratio between the measured
 * width of its spans in the PDF and the width of the same text in the mapped Noto face.
 */
export function sizeFactors(blocks: BlockIR[], measurer: Measurer): Map<string, number> {
  const ratios = new Map<string, number[]>();
  for (const b of blocks) {
    for (const l of b.lines) {
      for (const s of l.spans) {
        const text = s.text.trim();
        if (s.font.isMath || text.length < 8) continue;
        const noto = measurer.width(
          text,
          faceKey(s.font.family, s.font.bold, s.font.italic),
          s.size,
        );
        if (noto <= 0) continue;
        const list = ratios.get(s.font.name) ?? [];
        list.push((s.bbox.x1 - s.bbox.x0) / noto);
        ratios.set(s.font.name, list);
      }
    }
  }
  const out = new Map<string, number>();
  for (const [name, list] of [...ratios].sort(([a], [b]) => a.localeCompare(b))) {
    list.sort((a, b) => a - b);
    out.set(name, Math.min(1.3, Math.max(0.7, list[Math.floor(list.length / 2)]!)));
  }
  return out;
}
