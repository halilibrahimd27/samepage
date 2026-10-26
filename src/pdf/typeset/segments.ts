import { encode, type Encoded, type InlineRun } from '../../core/segment/codec';
import type { BlockIR, PageIR, Role, SpanIR } from '../../core/ir/types';
import type { Family } from './types';

/** One glyph run of an inline formula: text, size relative to the line, baseline shift (em, up). */
export interface MathPart {
  t: string;
  r: number;
  d: number;
}

export interface PdfStyle {
  family: Family;
  bold: boolean;
  italic: boolean;
  color: [number, number, number];
  size: number;
  /** Original font name (size compensation is computed per source font). */
  fontName: string;
  linkUri?: string;
  underline?: boolean;
}

/** One translation unit: a paragraph chain (or a single block) and its tagged text. */
export interface PdfUnit {
  id: string;
  role: Role;
  blocks: BlockIR[];
  encoded: Encoded<PdfStyle>;
}

const styleKey = (s: PdfStyle) =>
  `${s.family}|${s.bold ? 'b' : ''}${s.italic ? 'i' : ''}${s.underline ? 'u' : ''}|${s.color.map((c) => Math.round(c * 50)).join(',')}|${Math.round(s.size * 2)}|${s.linkUri ?? ''}`;

function styleOf(span: SpanIR): PdfStyle {
  const style: PdfStyle = {
    family: span.font.family,
    bold: span.font.bold,
    italic: span.font.italic,
    color: span.color,
    size: span.size,
    fontName: span.font.name,
  };
  if (span.linkUri) style.linkUri = span.linkUri;
  if (span.underline) style.underline = true;
  return style;
}

/** Superscript marks (footnote numbers, ordinals): small and raised above the line's baseline. */
function isSuperscript(span: SpanIR, lineSize: number, baseline: number): boolean {
  const spanBaseline = span.baseline ?? span.bbox.y1 - span.size * 0.2;
  return (
    span.size < lineSize * 0.8 &&
    baseline - spanBaseline > lineSize * 0.2 &&
    /^[\d*†‡§,–-]+$/.test(span.text.trim())
  );
}

function blockRuns(block: BlockIR, runs: InlineRun<PdfStyle>[]): void {
  block.lines.forEach((line, li) => {
    const lineSize =
      Math.max(...line.spans.filter((s) => !s.font.isMath).map((s) => s.size), 0) ||
      line.spans[0]!.size;
    line.spans.forEach((span, si) => {
      let text = span.text;
      const isLastSpan = si === line.spans.length - 1;
      const nextLine = block.lines[li + 1];
      // Join hyphenated line ends: "ge-" + "lişme" → "gelişme".
      if (
        isLastSpan &&
        nextLine &&
        /\p{L}-$/u.test(text) &&
        /^\p{Ll}/u.test(nextLine.spans[0]?.text ?? '')
      )
        text = text.slice(0, -1);
      else if (isLastSpan && li < block.lines.length - 1 && !text.endsWith(' ')) text += ' ';
      if (span.font.isMath) {
        // Adjacent math spans form one formula atom; each part keeps its relative size and
        // baseline shift so sub/superscripts are re-set correctly.
        const part: MathPart = {
          t: span.text,
          r: Math.round((span.size / lineSize) * 100) / 100,
          d:
            Math.round(((line.baseline - (span.baseline ?? line.baseline)) / lineSize) * 100) / 100,
        };
        const prev = runs[runs.length - 1];
        if (prev?.type === 'atom' && prev.kind === 'F' && prev.ref) {
          const parts = JSON.parse(prev.ref) as MathPart[];
          parts.push(part);
          runs[runs.length - 1] = {
            ...prev,
            text: prev.text + span.text,
            ref: JSON.stringify(parts),
          };
        } else {
          runs.push({ type: 'atom', kind: 'F', text: span.text, ref: JSON.stringify([part]) });
        }
      } else if (isSuperscript(span, lineSize, line.baseline))
        runs.push({ type: 'atom', kind: 'N', text: span.text.trim() });
      else runs.push({ type: 'text', text, style: styleOf(span) });
    });
  });
}

/** Builds translation units from analysed pages: one per chain (head first) or translatable block. */
export function buildPdfUnits(pages: PageIR[]): PdfUnit[] {
  const byId = new Map(pages.flatMap((p) => p.blocks).map((b) => [b.id, b]));
  const units: PdfUnit[] = [];
  for (const page of pages) {
    for (const block of [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder)) {
      if (!block.translatable || (block.chain && block.chain.index > 0)) continue;
      const blocks = [block];
      let next = block.chain?.next;
      while (next) {
        const b = byId.get(next);
        if (!b) break;
        blocks.push(b);
        next = b.chain?.next;
      }
      const runs: InlineRun<PdfStyle>[] = [];
      blocks.forEach((b, i) => {
        blockRuns(b, runs);
        const last = runs[runs.length - 1];
        if (i < blocks.length - 1 && last?.type === 'text' && !last.text.endsWith(' ')) {
          // A chain continues in the next box: hyphenated words are joined, otherwise a space.
          if (/\p{L}-$/u.test(last.text)) last.text = last.text.slice(0, -1);
          else last.text += ' ';
        }
      });
      const last = runs[runs.length - 1];
      if (last?.type === 'text') last.text = last.text.trimEnd();
      // Units without letters (numbers, symbols, pure formulas) are left untouched.
      if (!runs.some((r) => r.type === 'text' && /\p{L}/u.test(r.text))) continue;
      units.push({
        id: block.chain?.paragraphId ?? block.id,
        role: block.role,
        blocks,
        encoded: encode(runs, styleKey),
      });
    }
  }
  return units;
}
