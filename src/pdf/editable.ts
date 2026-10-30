import { coverage, expand, union, unionAll } from '../core/ir/geometry';
import type { BlockIR, PageIR, Rect, Role, SpanIR } from '../core/ir/types';
import { DISPLAY_FORMULA, type DecodedRun } from '../core/segment/codec';
import { equationLike, FRONT_END, mathFragments, mathLike } from './analyze/analyze';
import type { Align, EditableItem, EditableRun, ParagraphKind, TableCell } from '../docx/editable';
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
    const rank = levels.indexOf(Math.round(sizeOf(b) * 2) / 2);
    return rank <= 0 ? 'heading1' : rank === 1 ? 'heading2' : 'heading3';
  };
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
  }
  return pictures.filter((p) => p.rect.x1 - p.rect.x0 > 4 && p.rect.y1 - p.rect.y0 > 4);
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
  const columns = x0.map((x, c) => {
    const next = x0.slice(c + 1).find((v) => Number.isFinite(v)) ?? right;
    return Number.isFinite(x) ? Math.max(12, next - x) : 12;
  });
  const grid: TableCell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ paragraphs: [] })),
  );
  // The lines of a cell are one paragraph.
  for (const b of [...cells].sort((p, q) => p.bbox.y0 - q.bbox.y0 || p.bbox.x0 - q.bbox.x0)) {
    const { row, col } = b.tableCell!;
    const cell = grid[row]![col]!;
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
 * Footnotes become Word footnotes when their mark is found as a superscript earlier on the same
 * or the previous page (the nearest one); the others stay where they are, as Footnote Text.
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
      const m = /^(\d{1,3}|[*†‡§¶])\s*(?=\S)/u.exec(first.text);
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
      target = [...item.runs]
        .reverse()
        .find((r) => r.superscript && r.footnote === undefined && r.text.trim() === mark);
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
  const unitBlocks = new Set(units.flatMap((u) => u.unit.blocks.map((b) => b.id)));
  const pagePictureMap = new Map(shown.map((p) => [p.index, pagePictures(p, unitBlocks)]));
  const absorbed = new Set([...pagePictureMap.values()].flat().flatMap((p) => p.absorbed));
  /** Labels drawn in a figure: the figure shows their translation, they are never text too. */
  const figureLabels = new Set(
    [...pagePictureMap.values()]
      .flat()
      .filter((p) => !p.formula)
      .flatMap((p) => p.absorbed),
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
    const flow = order.filter((b) => !absorbed.has(b.id) && !FURNITURE.includes(b.role));
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
    for (const b of flow) {
      for (const p of anchors.get(b.id) ?? []) emitPicture(p);
      if (b.tableCell) {
        const id = b.tableCell.tableId;
        if (tables.has(id)) continue;
        tables.add(id);
        const table = tableItem(
          flow.filter((c) => c.tableCell?.tableId === id),
          content,
        );
        // One column is not a table (a framed title block): its cells are paragraphs.
        if (table.columns.length > 1) items.push(table);
        else
          for (const runs of table.rows.flatMap((r) => r.flatMap((c) => c.paragraphs)))
            items.push({ kind: 'paragraph', style: 'body', align: 'left', runs });
        continue;
      }
      // A reference block can hold the start of the next entry ("… 1392. [20] Ladisa …" when the
      // text extraction joined their lines): each entry is a paragraph of its own.
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
        for (const runs of content(part)) {
          const item: Extract<EditableItem, { kind: 'paragraph' }> = {
            kind: 'paragraph',
            style: kind,
            align: alignOf(part, kind, slots.get(b.id)?.lines ?? part.lines.length),
            runs,
          };
          items.push(item);
          if (b.chain && !unitBlocks.has(b.id)) kept.set(b.chain.paragraphId, item);
        }
      }
    }
    trailing.forEach(emitPicture);
  }
  const footnotes = linkFootnotes(items, pageStarts);
  return { items, footnotes, pictures, furniture };
}
