import { DISPLAY_FORMULA, type DecodedRun } from '../../core/segment/codec';
import type { BlockIR, Rect } from '../../core/ir/types';
import type { MathPart, PdfStyle } from './segments';
import { faceKey, type FaceKey, type Family, type Measurer } from './types';

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
  /** Letter spacing in em. */
  tracking?: number;
  linkUri?: string;
  underline?: boolean;
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
  /** Text did not fit in this unit's boxes (only set on the last block of a unit). */
  overflow: boolean;
  /** The text that did not fit (for overflow notes). */
  remaining?: string;
  scale: number;
}

export interface LayoutOptions {
  /** Width-matching factor per source font name (Noto size = source size × factor × scale). */
  sizeFactor: (fontName: string) => number;
  /** Uniform scale applied by layout repair (1 = none). */
  scale?: number;
  /** Boxes grown by layout repair (R2), by block id. */
  boxes?: Record<string, Rect>;
  /** Letter spacing in em (R1; negative tightens). */
  trackingEm?: number;
  /** Factor on the original line advance (R1; ≤ 1). */
  leading?: number;
  /** Factor on the natural space width (R1; ≥ 0.9 for justified text). */
  spaceFactor?: number;
}

interface Piece {
  text: string;
  face: FaceKey;
  size: number;
  color: [number, number, number];
  rise: number;
  linkUri?: string;
  underline?: boolean;
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
      // A display formula's marker: the formula is drawn where it is, not in the line.
      if (run.placeholder?.ref === DISPLAY_FORMULA) continue;
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
    for (const part of run.text.replace(/\t/g, ' ').split(/( +)/)) {
      if (!part) continue;
      // One space where a marker left two.
      if (/^ +$/.test(part) && pieces[pieces.length - 1]?.space) continue;
      const piece: Piece = {
        text: part,
        face: faceKey(s.family, s.bold, s.italic),
        size,
        color: s.color,
        rise: 0,
        space: /^ +$/.test(part),
      };
      if (s.linkUri) piece.linkUri = s.linkUri;
      if (s.underline) piece.underline = true;
      pieces.push(piece);
    }
  }
  return pieces;
}

/** Look-alikes for symbols none of the bundled faces has. */
const SUBSTITUTE: Record<string, string> = {
  '∗': '*',
  '∑': 'Σ',
  '∏': 'Π',
  '⋅': '·',
  '∕': '/',
  '∣': '|',
  '⊺': 'ᵀ',
  // CJK angle brackets: engines turn the mathematical ⟨ ⟩ into them.
  '〈': '⟨',
  '〉': '⟩',
  // The corresponding author's e-mail mark (Wingdings envelope).
  '✉': '@',
  // Word bullets (Wingdings) the bundled faces lack.
  '➢': '►',
  '➔': '→',
  '❖': '◆',
  '❑': '□',
  // Check marks in tables: the bundled faces have none.
  '✓': '√',
  '✔': '√',
  '✗': '×',
  '✘': '×',
};

/** Mathematical alphanumerics (𝑁, 𝐲): bold and italic ranges of U+1D400–U+1D49B. */
function mathStyle(cp: number): { bold: boolean; italic: boolean } {
  return {
    bold: (cp >= 0x1d400 && cp <= 0x1d433) || (cp >= 0x1d468 && cp <= 0x1d49b),
    italic: cp >= 0x1d434 && cp <= 0x1d49b,
  };
}

/**
 * Characters the chosen face lacks fall back, in order, to: their compatibility form in the same
 * family ("𝑁" → italic "N"), the mono face of the same weight (arrows, ≤), a look-alike ("∗" →
 * "*"). What still has no glyph is left as is and reported by the writer.
 */
function resolveGlyphs(pieces: Piece[], measurer: Measurer): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    if (p.space || measurer.covers(p.text, p.face)) {
      out.push(p);
      continue;
    }
    const [family, variant] = p.face.split('-') as [Family, string];
    const bold = variant.startsWith('bold');
    const italic = variant.endsWith('italic');
    const parts: Piece[] = [];
    for (const ch of p.text) {
      let text = ch;
      let face = p.face;
      if (!measurer.covers(ch, face)) {
        const compat = ch.normalize('NFKC');
        const math = mathStyle(ch.codePointAt(0)!);
        const styled = faceKey(family, bold || math.bold, italic || math.italic);
        const mono = faceKey('mono', bold, italic);
        const mathFace = faceKey('math', false, false);
        if (compat !== ch && measurer.covers(compat, styled)) [text, face] = [compat, styled];
        else if (measurer.covers(ch, mono)) face = mono;
        else if (measurer.covers(ch, mathFace)) face = mathFace;
        else if (SUBSTITUTE[ch]) {
          // The look-alike may only exist in the mono or math face (⟨ ⟩).
          const look = SUBSTITUTE[ch];
          const found = [face, mono, mathFace].find((f) => measurer.covers(look, f));
          if (found) [text, face] = [look, found];
        }
      }
      const last = parts[parts.length - 1];
      if (last?.face === face) last.text += text;
      else parts.push({ ...p, text, face });
    }
    out.push(...parts);
  }
  return out;
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
 * stay inside the box (which layout repair may have grown). Returns one layout per box;
 * `overflow` and `remaining` describe text that did not fit.
 */
export function layoutUnit(
  unitId: string,
  blocks: BlockIR[],
  runs: DecodedRun<PdfStyle>[],
  baseStyle: PdfStyle,
  measurer: Measurer,
  opts: LayoutOptions,
): BlockLayout[] {
  const pieces = resolveGlyphs(toPieces(runs, baseStyle, opts), measurer);
  const tracking = opts.trackingEm ?? 0;
  const spaceFactor = opts.spaceFactor ?? 1;
  const widthOf = (p: Piece) => {
    const w = measurer.width(p.text, p.face, p.size);
    if (p.space) return w * spaceFactor;
    return w + tracking * p.size * [...p.text].length;
  };
  const out: BlockLayout[] = [];
  let i = 0;
  while (i < pieces.length && pieces[i]!.space) i++;

  for (const block of blocks) {
    const box = opts.boxes?.[block.id] ?? block.bbox;
    if (block.direction[1] !== 0) {
      // Rotated text (chart axis labels): one line along the block's long side, centred.
      const [dx, dy] = block.direction;
      const line: Piece[] = [];
      while (i < pieces.length) line.push(pieces[i++]!);
      const length = Math.abs(dy) > Math.abs(dx) ? box.y1 - box.y0 : box.x1 - box.x0;
      const width = line.reduce((w, p) => w + widthOf(p), 0);
      const size = line.find((p) => !p.space)?.size ?? baseStyle.size;
      const descent = size * 0.22;
      // Glyph "up" is perpendicular to the direction; the baseline sits on the opposite side.
      const origin =
        dy < 0 ? { x: box.x1 - descent, y: box.y1 } : { x: box.x0 + descent, y: box.y0 };
      let x = Math.max(0, (length - width) / 2);
      const laid: LayoutRun[] = [];
      for (const p of line) {
        const w = widthOf(p);
        if (!p.space)
          laid.push({
            text: p.text,
            face: p.face,
            size: p.size,
            color: p.color,
            x,
            width: w,
            rise: p.rise,
            tracking,
          });
        x += w;
      }
      const overflow = width > length + 0.5;
      out.push({
        blockId: block.id,
        unitId,
        lines: [
          {
            dir: [dx, dy],
            origin,
            baseline: origin.y,
            x0: 0,
            x1: length,
            runs: laid,
            wordSpacing: 0,
          },
        ],
        overflow,
        scale: opts.scale ?? 1,
        ...(overflow ? { remaining: line.map((p) => p.text).join('') } : {}),
      });
      continue;
    }

    const lines: LayoutLine[] = [];
    const scale = opts.scale ?? 1;
    // Smaller type gets a proportionally smaller line advance, so scaling frees vertical space too.
    const lineFactor = (opts.leading ?? 1) * scale;
    const lead = leading(block, baseStyle.size * 1.2) * lineFactor;
    // Original line slots keep indents; with a smaller line advance they are recomputed (the first
    // baseline moves up with the smaller ascent so the block keeps its top edge).
    const original = slots(block);
    const first = original[0]!;
    const firstBaseline = first.baseline - (1 - scale) * baseStyle.size * 0.7;
    const boxSlots =
      lineFactor < 0.999
        ? original.map((s, k) => ({ x0: s.x0, baseline: firstBaseline + lead * k }))
        : original;
    const lastLine = block.lines[block.lines.length - 1]!;
    const descent = (lastLine.bbox.y1 - lastLine.baseline) * scale;
    const lastBaseline = box.y1 - descent;
    for (let slot = 0; i < pieces.length; slot++) {
      const s = boxSlots[slot] ?? {
        baseline: boxSlots[boxSlots.length - 1]!.baseline + lead * (slot - boxSlots.length + 1),
        x0: box.x0,
      };
      if (s.baseline > lastBaseline + 0.5) break;
      // Left/justified lines keep their original start (indents); centred and right-aligned
      // lines use the whole box, whatever the length of the original line in that slot.
      const x0 =
        block.align === 'center' || block.align === 'right'
          ? box.x0
          : Math.max(box.x0, Math.min(s.x0, box.x1 - 1));
      const maxWidth = box.x1 - x0;
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
        if (width + w > maxWidth + 0.01 && !line.length) {
          // A single word wider than the line: it cannot be placed here.
          break;
        }
        for (; i < end; i++) line.push(pieces[i]!);
        width += w;
      }
      while (line.length && line[line.length - 1]!.space) width -= widthOf(line.pop()!);
      if (!line.length) break;
      while (i < pieces.length && pieces[i]!.space) i++;
      const isLast = i >= pieces.length;
      const gaps = line.filter((p) => p.space).length;
      const justify = block.align === 'justify' && !isLast && gaps > 0;
      const wordSpacing = justify ? (maxWidth - width) / gaps : 0;
      let x = x0;
      if (block.align === 'center') x = x0 + (box.x1 - x0 - width) / 2;
      else if (block.align === 'right') x = box.x1 - width;
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
            tracking,
          };
          if (p.linkUri) run.linkUri = p.linkUri;
          if (p.underline) run.underline = true;
          laid.push(run);
        }
        x += w;
      }
      lines.push({ baseline: s.baseline, x0, x1: box.x1, runs: laid, wordSpacing });
    }
    out.push({ blockId: block.id, unitId, lines, overflow: false, scale });
  }
  if (i < pieces.length && out.length) {
    const last = out[out.length - 1]!;
    last.overflow = true;
    last.remaining = pieces
      .slice(i)
      .map((p) => p.text)
      .join('')
      .trim();
  }
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
