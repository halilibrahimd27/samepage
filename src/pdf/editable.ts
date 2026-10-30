import { coverage, expand, union, unionAll } from '../core/ir/geometry';
import type { BlockIR, PageIR, Rect, Role, SpanIR } from '../core/ir/types';
import { DISPLAY_FORMULA, type DecodedRun } from '../core/segment/codec';
import { equationLike, FRONT_END, mathFragments, mathLike } from './analyze/analyze';
import type {
  Align,
  EditableItem,
  EditableRun,
  Indent,
  ParagraphKind,
  TableCell,
  WordLayout,
} from '../docx/editable';
import {
  hyphenEvidence,
  joinHyphen,
  type HyphenEvidence,
  type PdfStyle,
  type PdfUnit,
} from './typeset/segments';

/**
 * Editable Word output of a translated PDF (P9.4), as a reading-order flow: paragraphs with
 * Word styles, tables, and pictures for figures and display formulas. Pure: the pictures are
 * regions the caller renders from the translated PDF.
 */

export interface EditableUnit {
  unit: PdfUnit;
  /** The translation, or the source when it was not translated. */
  runs: DecodedRun<PdfStyle>[];
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

const hex = (c: [number, number, number]) =>
  c.every((v) => v < 0.25)
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

function styledRun(text: string, style: PdfStyle | undefined): EditableRun {
  if (!style) return { text };
  const color = hex(style.color);
  return {
    text,
    ...(style.bold ? { bold: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.family === 'mono' ? { mono: true } : {}),
    ...(color ? { color } : {}),
    ...(style.linkUri ? { link: style.linkUri } : {}),
  };
}

/** A unit's runs, split where a display formula interrupts the sentence. */
function unitPieces(runs: DecodedRun<PdfStyle>[]): EditableRun[][] {
  const pieces: EditableRun[][] = [[]];
  for (const r of runs) {
    const piece = pieces[pieces.length - 1]!;
    if (r.type === 'text') {
      if (r.text) piece.push(styledRun(r.text, r.style));
      continue;
    }
    const ph = r.placeholder;
    if (ph?.kind === 'I' && ph.ref === DISPLAY_FORMULA) pieces.push([]);
    else if (ph?.kind === 'N') piece.push({ text: r.text.trim(), superscript: true });
    else if (ph?.kind === 'B') piece.push({ text: '', lineBreak: true });
    else if (ph?.kind === 'T') piece.push({ text: '\t' });
    else if (ph?.kind === 'C') piece.push({ text: r.text, mono: true });
    else if (ph?.kind !== 'I') piece.push({ text: r.text });
  }
  return pieces.map(tidy);
}

/** Source text of a block outside the units (kept as it is), with its formatting. */
function blockRuns(b: BlockIR, code: boolean, evidence?: HyphenEvidence): EditableRun[] {
  const runs: EditableRun[] = [];
  b.lines.forEach((line, i) => {
    const last = runs[runs.length - 1];
    // Hyphenation at the line end is dropped ("Jo-" + "nes"), a word's own hyphen kept.
    if (i && !code && last && /\p{L}-$/u.test(last.text))
      last.text = joinHyphen(last.text, line.spans[0]?.text ?? '', evidence);
    else if (i && !code) runs.push({ text: ' ' });
    line.spans.forEach((s: SpanIR, k) => {
      const raised = s.baseline !== undefined && s.baseline < line.baseline - s.size * 0.25;
      const color = hex(s.color);
      runs.push({
        text: s.text,
        ...(i && code && k === 0 ? { lineBreak: true } : {}),
        ...(s.font.bold ? { bold: true } : {}),
        ...(s.font.italic ? { italic: true } : {}),
        ...(s.font.family === 'mono' ? { mono: true } : {}),
        ...(raised ? { superscript: true } : {}),
        ...(color ? { color } : {}),
        ...(s.linkUri ? { link: s.linkUri } : {}),
      });
    });
  });
  return code ? runs : tidy(runs);
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
  const known: [RegExp, string][] = [
    [/palatino|palladio|pagella/, 'Palatino Linotype'],
    [/garamond/, 'Garamond'],
    [/georgia/, 'Georgia'],
    [/cambria/, 'Cambria'],
    [/calibri|carlito/, 'Calibri'],
    [/verdana/, 'Verdana'],
    [/tahoma/, 'Tahoma'],
    [/segoe/, 'Segoe UI'],
    [/arial|helvet|nimbussan|liberationsans|arimo|biolinum/, 'Arial'],
  ];
  const hit = known.find(([re]) => re.test(name));
  if (hit) return hit[1];
  return family === 'sans' ? 'Arial' : family === 'mono' ? 'Courier New' : 'Times New Roman';
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
      const gap = b.bbox.y0 - a.bbox.y1;
      if (a.columnIndex === b.columnIndex && gap >= 0 && gap < 3 * leading) gaps.push(gap);
    }
  }
  const after = half(Math.max(0, quantile(gaps, 0.5) - Math.max(0, leading - bodySize)));
  const clamp = (v: number) => Math.max(18, Math.min(0.25 * width, v));
  const top = pages.map((p) =>
    Math.min(...p.blocks.filter((b) => !FURNITURE.includes(b.role)).map((b) => b.bbox.y0)),
  );
  const bottom = pages.map((p) =>
    Math.max(...p.blocks.filter((b) => !FURNITURE.includes(b.role)).map((b) => b.bbox.y1)),
  );
  const twoColumns = pages.filter((p) => p.columns.length >= 2);
  const gap = quantile(
    twoColumns.map((p) => p.columns[1]!.x0 - p.columns[0]!.x1),
    0.5,
  );
  const columns = twoColumns.length >= 0.5 * pages.length && gap > 4 ? 2 : 1;
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
  const [left, right] = page.columns;
  if (left && right) return r.x0 < left.x1 - 10 && r.x1 > right.x0 + 10;
  // A page whose columns were not found (a wide table over its top half): the paper's columns.
  if (!layout || layout.columns < 2) return false;
  const column = (page.width - layout.margins.left - layout.margins.right - layout.gap) / 2;
  const gap = layout.margins.left + column;
  return r.x0 < gap - 10 && r.x1 > gap + layout.gap + 10;
}

/**
 * How the PDF sets a paragraph in its column: the first line indented (or hanging, for a list
 * item), the whole paragraph indented (a list, a quotation), or centred.
 */
function placement(page: PageIR, b: BlockIR): { indent?: Indent; centred: boolean; full: boolean } {
  const area = acrossColumns(page, b.bbox)
    ? { x0: page.columns[0]!.x0, x1: page.columns[1]!.x1 }
    : (page.columns[b.columnIndex] ?? { x0: b.bbox.x0, x1: b.bbox.x1 });
  const areaWidth = area.x1 - area.x0;
  const blockWidth = b.bbox.x1 - b.bbox.x0;
  const centred =
    blockWidth < 0.85 * areaWidth &&
    Math.abs((b.bbox.x0 + b.bbox.x1) / 2 - (area.x0 + area.x1) / 2) < 4 &&
    b.bbox.x0 - area.x0 > 12;
  // A first line across the column: the paragraph's lines are filled (justified, when the
  // running text is), not a short line set on its own ("ACM ISBN …").
  const firstBox = b.lines[0]?.bbox;
  const full = !!firstBox && (b.lines.length < 2 || firstBox.x1 - area.x0 > 0.9 * areaWidth);
  if (centred) return { centred, full };
  const first = b.lines[0]?.bbox.x0 ?? b.bbox.x0;
  const rest = b.lines.length > 1 ? Math.min(...b.lines.slice(1).map((l) => l.bbox.x0)) : first;
  const left = rest - area.x0;
  const firstLine = first - rest;
  const indent: Indent = {};
  if (left > 4 && left < 0.4 * areaWidth) indent.left = half(left);
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
    pictures.push({ rect: f.bbox, formula: false, absorbed: [] });
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
  // A group that ends up inside a figure once its labels are in (the little table drawn in a
  // workflow diagram) is part of that figure, not a picture of its own.
  const figures = pictures.filter((p) => !p.formula);
  return pictures.filter((p) => {
    const host = p.formula && figures.find((f) => coverage(p.rect, f.rect) > 0.5);
    if (host) host.absorbed.push(...p.absorbed);
    return !host && p.rect.x1 - p.rect.x0 > 4 && p.rect.y1 - p.rect.y0 > 4;
  });
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
    const { row, col } = b.tableCell!;
    const cell = grid[row]![col]!;
    const align = alignIn(b);
    if (align && !cell.paragraphs.length) cell.align = align;
    for (const runs of content(b)) {
      if (!cell.paragraphs.length) cell.paragraphs.push([]);
      const para = cell.paragraphs[0]!;
      if (para.length) para.push({ text: ' ' });
      para.push(...runs);
    }
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
    if (!continues) {
      rowsOut.push(row);
      continue;
    }
    row.forEach((cell, i) => {
      if (!cell.paragraphs.length) return;
      const target = prev[i]!;
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

const MARK = /^(?:\d{1,3}|[a-z]|[*†‡§¶]{1,2})$/u;

/**
 * A symbol mark set in the text's own size, glued to the word or quote it follows ("gospodarcze”*
 * W Szwecji"): split out of its run as the footnote reference.
 */
function inlineMark(
  item: EditableItem & { kind: 'paragraph' },
  mark: string,
): EditableRun | undefined {
  if (!/^[*†‡§¶]{1,2}$/u.test(mark)) return undefined;
  const at = new RegExp(`(?<=\\S)${mark.replace(/\*/g, '\\*')}(?![*†‡§¶])`, 'gu');
  for (let k = item.runs.length - 1; k >= 0; k--) {
    const run = item.runs[k]!;
    if (run.superscript || run.footnote !== undefined || run.link) continue;
    const found = [...run.text.matchAll(at)].pop();
    if (found?.index === undefined) continue;
    const target = { ...run, text: mark };
    item.runs.splice(k, 1, { ...run, text: run.text.slice(0, found.index) }, target, {
      ...run,
      text: run.text.slice(found.index + mark.length),
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
      const m = /^(\d{1,3}|[*†‡§¶]{1,2})(?:\s+|(?=\S)|$)/u.exec(first.text);
      if (m) {
        mark = m[1]!;
        rest = [{ ...first, text: first.text.slice(m[0].length) }, ...note.runs.slice(1)];
      }
    }
    if (!mark) continue;
    const page = pageStarts.filter((s) => s <= i).length - 1;
    const from = pageStarts[Math.max(0, page - 1)] ?? 0;
    let target: EditableRun | undefined;
    for (let j = i - 1; j >= from && !target; j--) {
      const item = items[j]!;
      if (item.kind !== 'paragraph' || item.style === 'footnote' || removed.has(j)) continue;
      target =
        [...item.runs]
          .reverse()
          .find((r) => r.superscript && r.footnote === undefined && r.text.trim() === mark) ??
        inlineMark(item, mark);
    }
    if (!target) continue;
    target.text = '';
    target.footnote = footnotes.length;
    rest[0] = { ...rest[0]!, text: rest[0]!.text.trimStart() };
    footnotes.push(rest.filter((r) => r.text || r.lineBreak));
    removed.add(i);
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
  const items: EditableItem[] = [];
  const pictures: EditablePlan['pictures'] = [];
  let furniture = 0;
  const shown = pages.filter((p) => include(p.index));
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
    furniture += order.filter((b) => FURNITURE.includes(b.role)).length;
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
        const { indent, centred, full } = placement(page, part);
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
        const size = half(mainSize(part));
        const wide =
          !!layout &&
          layout.columns > 1 &&
          (acrossColumns(page, part.bbox, layout) || (inFront && (centred || kind === 'title')));
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
                ? { indent: { left: indent.left } }
                : {}),
            ...(kind === 'body' && layout && Math.abs(size - (layout.sizes.body ?? size)) > 0.6
              ? { size }
              : {}),
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
          if (caption) {
            emitBlock(caption);
            done.add(caption.id);
          }
          items.push({
            ...table,
            borders: tableBorders(page, cells),
            ...(layout && layout.columns > 1 && acrossColumns(page, rect, layout)
              ? { wide: true }
              : {}),
          });
        } else
          for (const runs of table.rows.flatMap((r) => r.flatMap((c) => c.paragraphs)))
            items.push({ kind: 'paragraph', style: 'body', align: 'left', runs });
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
