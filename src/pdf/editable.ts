import { coverage, expand, union, unionAll } from '../core/ir/geometry';
import type { BlockIR, PageIR, Rect, Role, SpanIR } from '../core/ir/types';
import { DISPLAY_FORMULA, type DecodedRun } from '../core/segment/codec';
import { equationLike, FRONT_END, mathFragments, mathLike } from './analyze/analyze';
import { TABLE_CAPTION } from './analyze/tables';
import type {
  Align,
  EditableItem,
  EditableRun,
  Frame,
  Indent,
  ParagraphKind,
  TableCell,
  WordLayout,
} from '../docx/editable';
import { MONO, MONO_WIDTH } from '../docx/editable';
import {
  hyphenEvidence,
  joinHyphen,
  type HyphenEvidence,
  type MathPart,
  type PdfStyle,
  type PdfUnit,
} from './typeset/segments';

/**
 * Editable Word output of a translated PDF (P9.4), as a reading-order flow: paragraphs with
 * Word styles, tables, and pictures for figures and display formulas. Pure: the pictures are
 * regions the caller renders from the translated PDF. A deck of slides is laid out slide by
 * slide instead: each a page, its text in frames over its picture without text.
 */

export interface EditableUnit {
  unit: PdfUnit;
  /** The translation, or the source when it was not translated. */
  runs: DecodedRun<PdfStyle>[];
  /** The scale the PDF set the translation at to fit its box (1 = the source's size). */
  scale?: number;
  /** False where the PDF left the source as it was (on a picture of the page, not covered). */
  written?: boolean;
}

export interface EditablePlan {
  items: EditableItem[];
  /** Footnotes linked to their mark in the text (runs with `footnote` point here). */
  footnotes: EditableRun[][];
  /** Regions to render, in the order the picture items index them. */
  pictures: { page: number; rect: Rect }[];
  /** Running heads, feet and page numbers left out of the flow. */
  furniture: number;
  /** The PDF's page and type for Word, when it has running text to measure. */
  layout?: WordLayout;
  /**
   * Slides: pages to render without the text set in frames (`redact`), behind it, in the order
   * the slides' `background` index them; `output`: from the translated PDF, whose covers hide
   * the words of a page that is a picture (a scan, a deck saved as pictures).
   */
  backgrounds?: { page: number; redact: Rect[]; output?: boolean }[];
}

const FURNITURE: Role[] = ['header', 'footer', 'page-number'];
/** Running text: a region holding much of it is a background (a scan, a shaded page), not a figure. */
const RUNNING: Role[] = [
  'body',
  'heading',
  'caption',
  'footnote',
  'reference',
  'code',
  'table-cell',
];

/**
 * A run's colour; near black is Word's default, and so is near white: text set on a coloured
 * bar in the PDF (a white table caption on blue) would vanish on Word's white page. On a slide,
 * over its own picture, every colour is kept (`exact`).
 */
const hex = (c: [number, number, number], exact = false) =>
  !exact && (c.every((v) => v < 0.25) || 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.85)
    ? undefined
    : c
        .map((v) =>
          Math.round(Math.min(1, Math.max(0, v)) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
        .toUpperCase();

const textOfBlock = (b: BlockIR) =>
  b.lines.map((l) => l.spans.map((s) => s.text).join('')).join(' ');
const sizeOf = (b: BlockIR) => Math.max(0, ...b.lines.flatMap((l) => l.spans.map((s) => s.size)));
const xOverlap = (a: Rect, b: Rect) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
const center = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });
const inside = (r: Rect, p: { x: number; y: number }) =>
  p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

function styledRun(text: string, style: PdfStyle | undefined, exact = false): EditableRun {
  if (!style) return { text };
  const color = hex(style.color, exact);
  return {
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.family === 'mono' ? { mono: true } : {}),
    ...(color ? { color } : {}),
    ...(style.linkUri ? { link: style.linkUri } : {}),
    // On a slide each run keeps its size (a small label over its heading).
    ...(exact ? { size: style.size } : {}),
  };
}

/** An inline formula's parts, its sub- and superscripts set as such ("v" "(u)" "t" → vₜ⁽ᵘ⁾). */
function formulaRuns(ref: string): EditableRun[] {
  return (JSON.parse(ref) as MathPart[]).map((p) => ({
    text: p.t,
    math: true,
    ...(p.d > 0.15 ? { superscript: true } : p.d < -0.1 ? { subscript: true } : {}),
  }));
}

/** A unit's runs, split where a display formula interrupts the sentence. */
function unitPieces(runs: DecodedRun<PdfStyle>[], exact = false): EditableRun[][] {
  const pieces: EditableRun[][] = [[]];
  for (const r of runs) {
    const piece = pieces[pieces.length - 1]!;
    if (r.type === 'text') {
      if (r.text) piece.push(styledRun(r.text, r.style, exact));
      continue;
    }
    const ph = r.placeholder;
    if (ph?.kind === 'I' && ph.ref === DISPLAY_FORMULA) pieces.push([]);
    else if (ph?.kind === 'N') piece.push({ text: r.text.trim(), superscript: true });
    else if (ph?.kind === 'B') piece.push({ text: '', lineBreak: true });
    else if (ph?.kind === 'T') piece.push({ text: '\t' });
    else if (ph?.kind === 'C') piece.push({ text: r.text, mono: true });
    else if (ph?.kind === 'F' && ph.ref?.startsWith('[')) piece.push(...formulaRuns(ph.ref));
    else if (ph?.kind !== 'I') piece.push({ text: r.text });
  }
  return pieces.map(tidy);
}

/** Source text of a block outside the units (kept as it is), with its formatting. */
function blockRuns(
  b: BlockIR,
  code: boolean,
  evidence?: HyphenEvidence,
  exact = false,
): EditableRun[] {
  const runs: EditableRun[] = [];
  // A listing's lines keep their indentation (Python's blocks), in spaces of its own width.
  const left = Math.min(...b.lines.map((l) => l.bbox.x0));
  const advance = code ? monoAdvance(b) : 0;
  b.lines.forEach((line, i) => {
    const pad = advance ? ' '.repeat(Math.round((line.bbox.x0 - left) / advance)) : '';
    const last = runs[runs.length - 1];
    // Hyphenation at the line end is dropped ("Jo-" + "nes"), a word's own hyphen kept.
    if (i && !code && last && /\p{L}-$/u.test(last.text))
      last.text = joinHyphen(last.text, line.spans[0]?.text ?? '', evidence);
    else if (i && !code) runs.push({ text: ' ' });
    line.spans.forEach((s: SpanIR, k) => {
      const raised = s.baseline !== undefined && s.baseline < line.baseline - s.size * 0.25;
      const lowered = s.baseline !== undefined && s.baseline > line.baseline + s.size * 0.15;
      const color = hex(s.color, exact);
      runs.push({
        text: k === 0 ? pad + s.text : s.text,
        ...(i && code && k === 0 ? { lineBreak: true } : {}),
        ...(s.font.bold ? { bold: true } : {}),
        ...(s.font.italic ? { italic: true } : {}),
        ...(s.font.family === 'mono' ? { mono: true } : {}),
        ...(raised ? { superscript: true } : lowered ? { subscript: true } : {}),
        ...(color ? { color } : {}),
        ...(s.linkUri ? { link: s.linkUri } : {}),
        ...(exact ? { size: s.size } : {}),
      });
    });
  });
  return code ? runs : tidy(runs);
}

/** The width of one character of a listing, from its lines. */
function monoAdvance(b: BlockIR): number {
  const chars = b.lines.reduce((n, l) => n + l.spans.reduce((m, s) => m + s.text.length, 0), 0);
  const width = b.lines.reduce((w, l) => w + l.bbox.x1 - l.bbox.x0, 0);
  return chars ? width / chars : 0;
}

/** A listing's size in Word that keeps its longest line to the room it has (no wrapped code). */
function codeSize(b: BlockIR, room: number, size: number): number | undefined {
  const advance = monoAdvance(b);
  const left = Math.min(...b.lines.map((l) => l.bbox.x0));
  const longest = Math.max(
    ...b.lines.map(
      (l) =>
        l.spans.reduce((n, s) => n + s.text.length, 0) +
        (advance ? Math.round((l.bbox.x0 - left) / advance) : 0),
    ),
  );
  const fit = Math.floor((2 * room) / (longest * MONO_WIDTH)) / 2;
  return fit < size ? Math.max(6, fit) : undefined;
}

/** Collapses runs of spaces and trims the paragraph; merges neighbours of the same format. */
function tidy(runs: EditableRun[]): EditableRun[] {
  const out: EditableRun[] = [];
  for (const r of runs) {
    const text = r.text.replace(/[ \u00A0]{2,}/g, ' ');
    const prev = out[out.length - 1];
    const same =
      prev &&
      !r.lineBreak &&
      JSON.stringify({ ...prev, text: '' }) === JSON.stringify({ ...r, text: '' });
    if (same) prev.text += text;
    else out.push({ ...r, text });
  }
  for (let i = 1; i < out.length; i++)
    if (out[i - 1]!.text.endsWith(' ') && out[i]!.text.startsWith(' '))
      out[i]!.text = out[i]!.text.slice(1);
  if (out[0]) out[0].text = out[0].text.trimStart();
  const last = out[out.length - 1];
  if (last) last.text = last.text.trimEnd();
  return out.filter((r) => r.text || r.lineBreak);
}

/** Heading levels from font sizes: the largest heading size is level 1 (or the title). */
function headingLevels(pages: PageIR[]): (b: BlockIR) => ParagraphKind {
  // Author names and affiliations above the abstract are set large, but are no headings.
  const first = pages[0];
  const frontEnd = Math.min(
    ...(first?.blocks ?? [])
      .filter((b) => b.role === 'heading' && FRONT_END.test(textOfBlock(b).trim()))
      .map((b) => b.bbox.y0),
  );
  const front = (b: BlockIR) =>
    !!first && b.id.startsWith(`p${first.index}-`) && b.bbox.y1 <= frontEnd;
  const headings = pages.flatMap((p) => p.blocks.filter((b) => b.role === 'heading'));
  const sizes = [...new Set(headings.map((b) => Math.round(sizeOf(b) * 2) / 2))].sort(
    (a, b) => b - a,
  );
  const top = sizes[0];
  const topBlocks = headings.filter((b) => Math.round(sizeOf(b) * 2) / 2 === top);
  // A single largest heading on the first page is the paper's title.
  const title =
    sizes.length > 1 &&
    topBlocks.length === 1 &&
    topBlocks[0]!.id.startsWith(`p${pages[0]?.index ?? 0}-`)
      ? topBlocks[0]!.id
      : null;
  const levels = [
    ...new Set(
      headings.filter((b) => b.id !== title && !front(b)).map((b) => Math.round(sizeOf(b) * 2) / 2),
    ),
  ].sort((a, b) => b - a);
  return (b) => {
    if (b.id === title) return 'title';
    if (front(b)) return 'body';
    // A numbered heading's number gives its level ("3.1 Datasets" under "3 Model Training", both
    // set in the same type in ACM papers).
    const number = /^\s*(?:\d{1,2}|[A-Z])((?:\.\d{1,2}){0,3})\.?\s+\S/u.exec(textOfBlock(b));
    if (number) {
      const depth = number[1]!.split('.').length;
      return depth <= 1 ? 'heading1' : depth === 2 ? 'heading2' : 'heading3';
    }
    const rank = levels.indexOf(Math.round(sizeOf(b) * 2) / 2);
    return rank <= 0 ? 'heading1' : rank === 1 ? 'heading2' : 'heading3';
  };
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
};
const half = (v: number) => Math.round(v * 2) / 2;

/** A Word font every Windows and Mac computer has, for the PDF's own. */
function wordFont(spans: SpanIR[]): string {
  const chars = new Map<string, number>();
  for (const s of spans) {
    const key = `${s.font.family}|${s.font.name}`;
    chars.set(key, (chars.get(key) ?? 0) + s.text.length);
  }
  const [family = 'serif', name = ''] = ([...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '')
    .toLowerCase()
    .split('|');
  // Only fonts Windows and macOS both bring (Pages reports any other as missing): a book face
  // goes to Georgia, a humanist sans to Arial.
  const known: [RegExp, string][] = [
    [/palatino|palladio|pagella|cambria|georgia/, 'Georgia'],
    [/verdana/, 'Verdana'],
    [/tahoma|segoe/, 'Tahoma'],
    [/calibri|carlito|arial|helvet|nimbussan|liberationsans|arimo|biolinum/, 'Arial'],
  ];
  const hit = known.find(([re]) => re.test(name));
  if (hit) return hit[1];
  return family === 'sans' ? 'Arial' : family === 'mono' ? MONO : 'Times New Roman';
}

/**
 * The page and type of the PDF's running text for Word: margins and text columns, fonts, the
 * size of each kind of paragraph, leading and paragraph spacing.
 */
function wordLayout(
  pages: PageIR[],
  heading: (b: BlockIR) => ParagraphKind,
): WordLayout | undefined {
  const blocks = pages.flatMap((p) =>
    p.blocks.filter((b) => !FURNITURE.includes(b.role) && b.direction[1] === 0),
  );
  const body = blocks.filter((b) => b.role === 'body' && b.lines.length >= 2);
  const first = pages[0];
  if (!first || !body.length) return undefined;
  const width = first.width;
  const height = first.height;
  const spans = body.flatMap((b) => b.lines.flatMap((l) => l.spans));
  const weighted = spans.flatMap((s) => Array<number>(Math.min(200, s.text.length)).fill(s.size));
  const bodySize = half(quantile(weighted, 0.5));
  const leads = body.flatMap((b) =>
    b.lines
      .slice(1)
      .map((l, i) => l.baseline - b.lines[i]!.baseline)
      .filter((d) => d > 0.9 * bodySize && d < 2.5 * bodySize),
  );
  const leading = half(quantile(leads, 0.5) || bodySize * 1.2);
  // Space between two paragraphs of a column beyond the leading.
  const gaps: number[] = [];
  for (const p of pages) {
    const flow = p.blocks
      .filter((b) => b.role === 'body')
      .sort((a, b) => a.readingOrder - b.readingOrder);
    for (let i = 1; i < flow.length; i++) {
      const [a, b] = [flow[i - 1]!, flow[i]!];
      // From baseline to baseline: glyph boxes vary with the font (ascenders, accents).
      const gap = b.lines[0]!.baseline - a.lines[a.lines.length - 1]!.baseline - leading;
      if (a.columnIndex === b.columnIndex && gap > -0.25 * leading && gap < 2 * leading)
        gaps.push(Math.max(0, gap));
    }
  }
  const after = half(quantile(gaps, 0.5));
  const clamp = (v: number) => Math.max(18, Math.min(0.25 * width, v));
  const top = pages.map((p) =>
    Math.min(...p.blocks.filter((b) => !FURNITURE.includes(b.role)).map((b) => b.bbox.y0)),
  );
  const bottom = pages.map((p) =>
    Math.max(...p.blocks.filter((b) => !FURNITURE.includes(b.role)).map((b) => b.bbox.y1)),
  );
  // Two or three text columns, as most pages have them.
  const multi = pages.filter((p) => p.columns.length >= 2);
  const gap = quantile(
    multi.flatMap((p) => p.columns.slice(1).map((c, i) => c.x0 - p.columns[i]!.x1)),
    0.5,
  );
  const columns =
    multi.length >= 0.5 * pages.length && gap > 4
      ? Math.round(
          quantile(
            multi.map((p) => Math.min(3, p.columns.length)),
            0.5,
          ),
        )
      : 1;
  const sizes: WordLayout['sizes'] = { body: bodySize };
  const byKind = new Map<ParagraphKind | 'table', number[]>();
  for (const b of blocks) {
    const kind = b.role === 'table-cell' ? 'table' : kindOf(b.role, b, heading);
    if (kind === 'body') continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), sizeOf(b)]);
  }
  for (const [kind, values] of byKind) sizes[kind] = half(quantile(values, 0.5));
  const headings = blocks.filter((b) => b.role === 'heading');
  return {
    margins: {
      top: clamp(quantile(top.filter(Number.isFinite), 0.25)),
      bottom: clamp(height - quantile(bottom.filter(Number.isFinite), 0.75)),
      left: clamp(
        quantile(
          body.map((b) => b.bbox.x0),
          0.05,
        ),
      ),
      right: clamp(
        width -
          quantile(
            body.map((b) => b.bbox.x1),
            0.95,
          ),
      ),
    },
    columns,
    gap: columns > 1 ? Math.max(6, Math.min(60, gap)) : 0,
    font: wordFont(spans),
    headingFont: headings.length
      ? wordFont(headings.flatMap((b) => b.lines.flatMap((l) => l.spans)))
      : wordFont(spans),
    sizes,
    leading,
    after,
  };
}

/** Across the gap between the page's two text columns. */
function acrossColumns(page: PageIR, r: Rect, layout?: WordLayout): boolean {
  const cols = page.columns;
  if (cols.length >= 2)
    return cols.slice(1).some((c, i) => r.x0 < cols[i]!.x1 - 10 && r.x1 > c.x0 + 10);
  // A page whose columns were not found (a wide table over its top half): the paper's columns.
  if (!layout || layout.columns < 2) return false;
  const n = layout.columns;
  const column =
    (page.width - layout.margins.left - layout.margins.right - (n - 1) * layout.gap) / n;
  return Array.from(
    { length: n - 1 },
    (_, i) => layout.margins.left + (i + 1) * column + i * layout.gap,
  ).some((gap) => r.x0 < gap - 10 && r.x1 > gap + layout.gap + 10);
}

/**
 * How the PDF sets a paragraph in its column: the first line indented (or hanging, for a list
 * item), the whole paragraph indented (a list, a quotation), or centred.
 */
function placement(
  page: PageIR,
  b: BlockIR,
): { indent?: Indent; centred: boolean; full: boolean; flushRight?: boolean } {
  // A page of one column: the width its running text takes.
  const text = page.blocks.filter((x) => x.role === 'body' && x.lines.length >= 2);
  const page1 = text.length
    ? { x0: Math.min(...text.map((x) => x.bbox.x0)), x1: Math.max(...text.map((x) => x.bbox.x1)) }
    : { x0: b.bbox.x0, x1: b.bbox.x1 };
  const area = acrossColumns(page, b.bbox)
    ? { x0: page.columns[0]!.x0, x1: page.columns[page.columns.length - 1]!.x1 }
    : (page.columns[b.columnIndex] ?? page1);
  const areaWidth = area.x1 - area.x0;
  const blockWidth = b.bbox.x1 - b.bbox.x0;
  // A line, or lines centred one by one; a justified paragraph set in from both sides is none.
  const centred =
    blockWidth < 0.85 * areaWidth &&
    Math.abs((b.bbox.x0 + b.bbox.x1) / 2 - (area.x0 + area.x1) / 2) < 4 &&
    b.bbox.x0 - area.x0 > 12 &&
    (b.lines.length === 1 || b.align === 'center');
  // A first line across the column: the paragraph's lines are filled (justified, when the
  // running text is), not a short line set on its own ("ACM ISBN …").
  const firstBox = b.lines[0]?.bbox;
  const full = !!firstBox && (b.lines.length < 2 || firstBox.x1 - area.x0 > 0.9 * areaWidth);
  if (centred) return { centred, full };
  // One short line at the column's right edge (an author's name set right).
  if (
    b.lines.length === 1 &&
    Math.abs(b.bbox.x1 - area.x1) < 3 &&
    b.bbox.x0 - area.x0 > 0.3 * areaWidth
  )
    return { centred, full, flushRight: true };
  // A listing's lines keep their own indentation; the block is set in from its leftmost line.
  const first =
    b.role === 'code'
      ? Math.min(...b.lines.map((l) => l.bbox.x0))
      : (b.lines[0]?.bbox.x0 ?? b.bbox.x0);
  const rest =
    b.lines.length > 1 && b.role !== 'code'
      ? Math.min(...b.lines.slice(1).map((l) => l.bbox.x0))
      : first;
  const left = rest - area.x0;
  const firstLine = first - rest;
  const indent: Indent = {};
  if (left > 4 && left < 0.4 * areaWidth) indent.left = half(left);
  // A justified block set in from both sides (an abstract, a quotation).
  const right = area.x1 - b.bbox.x1;
  if (indent.left && b.align === 'justify' && right > 4 && right < 0.4 * areaWidth)
    indent.right = half(right);
  if (Math.abs(firstLine) > 1.5 && Math.abs(firstLine) < 0.15 * areaWidth)
    indent.firstLine = half(firstLine);
  return indent.left || indent.firstLine ? { indent, centred, full } : { centred, full };
}

/** Vertical rules inside a table: a grid; else its horizontal rules only (booktabs). */
function tableBorders(page: PageIR, cells: BlockIR[]): 'grid' | 'rules' {
  const rect = unionAll(cells.map((b) => b.tableCell!.cellRect));
  const vertical = page.vectors.filter(
    (v) =>
      v.bbox.x1 - v.bbox.x0 < 2 &&
      v.bbox.y1 - v.bbox.y0 > 6 &&
      coverage(v.bbox, expand(rect, 3)) > 0.8,
  );
  return vertical.length >= 2 ? 'grid' : 'rules';
}

function kindOf(role: Role, block: BlockIR, heading: (b: BlockIR) => ParagraphKind): ParagraphKind {
  switch (role) {
    case 'heading':
      return heading(block);
    case 'caption':
      return 'caption';
    case 'footnote':
      return 'footnote';
    case 'reference':
      return 'reference';
    case 'code':
      return 'code';
    default:
      return 'body';
  }
}

/**
 * Word alignment: justified only for running text of three lines or more (short lines would
 * stretch), centred multi-line body text (a misread ragged paragraph) set left.
 */
function alignOf(b: BlockIR, kind: ParagraphKind, lines: number): Align {
  if (kind === 'title') return 'center';
  if (b.align === 'justify') return kind === 'body' && lines >= 3 ? 'justify' : 'left';
  if (b.align === 'center' && kind === 'body' && lines >= 3) return 'left';
  return b.align;
}

const EQUATION_NUMBER = /^\([\p{L}\d.,]{1,6}\)$/u;
/** Roles a piece of a display formula set as text can get. */
const FRAGMENT_ROLES: Role[] = ['body', 'footnote', 'formula', 'label', 'unknown'];

/** Text that is a piece of a formula: no word longer than three letters, or mathematics. */
function formulaPiece(text: string): boolean {
  const t = text.trim();
  // Equation numbers go with the formula on their line (below), whatever the distance.
  if (!t || t.length > 80 || EQUATION_NUMBER.test(t)) return false;
  // A section's number on its own line ("IV", "IV **" with its note mark) is a heading.
  if (/^(?:[IVXL]{1,6}|\d{1,2}(?:\.\d{1,2})*)\.?\s*[*∗†‡§¶]{0,3}$/u.test(t)) return false;
  // Short words, but not an identifier ("ACM 978-1-4503-4913-0/17/04.") or a lone full stop.
  const short =
    (t.match(/\p{L}+/gu) ?? []).every((run) => run.length <= 3) &&
    !/\d{3}/u.test(t) &&
    /[^\s.,;:…]/u.test(t);
  return (short && t.length <= 40) || mathLike(t) || equationLike(t) || mathFragments(t);
}

/** Within a few points, or on the same line close beside. */
const touching = (a: Rect, b: Rect) =>
  coverage(expand(a, 3), expand(b, 3)) > 0 ||
  (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0 && Math.max(a.x0 - b.x1, b.x0 - a.x1) < 40);

interface Picture {
  rect: Rect;
  formula: boolean;
  /** Blocks drawn in the picture rather than written as text. */
  absorbed: string[];
  /** Of those, text set inside a numbered formula ("L if x is a lower-case letter"). */
  drawn?: string[];
}

/** Figures and display formulas of a page, with the labels and equation numbers they hold. */
function pagePictures(page: PageIR, unitBlocks: Set<string>): Picture[] {
  const blocks = page.blocks.filter((b) => !FURNITURE.includes(b.role) && b.role !== 'table-cell');
  const running = (r: Rect) =>
    page.blocks
      .filter((b) => RUNNING.includes(b.role) && inside(r, center(b.bbox)))
      .reduce((n, b) => n + textOfBlock(b).length, 0);
  const pictures: Picture[] = [];
  for (const f of page.figures ?? []) {
    if (f.formula || running(f.bbox) > 200) continue;
    // A caption is written as text: a rule under it (PLOS) must not draw it into the picture.
    const rect = { ...f.bbox };
    for (const c of page.blocks.filter(
      (b) => b.role === 'caption' && coverage(b.bbox, f.bbox) > 0.5,
    )) {
      if ((c.bbox.y0 + c.bbox.y1) / 2 > (rect.y0 + rect.y1) / 2)
        rect.y1 = Math.min(rect.y1, c.bbox.y0 - 1);
      else rect.y0 = Math.max(rect.y0, c.bbox.y1 + 1);
    }
    if (rect.y1 - rect.y0 < 4) continue;
    pictures.push({ rect, formula: false, absorbed: [] });
  }
  // Display formulas: formula blocks and the pieces of a formula set as text ("∂ . (2)", "i T",
  // "Txt Tx ht h"), joined when they touch, with their fraction bars. Text in a figure (a chart's
  // ticks "0.75", its legend "BPR GMF") is drawn with the figure, not as pictures of its own.
  const inFigure = (b: BlockIR) => pictures.some((p) => coverage(b.bbox, expand(p.rect, 12)) > 0.5);
  const shapes = [
    ...blocks
      .filter(
        (b) =>
          !inFigure(b) &&
          ((b.role === 'formula' && !unitBlocks.has(b.id)) ||
            (FRAGMENT_ROLES.includes(b.role) && formulaPiece(textOfBlock(b)))),
      )
      .map((b) => ({ rect: b.bbox, ids: [b.id] })),
    ...(page.figures ?? []).filter((f) => f.formula).map((f) => ({ rect: f.bbox, ids: [] })),
  ];
  const groups: { rect: Rect; ids: string[] }[] = [];
  for (const shape of shapes) {
    let g = { rect: shape.rect, ids: [...shape.ids] };
    for (let i = groups.length - 1; i >= 0; i--)
      if (touching(groups[i]!.rect, g.rect)) {
        g = { rect: union(g.rect, groups[i]!.rect), ids: [...groups[i]!.ids, ...g.ids] };
        groups.splice(i, 1);
      }
    groups.push(g);
  }
  for (const g of groups)
    if (g.ids.length) pictures.push({ rect: g.rect, formula: true, absorbed: g.ids });
  // Labels and formula pieces belong to the picture they touch, equation numbers to their formula.
  for (const p of pictures) {
    const around = expand(p.rect, 12);
    for (const b of blocks) {
      if (pictures.some((q) => q.absorbed.includes(b.id))) continue;
      const text = textOfBlock(b).trim();
      const label =
        ['label', 'formula', 'unknown'].includes(b.role) && coverage(b.bbox, around) > 0.5;
      const number =
        p.formula &&
        EQUATION_NUMBER.test(text) &&
        Math.min(b.bbox.y1, p.rect.y1) - Math.max(b.bbox.y0, p.rect.y0) >
          0.5 * (b.bbox.y1 - b.bbox.y0) &&
        (xOverlap(b.bbox, p.rect) > 0 ||
          Math.max(b.bbox.x0 - p.rect.x1, p.rect.x0 - b.bbox.x1) < 300);
      if (label || number) p.absorbed.push(b.id);
    }
    const absorbed = blocks.filter((b) => p.absorbed.includes(b.id));
    p.rect = expand(unionAll([p.rect, ...absorbed.map((b) => b.bbox)]), 2);
    p.rect = {
      x0: Math.max(0, p.rect.x0),
      y0: Math.max(0, p.rect.y0),
      x1: Math.min(page.width, p.rect.x1),
      y1: Math.min(page.height, p.rect.y1),
    };
    // A numbered formula with words in it (the cases of a definition): its lines of text are
    // drawn in the formula, as in the PDF, not written out again beside it.
    const numbered = absorbed.some((b) => EQUATION_NUMBER.test(textOfBlock(b).trim()));
    // Each line taken in widens the formula, which can reach the next ("L if …" over "U if …").
    for (let more = p.formula && numbered; more;) {
      more = false;
      for (const b of blocks) {
        if (b.role !== 'body' || pictures.some((q) => q.absorbed.includes(b.id))) continue;
        if (b.lines.length <= 6 && coverage(b.bbox, expand(p.rect, 4)) > 0.6) {
          p.absorbed.push(b.id);
          (p.drawn ??= []).push(b.id);
          p.rect = union(p.rect, expand(b.bbox, 2));
          more = true;
        }
      }
    }
  }
  joinPanels(page, blocks, pictures);
  // A group that ends up inside a figure once its labels are in (the little table drawn in a
  // workflow diagram) is part of that figure, not a picture of its own.
  const figures = pictures.filter((p) => !p.formula);
  // A bar with a running head in it ("Leitthema" on the journal's colour) and no image is the
  // page's decoration.
  // So is an empty shape at the page's edge (a coloured tab bled off the page) or a small one
  // (the box behind a page number).
  const decoration = (p: Picture) => {
    if (page.images.some((i) => coverage(i.bbox, p.rect) > 0)) return false;
    const inside = page.blocks.filter((b) => coverage(b.bbox, p.rect) > 0.5);
    const { x0, y0, x1, y1 } = p.rect;
    const edge = x0 < 2 || y0 < 2 || x1 > page.width - 2 || y1 > page.height - 2;
    return inside.length
      ? inside.every((b) => FURNITURE.includes(b.role))
      : edge || (x1 - x0 < 40 && y1 - y0 < 40);
  };
  return pictures.filter((p) => {
    const host = p.formula && figures.find((f) => coverage(p.rect, f.rect) > 0.5);
    if (host) host.absorbed.push(...p.absorbed);
    return !host && !decoration(p) && p.rect.x1 - p.rect.x0 > 4 && p.rect.y1 - p.rect.y0 > 4;
  });
}

/**
 * A figure of panels over one caption ("(a)" … "(d)", each with its title and legend) is one
 * picture with the short text between and over its panels: a legend beside a panel is no
 * paragraph of the page. Panels with running text between them and the caption are left apart.
 */
function joinPanels(page: PageIR, blocks: BlockIR[], pictures: Picture[]): void {
  const short = (b: BlockIR) => b.lines.length <= 3 && textOfBlock(b).trim().length <= 80;
  const running = (b: BlockIR) => RUNNING.includes(b.role) && !short(b);
  for (const c of page.blocks) {
    if (c.role !== 'caption' || TABLE_CAPTION.test(textOfBlock(c).trim())) continue;
    const panels = pictures.filter((p) => {
      if (p.formula || p.rect.y1 > c.bbox.y0 + 2) return false;
      const { x } = center(p.rect);
      if (x < c.bbox.x0 - 2 || x > c.bbox.x1 + 2) return false;
      return !page.blocks.some(
        (b) =>
          running(b) &&
          b.bbox.y0 >= p.rect.y1 - 2 &&
          b.bbox.y1 <= c.bbox.y0 + 2 &&
          xOverlap(b.bbox, p.rect) > 0,
      );
    });
    if (!panels.length) continue;
    const others = pictures.filter((q) => !panels.includes(q));
    const free = (b: BlockIR) =>
      b.role !== 'caption' && short(b) && !others.some((q) => q.absorbed.includes(b.id));
    const band = {
      x0: c.bbox.x0 - 2,
      y0: Math.min(...panels.map((p) => p.rect.y0)),
      x1: c.bbox.x1 + 2,
      y1: c.bbox.y0 - 1,
    };
    const taken = new Set(blocks.filter((b) => free(b) && inside(band, center(b.bbox))));
    // A panel's title just over it ("npm", "PyPI").
    for (let more = true; more;) {
      more = false;
      for (const b of blocks) {
        if (taken.has(b) || !free(b) || b.role === 'body' || b.bbox.y1 > band.y0 + 2) continue;
        if (band.y0 - b.bbox.y1 > 14 || xOverlap(b.bbox, band) <= 0) continue;
        taken.add(b);
        band.y0 = Math.min(band.y0, b.bbox.y0);
        more = true;
      }
    }
    if (panels.length < 2 && !taken.size) continue;
    const joined: Picture = {
      rect: expand(unionAll([...panels.map((p) => p.rect), ...[...taken].map((b) => b.bbox)]), 2),
      formula: false,
      absorbed: [
        ...new Set([...panels.flatMap((p) => p.absorbed), ...[...taken].map((b) => b.id)]),
      ],
    };
    const drawn = panels.flatMap((p) => p.drawn ?? []);
    if (drawn.length) joined.drawn = drawn;
    pictures.splice(0, pictures.length, ...others, joined);
  }
}

function tableItem(
  cells: BlockIR[],
  content: (b: BlockIR) => EditableRun[][],
): Extract<EditableItem, { kind: 'table' }> {
  const rows = Math.max(...cells.map((b) => b.tableCell!.row)) + 1;
  const cols = Math.max(...cells.map((b) => b.tableCell!.col)) + 1;
  const x0 = Array.from({ length: cols }, (_, c) =>
    Math.min(
      ...cells.filter((b) => b.tableCell!.col === c).map((b) => b.tableCell!.cellRect.x0),
      Infinity,
    ),
  );
  const right = Math.max(...cells.map((b) => b.tableCell!.cellRect.x1));
  const source = x0.map((x, c) => {
    const next = x0.slice(c + 1).find((v) => Number.isFinite(v)) ?? right;
    return Number.isFinite(x) ? Math.max(12, next - x) : 12;
  });
  // Each column as wide as its longest text and Word's cell margins (4 pt on each side), the
  // rest of the table's width shared out as on the page: a right-aligned column's cell starts
  // next to the column before it, which would leave that one too narrow for its words.
  const text = source.map((s, c) =>
    Math.max(
      12,
      ...cells
        .filter((b) => b.tableCell!.col === c && b.bbox.x1 - b.bbox.x0 <= 1.2 * s + 20)
        .map((b) => b.bbox.x1 - b.bbox.x0),
    ),
  );
  const need = text.map((t) => t + 8);
  const slack = Math.max(0, source.reduce((a, b) => a + b, 0) - need.reduce((a, b) => a + b, 0));
  const room = source.map((s, c) => Math.max(0, s - need[c]!));
  const roomTotal = room.reduce((a, b) => a + b, 0);
  const columns = need.map((n, c) =>
    roomTotal ? n + (slack * room[c]!) / roomTotal : n + slack / need.length,
  );
  const grid: TableCell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ paragraphs: [] })),
  );
  // A column's text set flush right (figures) or centred in it.
  const edges = Array.from({ length: cols }, (_, c) => {
    const own = cells.filter((b) => b.tableCell!.col === c && b.tableCell!.cellRect.x0 >= x0[c]!);
    return own.length
      ? {
          x0: Math.min(...own.map((b) => b.bbox.x0)),
          x1: Math.max(...own.map((b) => b.bbox.x1)),
        }
      : null;
  });
  const alignIn = (b: BlockIR): Align | undefined => {
    const edge = edges[b.tableCell!.col];
    if (!edge || edge.x1 - edge.x0 < 6) return undefined;
    const flushRight = Math.abs(b.bbox.x1 - edge.x1) < 1.5 && b.bbox.x0 - edge.x0 > 3;
    const centred =
      !flushRight &&
      Math.abs((b.bbox.x0 + b.bbox.x1) / 2 - (edge.x0 + edge.x1) / 2) < 1.5 &&
      b.bbox.x0 - edge.x0 > 3;
    return flushRight ? 'right' : centred ? 'center' : undefined;
  };
  // The lines of a cell are one paragraph.
  for (const b of [...cells].sort((p, q) => p.bbox.y0 - q.bbox.y0 || p.bbox.x0 - q.bbox.x0)) {
    const { row, col, cellRect } = b.tableCell!;
    const cell = grid[row]![col]!;
    // A cell across columns (a source note under the figures, a group header).
    const span = x0.filter((x, c) => c > col && Number.isFinite(x) && x < cellRect.x1 - 2).length;
    if (span && b.bbox.x1 > (x0[col + 1] ?? Infinity))
      cell.span = Math.max(cell.span ?? 1, span + 1);
    const align = alignIn(b);
    if (align && !cell.paragraphs.length) cell.align = align;
    for (const runs of content(b)) {
      if (!cell.paragraphs.length) cell.paragraphs.push([]);
      const para = cell.paragraphs[0]!;
      if (para.length) para.push({ text: ' ' });
      para.push(...runs);
    }
  }
  // A column is set one way: a cell as wide as the column ("80,5") cannot tell, the narrower
  // ones ("9", "12") can, and it follows them.
  for (let c = 0; c < cols; c++) {
    const set = grid.map((r) => r[c]!).filter((cell) => cell.paragraphs.length && !cell.span);
    const told = set.filter((cell) => cell.align);
    const centre = told.filter((cell) => cell.align === 'center').length;
    const right = told.filter((cell) => cell.align === 'right').length;
    const way = centre > told.length / 2 ? 'center' : right > told.length / 2 ? 'right' : undefined;
    if (way) for (const cell of set) if (!cell.align) cell.align = way;
  }
  // A cell's next line is a row of its own in the PDF ("… Shannon entropy of strings in" | "all
  // source code files"): a row without a first cell, all in lower case, continues the row above.
  const rowsOut: TableCell[][] = [];
  const plain = (c: TableCell) =>
    c.paragraphs
      .flat()
      .map((r) => r.text)
      .join('')
      .trim();
  for (const row of grid) {
    const prev = rowsOut[rowsOut.length - 1];
    const texts = row.map(plain);
    const continues =
      prev &&
      !texts[0] &&
      rowsOut.some((r) => plain(r[0]!)) &&
      texts.some(Boolean) &&
      texts.every((t) => !t || /^\p{Ll}/u.test(t));
    // A figure's interval or count under it ("21,4" | "(19,9–23,0)"): the cell's second line.
    const under =
      prev &&
      !texts[0] &&
      texts.some(Boolean) &&
      texts.every((t, i) => !t || (/^\(.*\)$/u.test(t) && !!plain(prev[i]!)));
    if (!continues && !under) {
      rowsOut.push(row);
      continue;
    }
    row.forEach((cell, i) => {
      if (!cell.paragraphs.length) return;
      const target = prev[i]!;
      if (under) {
        target.paragraphs.push(cell.paragraphs.flat());
        return;
      }
      if (!target.paragraphs.length) target.paragraphs.push([]);
      const para = target.paragraphs[0]!;
      if (para.length) para.push({ text: ' ' });
      para.push(...cell.paragraphs.flat());
    });
  }
  return { kind: 'table', columns, rows: rowsOut };
}

/** A numbered reference entry's first line ("[20] …", "20. …"). */
const ENTRY = /^(?:\[\d{1,3}\]|\d{1,3}\.)\s/u;

/** A reference block split before each line after the first that starts an entry. */
function entryParts(b: BlockIR): BlockIR[] {
  const starts = b.lines.flatMap((l, i) =>
    i && ENTRY.test(l.spans.map((s) => s.text).join('')) ? [i] : [],
  );
  if (!starts.length) return [b];
  return [0, ...starts].map((s, k, all) => ({ ...b, lines: b.lines.slice(s, all[k + 1]) }));
}

const MARK = /^(?:\d{1,3}|[a-z]|[*∗†‡§¶]{1,2})$/u;

/**
 * A symbol mark set in the text's own size, glued to the word or quote it follows ("gospodarcze”*
 * W Szwecji"): split out of its run as the footnote reference.
 */
function inlineMark(
  item: EditableItem & { kind: 'paragraph' },
  mark: string,
): EditableRun | undefined {
  if (!/^[*∗†‡§¶]{1,2}$/u.test(mark)) return undefined;
  const escaped = mark.replace(/\*/g, '\\*');
  // Not the last star of another mark ("**").
  const at = new RegExp(`(?<=[^\\s*∗†‡§¶])${escaped}(?![*∗†‡§¶])`, 'gu');
  // Set apart at the end of the paragraph: a short heading's mark ("IV **").
  const end = new RegExp(`(?:(?<=\\S)|^)\\s+${escaped}\\s*$`, 'u');
  for (let k = item.runs.length - 1; k >= 0; k--) {
    const run = item.runs[k]!;
    if (run.superscript || run.footnote !== undefined || run.link) continue;
    const glued = [...run.text.matchAll(at)].pop()?.index;
    const apart =
      k === item.runs.length - 1 && end.test(run.text)
        ? run.text.trimEnd().length - mark.length
        : undefined;
    // A run of its own glued to the run before ("38,39" then "*").
    const alone =
      run.text.trim() === mark && k > 0 && /\S$/u.test(item.runs[k - 1]!.text)
        ? run.text.indexOf(mark)
        : undefined;
    const index = glued ?? apart ?? alone;
    if (index === undefined) continue;
    const target = { ...run, text: mark };
    item.runs.splice(k, 1, { ...run, text: run.text.slice(0, index).trimEnd() }, target, {
      ...run,
      text: run.text.slice(index + mark.length),
    });
    return target;
  }
  return undefined;
}

/**
 * Footnotes become Word footnotes when their mark is found as a superscript earlier on the same
 * or the previous page (the nearest one), or a symbol mark glued to a word; the others stay
 * where they are, as Footnote Text.
 */
function linkFootnotes(items: EditableItem[], pageStarts: number[]): EditableRun[][] {
  const footnotes: EditableRun[][] = [];
  const removed = new Set<number>();
  // The item and page of the last note linked.
  let lastNote = -1;
  let notePage = -1;
  for (let i = 0; i < items.length; i++) {
    const note = items[i]!;
    if (note.kind !== 'paragraph' || note.style !== 'footnote' || !note.runs.length) continue;
    const first = note.runs[0]!;
    let mark: string | null = null;
    let rest: EditableRun[] = [];
    if (first.superscript && MARK.test(first.text.trim())) {
      mark = first.text.trim();
      rest = note.runs.slice(1);
    } else {
      // The mark may be a run of its own ("31 ", then "Rocher de bronze").
      const m = /^(\d{1,3}|[*∗†‡§¶]{1,2})(?:\s+|(?=\S)|$)/u.exec(first.text);
      if (m) {
        mark = m[1]!;
        rest = [{ ...first, text: first.text.slice(m[0].length) }, ...note.runs.slice(1)];
      }
    }
    const page = pageStarts.filter((s) => s <= i).length - 1;
    if (!mark) {
      // A note going on from the page before ("głosów z 3 milionów …"): the first note of its
      // page, without a mark, right after a note linked on that page that did not end, joins it.
      const between = items
        .slice(lastNote + 1, i)
        .some((it) => it.kind === 'paragraph' && it.style === 'footnote');
      const last = footnotes[footnotes.length - 1];
      const ended = /[.!?…)\]”»"]$/u.test(
        (last ?? [])
          .map((r) => r.text)
          .join('')
          .trimEnd(),
      );
      const lower = /^\p{Ll}/u.test(first.text.trimStart());
      // Or a line of it set apart right under it on the same page (an address: "Salvador BA
      // Brasil.").
      const under = lastNote === i - 1 && notePage === page;
      const turned = !between && notePage === page - 1 && (!ended || lower);
      if (last && lastNote >= 0 && (under || turned)) {
        last.push({ text: ' ' }, { ...first, text: first.text.trimStart() }, ...note.runs.slice(1));
        removed.add(i);
        lastNote = i;
        notePage = page;
      }
      continue;
    }
    const from = pageStarts[Math.max(0, page - 1)] ?? 0;
    let target: EditableRun | undefined;
    const find = (item: EditableItem & { kind: 'paragraph' }) =>
      [...item.runs]
        .reverse()
        .find(
          (r) => r.superscript && !r.math && r.footnote === undefined && r.text.trim() === mark,
        ) ?? inlineMark(item, mark);
    for (let j = i - 1; j >= from && !target; j--) {
      const item = items[j]!;
      if (removed.has(j)) continue;
      // A table's note ("38,39*" in a cell, "*Estudos brasileiros." under the table).
      if (item.kind === 'table')
        for (const runs of item.rows
          .flat()
          .flatMap((c) => c.paragraphs)
          .reverse()) {
          target = find({ kind: 'paragraph', style: 'body', align: 'left', runs });
          if (target) break;
        }
      if (item.kind !== 'paragraph' || item.style === 'footnote') continue;
      target = find(item);
    }
    if (!target) continue;
    target.text = '';
    target.footnote = footnotes.length;
    rest[0] = { ...rest[0]!, text: rest[0]!.text.trimStart() };
    footnotes.push(rest.filter((r) => r.text || r.lineBreak));
    removed.add(i);
    lastNote = i;
    notePage = page;
  }
  const kept = items.filter((_, i) => !removed.has(i));
  items.splice(0, items.length, ...kept);
  return footnotes;
}

export function planEditable(
  pages: PageIR[],
  units: EditableUnit[],
  include: (page: number) => boolean = () => true,
): EditablePlan {
  const shown = pages.filter((p) => include(p.index));
  if (slideDeck(shown)) return planSlides(shown, units);
  const items: EditableItem[] = [];
  const pictures: EditablePlan['pictures'] = [];
  let furniture = 0;
  const evidence = hyphenEvidence(pages);
  const heading = headingLevels(shown);
  const layout = wordLayout(shown, heading);
  // Running text set justified: every body paragraph is, its short ones too.
  const long = shown.flatMap((p) =>
    p.blocks.filter((b) => b.role === 'body' && b.lines.length >= 3),
  );
  const justified =
    long.length > 0 && long.filter((b) => b.align === 'justify').length >= 0.5 * long.length;
  const unitBlocks = new Set(units.flatMap((u) => u.unit.blocks.map((b) => b.id)));
  const pagePictureMap = new Map(shown.map((p) => [p.index, pagePictures(p, unitBlocks)]));
  const absorbed = new Set([...pagePictureMap.values()].flat().flatMap((p) => p.absorbed));
  /** Labels drawn in a figure: the figure shows their translation, they are never text too. */
  const figureLabels = new Set(
    [...pagePictureMap.values()].flat().flatMap((p) => (p.formula ? (p.drawn ?? []) : p.absorbed)),
  );
  // Where each unit's pieces go: its first block, then each block after a display formula. A
  // piece whose block is drawn in a picture (a formula set as text that starts the sentence)
  // moves to the unit's next block of text; with none, a piece with words stays as text.
  const slots = new Map<string, { role: Role; pieces: EditableRun[][]; lines: number }>();
  for (const u of units) {
    const pieces = unitPieces(u.runs);
    const blocks = u.unit.blocks;
    const slotBlocks = blocks.filter((b, i) => i === 0 || b.chain?.afterFormula);
    const assigned = new Map<string, number[]>();
    slotBlocks.forEach((b, k) => {
      const own = k === slotBlocks.length - 1 ? pieces.map((_, i) => i).slice(k) : [k];
      assigned.set(
        b.id,
        own.filter((i) => i < pieces.length),
      );
    });
    for (const b of slotBlocks) {
      const own = assigned.get(b.id)!;
      if (!absorbed.has(b.id) || !own.length) continue;
      const at = blocks.indexOf(b);
      const target =
        blocks.slice(at + 1).find((x) => !absorbed.has(x.id)) ??
        [...blocks.slice(0, at)].reverse().find((x) => !absorbed.has(x.id));
      if (target) {
        assigned.delete(b.id);
        assigned.set(
          target.id,
          [...(assigned.get(target.id) ?? []), ...own].sort((x, y) => x - y),
        );
      } else if (
        !figureLabels.has(b.id) &&
        own.some((i) => pieces[i]!.some((r) => /\p{L}{4}/u.test(r.text)))
      )
        absorbed.delete(b.id);
    }
    for (const [id, own] of assigned)
      slots.set(id, {
        role: u.unit.role,
        lines: blocks.reduce((n, x) => n + x.lines.length, 0),
        pieces: own.map((i) => pieces[i]!),
      });
  }

  /** Paragraphs of text kept as it is, by chain, for the chain's next blocks (any page). */
  const kept = new Map<string, Extract<EditableItem, { kind: 'paragraph' }>>();
  /** Index of the first item of each page. */
  const pageStarts: number[] = [];
  for (const page of shown) {
    pageStarts.push(items.length);
    const pagePics = pagePictureMap.get(page.index)!;
    const order = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    const flow = columnsFirst(
      page,
      order.filter((b) => !absorbed.has(b.id) && !FURNITURE.includes(b.role)),
      layout,
    );
    // A stamp turned in the margin (arXiv's id and date) keeps its place on the page, as it is.
    const stamps = order.filter(
      (b) => FURNITURE.includes(b.role) && b.direction[1] !== 0 && textOfBlock(b).trim(),
    );
    for (const b of stamps) {
      // As a picture of it: Pages sets turned text a letter per line.
      const rect = expand(b.bbox, 1);
      pictures.push({ page: page.index, rect });
      items.push({
        kind: 'stamp',
        text: b.lines
          .map((l) => l.spans.map((s) => s.text).join(''))
          .join(' ')
          .trim(),
        x: rect.x0,
        y: rect.y0,
        width: rect.x1 - rect.x0,
        height: rect.y1 - rect.y0,
        picture: pictures.length - 1,
      });
    }
    furniture += order.filter((b) => FURNITURE.includes(b.role)).length - stamps.length;
    // A picture goes before the first block below it that shares its column.
    const anchors = new Map<string, Picture[]>();
    const trailing: Picture[] = [];
    for (const p of [...pagePics].sort((a, b) => a.rect.y0 - b.rect.y0 || a.rect.x0 - b.rect.x0)) {
      const next = flow.find((b) => b.bbox.y0 >= p.rect.y1 - 4 && xOverlap(b.bbox, p.rect) > 0);
      if (next) anchors.set(next.id, [...(anchors.get(next.id) ?? []), p]);
      else trailing.push(p);
    }
    const emitPicture = (p: Picture) => {
      pictures.push({ page: page.index, rect: p.rect });
      items.push({
        kind: 'picture',
        picture: pictures.length - 1,
        width: p.rect.x1 - p.rect.x0,
        height: p.rect.y1 - p.rect.y0,
        ...(layout && layout.columns > 1 && acrossColumns(page, p.rect, layout)
          ? { wide: true }
          : {}),
      });
    };
    const content = (b: BlockIR): EditableRun[][] => {
      const slot = slots.get(b.id);
      if (slot) return slot.pieces.filter((r) => r.length);
      if (unitBlocks.has(b.id)) return [];
      const runs = blockRuns(b, b.role === 'code', evidence);
      return runs.length ? [runs] : [];
    };
    const tables = new Set<string>();
    const done = new Set<string>();
    const front = page === shown[0] ? frontMatter(page) : null;
    const grid = front ? authorGrid(page, front.end) : null;
    const emitBlock = (b: BlockIR) => {
      // A reference block can hold the start of the next entry ("… 1392. [20] Ladisa …" when
      // the text extraction joined their lines): each entry is a paragraph of its own.
      const parts = b.role === 'reference' && !unitBlocks.has(b.id) ? entryParts(b) : [b];
      for (const [k, part] of parts.entries()) {
        // Text kept as it is that continues a chain (a reference entry's next line) joins the
        // paragraph its chain started.
        const chained =
          !k && b.chain && b.chain.index > 0 ? kept.get(b.chain.paragraphId) : undefined;
        if (chained && !unitBlocks.has(b.id)) {
          const runs = blockRuns(part, false, evidence);
          const last = chained.runs[chained.runs.length - 1];
          if (last && /\p{L}-$/u.test(last.text))
            last.text = joinHyphen(last.text, runs[0]?.text ?? '', evidence);
          else chained.runs.push({ text: ' ' });
          chained.runs.push(...runs);
          continue;
        }
        const role = slots.get(b.id)?.role ?? b.role;
        const kind = kindOf(role, part, heading);
        const lines = slots.get(b.id)?.lines ?? part.lines.length;
        const { indent, centred, full, flushRight } = placement(page, part);
        const inFront = !!front && part.bbox.y1 <= front.end;
        let align = alignOf(part, kind, lines);
        if (kind === 'body')
          align = centred
            ? 'center'
            : justified && full
              ? 'justify'
              : align === 'center' && !inFront
                ? 'left'
                : align;
        // A reference entry or footnote is filled or set ragged, never right or centred (its
        // hanging lines end at the column's edge).
        if (kind === 'reference' || kind === 'footnote')
          align = part.align === 'justify' && full ? 'justify' : 'left';
        // A heading or caption of one line centred in its column (an author's name under the
        // title): its own box cannot tell, the column can.
        else if (kind !== 'body' && kind !== 'code' && centred) align = 'center';
        if (flushRight && kind !== 'code') align = 'right';
        const size = half(mainSize(part));
        const wide =
          !!layout &&
          layout.columns > 1 &&
          (acrossColumns(page, part.bbox, layout) || (inFront && (centred || kind === 'title')));
        const text = layout
          ? page.width - layout.margins.left - layout.margins.right
          : page.width - 144;
        const room =
          layout && !wide ? (text - (layout.columns - 1) * layout.gap) / layout.columns : text;
        const fitted =
          kind === 'code'
            ? codeSize(part, room - (indent?.left ?? 0), layout?.sizes.code ?? size)
            : undefined;
        for (const [n, runs] of content(part).entries()) {
          const item: Extract<EditableItem, { kind: 'paragraph' }> = {
            kind: 'paragraph',
            style: kind,
            align,
            runs,
            // The text after a display formula goes on without a new first line.
            ...(kind === 'body' && indent && !(n && indent.firstLine)
              ? { indent }
              : kind === 'body' && indent?.left
                ? {
                    indent: { left: indent.left, ...(indent.right ? { right: indent.right } : {}) },
                  }
                : {}),
            ...(kind === 'body' && layout && Math.abs(size - (layout.sizes.body ?? size)) > 0.6
              ? { size }
              : {}),
            ...(kind === 'code' && indent?.left ? { indent: { left: indent.left } } : {}),
            ...(kind === 'code' && fitted ? { size: fitted } : {}),
            ...(wide ? { wide } : {}),
          };
          items.push(item);
          if (b.chain && !unitBlocks.has(b.id)) kept.set(b.chain.paragraphId, item);
        }
      }
    };
    for (const b of flow) {
      if (done.has(b.id)) continue;
      for (const p of anchors.get(b.id) ?? []) emitPicture(p);
      const row = grid?.find((r) => r.some((cell) => cell.some((x) => x.id === b.id)));
      if (row && grid) {
        // A grid of authors: one row of names and affiliations side by side, as on the page.
        const cols = Math.max(...grid.map((r) => r.length));
        const width = layout
          ? (page.width - layout.margins.left - layout.margins.right) / cols
          : (page.width - 144) / cols;
        items.push({
          kind: 'table',
          borders: 'none',
          wide: true,
          columns: Array<number>(cols).fill(width),
          rows: [
            Array.from({ length: cols }, (_, c) => ({
              align: 'center' as const,
              paragraphs: (row[c] ?? []).flatMap((x) => {
                done.add(x.id);
                return content(x);
              }),
            })),
          ],
        });
        continue;
      }
      if (b.tableCell) {
        const id = b.tableCell.tableId;
        if (tables.has(id)) continue;
        tables.add(id);
        const cells = flow.filter((c) => c.tableCell?.tableId === id);
        const table = tableItem(cells, content);
        // One column is not a table (a framed title block): its cells are paragraphs.
        if (table.columns.length > 1) {
          // A caption set above its table (ACM, IEEE) comes first in Word too.
          const rect = unionAll(cells.map((c) => c.tableCell!.cellRect));
          const caption = flow.find(
            (c) =>
              c.role === 'caption' &&
              !done.has(c.id) &&
              c.bbox.y1 <= rect.y0 + 2 &&
              rect.y0 - c.bbox.y1 < 30 &&
              xOverlap(c.bbox, rect) > 0,
          );
          const wide = !!layout && layout.columns > 1 && acrossColumns(page, rect, layout);
          if (caption) {
            const from = items.length;
            emitBlock(caption);
            done.add(caption.id);
            // Over a table across both columns, its caption is too.
            if (wide)
              for (const it of items.slice(from)) if (it.kind === 'paragraph') it.wide = true;
          }
          items.push({
            ...table,
            borders: tableBorders(page, cells),
            ...(wide ? { wide: true } : {}),
          });
        } else
          // …each in its own kind: a listing framed by rules stays code.
          for (const c of cells) {
            done.add(c.id);
            emitBlock(c);
          }
        continue;
      }
      done.add(b.id);
      emitBlock(b);
    }
    trailing.forEach(emitPicture);
  }
  const footnotes = linkFootnotes(items, pageStarts);
  return { items, footnotes, pictures, furniture, ...(layout ? { layout } : {}) };
}

/**
 * A page of a two-column paper whose columns were not found (a wide table over its top) is read
 * top to bottom; between the items across both columns, its left column comes before its right.
 */
function columnsFirst(page: PageIR, flow: BlockIR[], layout?: WordLayout): BlockIR[] {
  if (page.columns.length >= 2 || !layout || layout.columns < 2) return flow;
  const tables = new Map<string, Rect>();
  for (const b of flow)
    if (b.tableCell) {
      const id = b.tableCell.tableId;
      const rect = tables.get(id);
      tables.set(id, rect ? union(rect, b.tableCell.cellRect) : b.tableCell.cellRect);
    }
  const across = (b: BlockIR) =>
    acrossColumns(page, b.tableCell ? tables.get(b.tableCell.tableId)! : b.bbox, layout);
  const middle =
    layout.margins.left + (page.width - layout.margins.left - layout.margins.right) / 2;
  const out: BlockIR[] = [];
  let band: BlockIR[] = [];
  const close = () => {
    out.push(...band.filter((b) => b.bbox.x0 < middle), ...band.filter((b) => b.bbox.x0 >= middle));
    band = [];
  };
  for (const b of flow) {
    if (across(b)) {
      close();
      out.push(b);
    } else band.push(b);
  }
  close();
  return out;
}

/** The type size most of a block's text is set in. */
function mainSize(b: BlockIR): number {
  const sizes = b.lines.flatMap((l) =>
    l.spans.flatMap((s) => Array<number>(Math.min(200, s.text.length)).fill(s.size)),
  );
  return quantile(sizes, 0.5) || sizeOf(b);
}

/** The first page's title block: everything above the abstract or the first section. */
function frontMatter(page: PageIR): { end: number } | null {
  const end = Math.min(
    ...page.blocks
      .filter((b) => b.role === 'heading' && FRONT_END.test(textOfBlock(b).trim()))
      .map((b) => b.bbox.y0),
  );
  return Number.isFinite(end) ? { end } : null;
}

/**
 * Authors set side by side above the abstract (ACM, IEEE): rows of names, each with the
 * affiliation lines under it. Null when the names are not side by side.
 */
function authorGrid(page: PageIR, end: number): BlockIR[][][] | null {
  const front = page.blocks.filter(
    (b) =>
      b.bbox.y1 <= end && !FURNITURE.includes(b.role) && b.bbox.x1 - b.bbox.x0 < 0.6 * page.width,
  );
  const names = front.filter((b) => b.role === 'heading');
  const beside = (a: BlockIR, b: BlockIR) =>
    Math.min(a.bbox.y1, b.bbox.y1) > Math.max(a.bbox.y0, b.bbox.y0) &&
    (a.bbox.x1 <= b.bbox.x0 || b.bbox.x1 <= a.bbox.x0);
  if (!names.some((a) => names.some((b) => beside(a, b)))) return null;
  const overlap = (a: BlockIR, b: BlockIR) =>
    xOverlap(a.bbox, b.bbox) > 0.5 * Math.min(a.bbox.x1 - a.bbox.x0, b.bbox.x1 - b.bbox.x0);
  const groups = new Map<BlockIR, BlockIR[]>(names.map((n) => [n, [n]]));
  for (const b of front) {
    if (groups.has(b)) continue;
    const name = names
      .filter((n) => n.bbox.y1 <= b.bbox.y0 + 2 && overlap(n, b))
      .sort((p, q) => q.bbox.y1 - p.bbox.y1)[0];
    if (!name) return null;
    groups.get(name)!.push(b);
  }
  const rows = new Map<number, BlockIR[][]>();
  for (const n of [...names].sort((a, b) => a.bbox.x0 - b.bbox.x0)) {
    const key = [...rows.keys()].find((y) => Math.abs(y - n.bbox.y0) < 6) ?? n.bbox.y0;
    rows.set(key, [...(rows.get(key) ?? []), groups.get(n)!.sort((a, b) => a.bbox.y0 - b.bbox.y0)]);
  }
  // A row of one (the title over the grid, a last author alone) stays a centred paragraph.
  return [...rows]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => cells)
    .filter((cells) => cells.length >= 2);
}

/** A deck of slides: every page much wider than tall (16:9, 4:3). */
export function slideDeck(pages: PageIR[]): boolean {
  return pages.length > 0 && pages.every((p) => p.width >= 1.25 * p.height);
}

/** Top of a font's line to its baseline, and baseline to bottom, in em (Windows metrics). */
const ASCENT: [RegExp, number, number][] = [
  [/consolas/i, 0.743, 0.257],
  [/calibri/i, 0.952, 0.269],
  [/segoe/i, 1.079, 0.251],
  [/verdana|tahoma/i, 1.005, 0.21],
  [/georgia/i, 0.917, 0.219],
  [/arial/i, 0.905, 0.212],
];
const metrics = (font: string) => {
  const hit = ASCENT.find(([re]) => re.test(font));
  return { ascent: hit?.[1] ?? 0.891, descent: hit?.[2] ?? 0.216 };
};

/**
 * Slides for Word: each page a slide, each block of text (translated or kept) a frame where the
 * slide sets it, in the slide's colours and type — the size the PDF fitted the translation at.
 * Furniture is text of the slide too. What is not set in a frame (text turned on its side, words
 * drawn as pictures) stays in the slide's picture.
 */
function planSlides(shown: PageIR[], units: EditableUnit[]): EditablePlan {
  const items: EditableItem[] = [];
  const backgrounds: NonNullable<EditablePlan['backgrounds']> = [];
  const evidence = hyphenEvidence(shown);
  const unitOf = new Map<string, EditableUnit>();
  for (const u of units) for (const b of u.unit.blocks) unitOf.set(b.id, u);
  for (const page of shown) {
    const frames: Frame[] = [];
    const redact: Rect[] = [];
    const here = new Set(page.blocks.map((b) => b.id));
    const done = new Set<string>();
    const order = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    // The slide's usual type, by characters: a block well above it is a title.
    const bodySize =
      quantile(
        page.blocks.flatMap((x) =>
          x.lines.flatMap((l) =>
            l.spans.flatMap((s) => Array<number>(Math.min(200, s.text.length)).fill(s.size)),
          ),
        ),
        0.5,
      ) || 12;
    for (const b of order) {
      if (done.has(b.id) || b.direction[1] !== 0 || !b.lines.length) continue;
      const u = unitOf.get(b.id);
      // A unit's text goes in one frame over its blocks on this page, when they stand in one
      // column; on another page or column, the frame of its first block grows down.
      const blocks = u
        ? u.unit.blocks.filter(
            (x) => here.has(x.id) && x.direction[1] === 0 && xOverlap(x.bbox, b.bbox) > 0,
          )
        : [b];
      for (const x of blocks) done.add(x.id);
      // On a picture of the page, text the PDF did not cover (numbers, names kept as they are)
      // shows in the picture already: a frame would set it twice.
      if (page.ocr && (!u || u.written === false)) continue;
      // Its blocks in another column: their text is in this frame, taken off the picture.
      for (const x of u?.unit.blocks ?? [])
        if (here.has(x.id) && !blocks.includes(x) && !done.has(x.id)) {
          done.add(x.id);
          redact.push(x.bbox);
        }
      if (u && u.unit.blocks[0]!.id !== b.id && !here.has(u.unit.blocks[0]!.id)) {
        // Its text went in the frame on the page where it starts.
        redact.push(...blocks.map((x) => x.bbox));
        continue;
      }
      const rect = unionAll(blocks.map((x) => x.bbox));
      const lines = blocks.flatMap((x) => x.lines);
      const scale = Math.min(1, Math.max(0.5, u?.scale ?? 1));
      const pieces = (
        u ? unitPieces(u.runs, true) : [blockRuns(b, b.role === 'code', evidence, true)]
      )
        .filter((r) => r.length)
        .map((runs) =>
          lineBreaks(runs, lines).map((r) =>
            r.size ? { ...r, size: Math.max(4, half(r.size * scale)) } : r,
          ),
        );
      if (!pieces.length) continue;
      const spans = blocks.flatMap((x) => x.lines.flatMap((l) => l.spans));
      const font = wordFont(spans);
      const size = Math.max(4, half(mainSize(b) * scale));
      const gaps = lines
        .slice(1)
        .map((l, i) => l.baseline - lines[i]!.baseline)
        .filter((d) => d > 0.8 * mainSize(b) && d < 3 * mainSize(b));
      const leading = gaps.length ? half(quantile(gaps, 0.5) * scale) : undefined;
      const { ascent, descent } = metrics(font);
      const first = lines[0]!.baseline;
      // Word sets the first baseline an ascent below the frame's top, or at the leading less
      // the descent when the line is set at least that high.
      const drop = Math.max(ascent * size, leading ? leading - descent * size : 0);
      // Room for Word's fonts and a longer translation: a paragraph a little wider; a line of its
      // own (a title, a label) up to what stands beside it — the next text, the edge of the box
      // it is drawn in, the page's edge. Centred text widens on both sides, text set right to the
      // left.
      const { left, right, below, box } = room(page, rect);
      const slack = Math.min(24, 0.04 * (rect.x1 - rect.x0) + 3);
      const single = lines.length === 1;
      // A line against its box's right edge and far from its left one is set right (the header
      // of a table's number column).
      const flushRight =
        single &&
        b.align === 'left' &&
        !!box &&
        box.x1 - rect.x1 < 12 &&
        rect.x0 - box.x0 > 3 * Math.max(1, box.x1 - rect.x1);
      const align: Align = flushRight
        ? 'right'
        : b.align === 'justify'
          ? lines.length >= 3
            ? 'justify'
            : 'left'
          : b.align;
      const span = (wider: boolean): [number, number] => {
        if (align === 'center') {
          const c = (rect.x0 + rect.x1) / 2;
          const halfWidth = wider
            ? Math.max((rect.x1 - rect.x0) / 2 + 2, Math.min(c - left, right - c))
            : (rect.x1 - rect.x0 + slack) / 2;
          return [c - halfWidth, c + halfWidth];
        }
        if (align === 'right')
          return [wider ? Math.min(left, rect.x0 - 2) : rect.x0 - slack, rect.x1];
        return [rect.x0, wider ? Math.max(right, rect.x1 + 2) : rect.x1 + slack];
      };
      const top = Math.max(0, first - drop);
      // A translation longer in Word's type than the slide's box: its own box first, in type a
      // little smaller rather than a line more; then it runs down to the text below it; then its
      // type shrinks to fit. A title widens into the room beside it (as the PDF's box did)
      // before it runs down, running text the other way round.
      const own = rect.y1 - top + 0.2 * size;
      const fits = (s: [number, number], f: number, height: number) =>
        setHeight(pieces, s[1] - s[0], font, size, leading, f) <= height + 2;
      const [narrow, wide] = [span(single), span(true)];
      const title = mainSize(b) >= 1.3 * bodySize;
      const down = below - top;
      const widths = title ? [narrow, wide] : [narrow];
      const tries: [[number, number], number, number][] = [
        ...[1, 0.95, 0.9, 0.85].flatMap((v) =>
          widths.map((s): [[number, number], number, number] => [s, own, v]),
        ),
        ...(title ? [wide, narrow] : [narrow, wide]).map(
          (s): [[number, number], number, number] => [s, down, 1],
        ),
      ];
      const chosen = tries.find(([s, h, v]) => fits(s, v, h));
      const [x0, x1] = chosen?.[0] ?? wide;
      let f = chosen?.[2] ?? 1;
      while (f > 0.6 && !fits([x0, x1], f, down)) f -= 0.05;
      const fit = (v: number) => Math.max(4, half(v * f));
      // Pages sets a frame as a box of its height and hides a line that does not fit in it
      // (Word and WPS grow it): as high as its lines come out here, and a line more for type that
      // runs wider.
      const needed = setHeight(pieces, x1 - x0, font, size, leading, f) + descent * size * f;
      frames.push({
        x: Math.max(0, x0),
        y: top,
        width: Math.min(page.width, x1) - Math.max(0, x0),
        height: Math.max(rect.y1 - top, needed) + 1.2 * size * f,
        paragraphs: pieces.map((runs) => ({
          runs: f < 1 ? runs.map((r) => (r.size ? { ...r, size: fit(r.size) } : r)) : runs,
          align,
          size: fit(size),
          font,
          ...(leading ? { leading: half(leading * f) } : {}),
        })),
      });
      for (const x of blocks)
        redact.push(x.bbox, ...(x.underlines ?? []), ...(x.extraRedact ?? []));
    }
    // A picture of a page has its words in it: the translated PDF covers them; all its text is
    // set in frames.
    backgrounds.push(
      page.ocr
        ? {
            page: page.index,
            redact: [{ x0: 0, y0: 0, x1: page.width, y1: page.height }],
            output: true,
          }
        : { page: page.index, redact },
    );
    items.push({
      kind: 'slide',
      width: page.width,
      height: page.height,
      background: backgrounds.length - 1,
      frames,
    });
  }
  return { items, footnotes: [], pictures: [], furniture: 0, backgrounds };
}

/**
 * How far a block of a slide may grow: across to the nearest text beside it, the box it is drawn
 * in, or the page's edge; down to the text under it.
 */
function room(page: PageIR, r: Rect): { left: number; right: number; below: number; box?: Rect } {
  // Within the slide's text: no wider than its widest lines reach.
  const text = page.blocks.filter((b) => b.direction[1] === 0).map((b) => b.bbox);
  let left = Math.max(Math.min(r.x0, 18), Math.min(...text.map((o) => o.x0)));
  let right = Math.min(Math.max(r.x1, page.width - 18), Math.max(...text.map((o) => o.x1)));
  let below = page.height - 12;
  const beside = (o: Rect) =>
    Math.min(o.y1, r.y1) - Math.max(o.y0, r.y0) > 0.3 * Math.min(r.y1 - r.y0, o.y1 - o.y0);
  // The text around it, and the panels and cards drawn beside or under it.
  const contains = (o: Rect) =>
    o.x0 <= r.x0 + 1 && o.x1 >= r.x1 - 1 && o.y0 <= r.y0 + 1 && o.y1 >= r.y1 - 1;
  const obstacles = [
    ...page.blocks.map((b) => b.bbox),
    ...page.vectors
      .filter((v) => v.isRectangle && !contains(v.bbox))
      .map((v) => v.bbox)
      .filter((o) => (o.x1 - o.x0) * (o.y1 - o.y0) < 0.9 * page.width * page.height),
  ];
  for (const o of obstacles) {
    if (o === r) continue;
    if (o.y0 >= r.y1 - 1 && xOverlap(o, r) > 0) below = Math.min(below, o.y0 - 2);
    if (!beside(o)) continue;
    if (o.x0 >= r.x1 - 1) right = Math.min(right, o.x0 - 6);
    else if (o.x1 <= r.x0 + 1) left = Math.max(left, o.x1 + 6);
  }
  const box = page.vectors
    .filter(
      (v) =>
        v.isRectangle &&
        v.bbox.x0 <= r.x0 + 1 &&
        v.bbox.x1 >= r.x1 - 1 &&
        v.bbox.y0 <= r.y0 + 1 &&
        v.bbox.y1 >= r.y1 - 1 &&
        (v.bbox.x1 - v.bbox.x0) * (v.bbox.y1 - v.bbox.y0) < 0.9 * page.width * page.height,
    )
    .sort(
      (a, b) =>
        (a.bbox.x1 - a.bbox.x0) * (a.bbox.y1 - a.bbox.y0) -
        (b.bbox.x1 - b.bbox.x0) * (b.bbox.y1 - b.bbox.y0),
    )[0];
  if (box) {
    left = Math.max(left, box.bbox.x0 + 4);
    right = Math.min(right, box.bbox.x1 - 4);
    below = Math.min(below, box.bbox.y1 - 2);
  }
  return {
    left: Math.min(left, r.x0),
    right: Math.max(right, r.x1),
    below: Math.max(below, r.y1),
    ...(box ? { box: box.bbox } : {}),
  };
}

/** Width of a font's letters against Arial's. */
const FONT_WIDTH: [RegExp, number][] = [
  [/verdana/i, 1.15],
  [/tahoma|georgia/i, 1.05],
  [/times/i, 0.9],
];

/** Rough width of text as Word sets it (points): capitals, digits, narrow letters, spaces. */
function textWidth(text: string, size: number, font: string, bold: boolean): number {
  if (font === MONO) return [...text].length * MONO_WIDTH * size;
  let em = 0;
  for (const ch of text)
    em += /\s/u.test(ch)
      ? 0.28
      : /\p{Lu}/u.test(ch)
        ? 0.68
        : /\d/u.test(ch)
          ? 0.56
          : /[iljtfrI.,:;'’!|]/u.test(ch)
            ? 0.3
            : /\p{L}/u.test(ch)
              ? 0.53
              : 0.4;
  const factor = FONT_WIDTH.find(([re]) => re.test(font))?.[1] ?? 1;
  return em * size * factor * (bold ? 1.07 : 1);
}

/**
 * The height a frame's paragraphs take at `width` (points), their type scaled by `f`: words laid
 * line by line as Word breaks them, each line as high as its largest type or the leading.
 */
function setHeight(
  pieces: EditableRun[][],
  width: number,
  font: string,
  size: number,
  leading: number | undefined,
  f: number,
): number {
  let height = 0;
  for (const runs of pieces) {
    let x = 0;
    let line = 0;
    const end = () => {
      height += Math.max(leading ? leading * f : 0, 1.17 * (line || size * f));
      x = 0;
      line = 0;
    };
    for (const r of runs) {
      if (r.lineBreak && (x || line)) end();
      const s = (r.size ?? size) * f;
      const face = r.mono ? MONO : font;
      for (const word of r.text.split(/(?<=\s)/u)) {
        const w = textWidth(word, s, face, !!r.bold);
        if (x && x + textWidth(word.trimEnd(), s, face, !!r.bold) > width) end();
        x += w;
        line = Math.max(line, s);
      }
    }
    end();
  }
  return height;
}

const lineSize = (l: BlockIR['lines'][number]) => Math.max(0, ...l.spans.map((s) => s.size));

/**
 * The lines of a slide's text that the translation runs together: list items that each open
 * with the same sign ("> SCA", "> SAST") and lines of their own size (a small "01" over its
 * heading) start a line again in the translation.
 */
function lineBreaks(runs: EditableRun[], lines: BlockIR['lines']): EditableRun[] {
  if (lines.length < 2) return runs;
  const opening = lines.map(
    (l) => /^\s*([>»•▪►‣◦–→✓✔□■●○*-])\s/u.exec(l.spans.map((s) => s.text).join(''))?.[1],
  );
  const mark = opening[0] && opening.every((m) => m === opening[0]) ? opening[0] : null;
  const sizes = lines.map(lineSize);
  const stacked = sizes.some(
    (v, i) => i > 0 && Math.abs(v - sizes[i - 1]!) > 0.25 * Math.max(v, sizes[i - 1]!),
  );
  if (!mark && !stacked) return runs;
  const out: EditableRun[] = [];
  const add = (r: EditableRun, text: string, br: boolean) => {
    if (!text) return;
    if (br && out.length) {
      const last = out[out.length - 1]!;
      last.text = last.text.trimEnd();
    }
    out.push({
      ...r,
      text: br && out.length ? text.trimStart() : text,
      ...(br && out.length ? { lineBreak: true } : {}),
    });
  };
  for (const r of runs) {
    const prev = out[out.length - 1];
    // A run of another size where the source's lines change size.
    const resized =
      stacked &&
      !!prev?.size &&
      !!r.size &&
      !r.superscript &&
      !r.subscript &&
      Math.abs(prev.size - r.size) > 0.25 * Math.max(prev.size, r.size);
    if (!mark) {
      add(r, r.text, resized);
      continue;
    }
    // Before each sign that opens an item, after the first.
    const parts: string[] = [];
    let from = 0;
    // Google may drop the space before it ("SCA> SAST"); not before a dash or star, which also
    // stand inside words.
    for (let i = 1; i < r.text.length; i++)
      if (
        r.text.startsWith(`${mark} `, i) &&
        (/\s/u.test(r.text[i - 1]!) || !/[-–*]/u.test(mark))
      ) {
        parts.push(r.text.slice(from, i));
        from = i;
      }
    parts.push(r.text.slice(from));
    parts.forEach((p, i) =>
      add(
        r,
        p,
        resized && i === 0
          ? true
          : p.startsWith(mark) && /\S/u.test(out.map((o) => o.text).join('')),
      ),
    );
  }
  return out;
}
