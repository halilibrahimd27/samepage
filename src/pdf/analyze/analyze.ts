import { coverage, expand, union } from '../../core/ir/geometry';
import type { BlockIR, PageIR, Rect, Role } from '../../core/ir/types';
import type { RawPage } from '../extract/raw';
import { blockText, buildBlocks } from './blocks';
import { cluster, detectTables, type TableRegion } from './tables';

const CAPTION =
  /^(şekil|figure|fig\.|tablo|table|tab\.|рис\.|рисунок|таблица|abb\.|abbildung|resim|grafik)\s*\d/i;
const REFERENCES =
  /^\s*(\d+[.)]?\s*)?(kaynak(ça|lar)|references|bibliography|literatur(verzeichnis)?|literatür|литература|список литературы|bibliographie|références)\s*$/i;
const PAGE_NUMBER = /^\s*[-–—]?\s*(\d{1,4}|[ivxlcdm]{1,7})\s*[-–—]?\s*$/i;
/** Sentence-final punctuation, optionally followed by closing quotes/brackets. */
const TERMINAL = /[.!?…]["”»’)\]]*$/;

interface Stats {
  bodySize: number;
}

function documentStats(pages: BlockIR[][]): Stats {
  const counts = new Map<number, number>();
  for (const blocks of pages)
    for (const b of blocks)
      for (const l of b.lines)
        for (const s of l.spans) {
          if (s.font.isMath) continue;
          const size = Math.round(s.size * 2) / 2;
          counts.set(size, (counts.get(size) ?? 0) + s.text.length);
        }
  const bodySize = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 10;
  return { bodySize };
}

function mathRatio(b: BlockIR): number {
  let math = 0;
  let total = 0;
  for (const l of b.lines)
    for (const s of l.spans) {
      const n = s.text.replace(/\s/g, '').length;
      total += n;
      if (s.font.isMath) math += n;
    }
  return total ? math / total : 0;
}

const avgSize = (b: BlockIR) => {
  let w = 0;
  let n = 0;
  for (const l of b.lines) {
    for (const s of l.spans) {
      if (s.font.isMath) continue;
      w += s.size * s.text.length;
      n += s.text.length;
    }
  }
  return n ? w / n : 0;
};
const allBold = (b: BlockIR) =>
  b.lines.every((l) => l.spans.every((s) => s.font.bold || !s.text.trim() || s.font.isMath));
const allMono = (b: BlockIR) =>
  b.lines.every((l) => l.spans.every((s) => s.font.family === 'mono' || !s.text.trim()));
const normalizeRepeat = (t: string) =>
  t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

/** Groups vectors and images into figure regions (tables excluded). */
function figureRegions(page: RawPage, tables: TableRegion[]): Rect[] {
  // Filled boxes behind running text (coloured callouts) are backgrounds, not figures.
  const longLines = page.blocks.flatMap((b) => b.lines).filter((l) => l.chars.length > 40);
  const isTextBackground = (v: RawPage['vectors'][number]) =>
    v.isRectangle && !v.isStroked && longLines.some((l) => coverage(l.bbox, v.bbox) > 0.8);
  const shapes = [
    ...page.images.map((i) => i.bbox),
    ...page.vectors
      .filter((v) => !isTextBackground(v))
      .filter((v) => !tables.some((t) => coverage(v.bbox, expand(t.rect, 2)) > 0.9))
      .filter((v) => v.bbox.x1 - v.bbox.x0 > 3 || v.bbox.y1 - v.bbox.y0 > 3)
      .map((v) => v.bbox),
  ];
  const regions: Rect[] = [];
  for (const s of shapes) {
    let r = expand(s, 12);
    for (let i = regions.length - 1; i >= 0; i--) {
      if (coverage(regions[i]!, r) > 0 || coverage(r, regions[i]!) > 0) {
        r = union(r, regions[i]!);
        regions.splice(i, 1);
      }
    }
    regions.push(r);
  }
  // A lone rule (e.g. the footnote separator) is not a figure.
  return regions.filter((r) => r.y1 - r.y0 > 30 && r.x1 - r.x0 > 30);
}

function assignTableCells(blocks: BlockIR[], table: TableRegion): void {
  const cells = blocks.filter((b) => coverage(b.bbox, table.rect) > 0.6);
  if (!cells.length) return;
  const rowYs = cluster(
    cells.map((b) => (b.bbox.y0 + b.bbox.y1) / 2),
    3,
  );
  // Columns = merged horizontal extents of the cells (works for left-, right- and centre-aligned
  // columns); vertical rules, when present, refine the boundaries.
  const intervals: [number, number][] = [];
  for (const [x0, x1] of cells
    .map((b) => [b.bbox.x0, b.bbox.x1] as [number, number])
    .sort((p, q) => p[0] - q[0])) {
    const last = intervals[intervals.length - 1];
    if (last && x0 <= last[1] + 2) last[1] = Math.max(last[1], x1);
    else intervals.push([x0, x1]);
  }
  const colBounds = intervals.map(([x0, x1], i) => {
    const left = i === 0 ? table.rect.x0 : (intervals[i - 1]![1] + x0) / 2;
    const right = i === intervals.length - 1 ? table.rect.x1 : (x1 + intervals[i + 1]![0]) / 2;
    const rulesInside = table.cols.filter((c) => c > x0 - 6 && c < x1 + 6);
    return [
      Math.max(left, ...table.cols.filter((c) => c <= x0)),
      Math.min(right, ...table.cols.filter((c) => c >= x1)),
      rulesInside.length,
    ] as const;
  });
  const nearest = (arr: number[], v: number) =>
    arr.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(arr[best]! - v) ? i : best), 0);
  const rowBounds = rowYs.map(
    (c, i) =>
      [
        i === 0 ? table.rect.y0 : (rowYs[i - 1]! + c) / 2,
        i === rowYs.length - 1 ? table.rect.y1 : (c + rowYs[i + 1]!) / 2,
      ] as const,
  );
  for (const b of cells) {
    const row = nearest(rowYs, (b.bbox.y0 + b.bbox.y1) / 2);
    const cx = (b.bbox.x0 + b.bbox.x1) / 2;
    const col = Math.max(
      0,
      intervals.findIndex(([x0, x1]) => cx >= x0 - 1 && cx <= x1 + 1),
    );
    b.role = 'table-cell';
    b.tableCell = {
      tableId: table.id,
      row,
      col,
      cellRect: {
        x0: colBounds[col]![0],
        x1: colBounds[col]![1],
        y0: rowBounds[row]![0],
        y1: rowBounds[row]![1],
      },
    };
  }
}

/** Roles (ARCHITECTURE.md §4.1 step 3). */
function classify(
  pages: { raw: RawPage; blocks: BlockIR[]; tables: TableRegion[] }[],
  stats: Stats,
): void {
  // Running headers/footers: the same text (digits normalised) in the top/bottom band on ≥ 50% of pages.
  const bandCounts = new Map<string, number>();
  for (const { raw, blocks } of pages) {
    const seen = new Set<string>();
    for (const b of blocks) {
      if (b.bbox.y1 < raw.height * 0.1 || b.bbox.y0 > raw.height * 0.9)
        seen.add(normalizeRepeat(blockText(b)));
    }
    seen.forEach((k) => bandCounts.set(k, (bandCounts.get(k) ?? 0) + 1));
  }
  const repeated = (k: string) =>
    pages.length >= 2 && (bandCounts.get(k) ?? 0) >= Math.max(2, pages.length * 0.5);

  let inReferences = false;
  for (const { raw, blocks, tables } of pages) {
    for (const t of tables) assignTableCells(blocks, t);
    const figures = figureRegions(raw, tables);
    for (const b of blocks) {
      if (b.role === 'table-cell') continue;
      const text = blockText(b);
      const size = avgSize(b);
      const inTopBand = b.bbox.y1 < raw.height * 0.1;
      const inBottomBand = b.bbox.y0 > raw.height * 0.9;
      let role: Role = 'body';
      if ((inTopBand || inBottomBand) && PAGE_NUMBER.test(text)) role = 'page-number';
      else if ((inTopBand || inBottomBand) && repeated(normalizeRepeat(text)))
        role = inTopBand ? 'header' : 'footer';
      else if (
        mathRatio(b) >= 0.3 &&
        !/\p{L}{4,}/u.test(
          b.lines
            .map((l) =>
              l.spans
                .filter((s) => !s.font.isMath)
                .map((s) => s.text)
                .join(''),
            )
            .join(' '),
        )
      )
        role = 'formula';
      else if (allMono(b)) role = 'code';
      else if (CAPTION.test(text)) role = 'caption';
      else if (size >= stats.bodySize * 1.12 && b.lines.length <= 3) role = 'heading';
      else if (
        b.direction[1] !== 0 ||
        (figures.some((f) => coverage(b.bbox, f) > 0.5) && text.length < 80) ||
        (b.lines.length === 1 &&
          text.length < 50 &&
          !TERMINAL.test(text) &&
          figures.some((f) => coverage(b.bbox, f) > 0))
      )
        role = 'label';
      else if (
        size >= stats.bodySize * 1.12 ||
        (allBold(b) && b.lines.length <= 2 && text.length < 120 && !TERMINAL.test(text))
      )
        role = 'heading';
      else if (size <= stats.bodySize * 0.92 && b.bbox.y0 > raw.height * 0.6) role = 'footnote';

      if (role === 'heading') inReferences = REFERENCES.test(text.replace(/^\d+(\.\d+)*\s*/, ''));
      else if (inReferences && role === 'body') role = 'reference';
      b.role = role;
      b.translatable = !['formula', 'code', 'page-number', 'reference'].includes(role);
    }
  }
}

/** Columns and reading order (ARCHITECTURE.md §4.1): full-width blocks split the flow. */
function orderPage(blocks: BlockIR[], width: number): Rect[] {
  const flow = blocks.filter((b) => !['header', 'footer', 'page-number'].includes(b.role));
  if (!flow.length) return [];
  const contentX0 = Math.min(...flow.map((b) => b.bbox.x0));
  const contentX1 = Math.max(...flow.map((b) => b.bbox.x1));
  const contentWidth = Math.max(contentX1 - contentX0, width * 0.3);
  const narrow = flow.filter(
    (b) => b.bbox.x1 - b.bbox.x0 < contentWidth * 0.6 && b.role === 'body',
  );
  const starts = cluster(
    narrow.map((b) => b.bbox.x0),
    15,
  );
  const columns: Rect[] = starts.map((x0, i) => ({
    x0,
    x1: i + 1 < starts.length ? starts[i + 1]! - 1 : contentX1,
    y0: 0,
    y1: Number.POSITIVE_INFINITY,
  }));
  const multi = columns.length > 1;
  const columnOf = (b: BlockIR) => {
    if (!multi) return 0;
    if (b.bbox.x1 - b.bbox.x0 >= contentWidth * 0.6) return -1;
    const cx = (b.bbox.x0 + b.bbox.x1) / 2;
    return columns.findIndex(
      (c, i) => cx >= c.x0 - 5 && (i === columns.length - 1 || cx < columns[i + 1]!.x0),
    );
  };
  for (const b of flow) b.columnIndex = columnOf(b);

  // Bands separated by full-width blocks, then columns left → right, top → bottom.
  const spanning = flow.filter((b) => b.columnIndex === -1).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const ordered: BlockIR[] = [];
  let bandTop = Number.NEGATIVE_INFINITY;
  const placed = new Set<BlockIR>();
  const emitBand = (bottom: number) => {
    const inBand = flow.filter(
      (b) =>
        !placed.has(b) && b.columnIndex !== -1 && b.bbox.y0 >= bandTop - 1 && b.bbox.y0 < bottom,
    );
    inBand.sort(
      (a, b) => a.columnIndex - b.columnIndex || a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
    );
    inBand.forEach((b) => (ordered.push(b), placed.add(b)));
  };
  for (const s of spanning) {
    emitBand(s.bbox.y0);
    ordered.push(s);
    placed.add(s);
    bandTop = s.bbox.y1;
  }
  emitBand(Number.POSITIVE_INFINITY);
  for (const b of flow) if (!placed.has(b)) ordered.push(b);

  const head = blocks.filter((b) => b.role === 'header').sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const tail = blocks
    .filter((b) => b.role === 'footer' || b.role === 'page-number')
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  [...head, ...ordered, ...tail].forEach((b, i) => (b.readingOrder = i));
  return multi
    ? columns.map((c) => ({
        ...c,
        y1: Math.max(
          ...flow.filter((b) => b.columnIndex === columns.indexOf(c)).map((b) => b.bbox.y1),
          0,
        ),
      }))
    : [];
}

/**
 * Paragraph chains across columns and pages (ARCHITECTURE.md §4.1), and across display formulas
 * or floats that interrupt a sentence ("… ortalaması olan [equation] ölçütüyle hesaplanmıştır.").
 */
const INTERRUPTING = new Set<Role>(['formula', 'caption', 'table-cell', 'label']);
function linkChains(pages: BlockIR[][]): void {
  const ordered = pages.flatMap((blocks) =>
    [...blocks].sort((x, y) => x.readingOrder - y.readingOrder),
  );
  const link = (a: BlockIR, b: BlockIR) => {
    const paragraphId = a.chain?.paragraphId ?? a.id;
    const index = a.chain?.index ?? 0;
    a.chain = { paragraphId, index, next: b.id };
    b.chain = { paragraphId, index: index + 1 };
  };
  const pageOf = (b: BlockIR) => Number(b.id.split('-')[0]!.slice(1));

  // Sentences continued after one or more display formulas.
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    if (a.role !== 'body') continue;
    let j = i + 1;
    // Display formulas and floats (tables, figures, captions) may interrupt a sentence.
    while (ordered[j] && INTERRUPTING.has(ordered[j]!.role)) j++;
    const b = ordered[j];
    if (
      j > i + 1 &&
      b?.role === 'body' &&
      !TERMINAL.test(blockText(a)) &&
      /^\p{Ll}/u.test(blockText(b))
    )
      link(a, b);
  }

  // Paragraphs continued in the next column or on the next page.
  const sequence = ordered.filter((b) => b.role === 'body');
  for (let i = 0; i + 1 < sequence.length; i++) {
    const a = sequence[i]!;
    const b = sequence[i + 1]!;
    if (a.chain?.next || b.chain) continue;
    if (pageOf(a) === pageOf(b) && a.columnIndex === b.columnIndex) continue;
    const lastText = a.lines[a.lines.length - 1]!.spans.map((s) => s.text)
      .join('')
      .trim();
    const sizeB = avgSize(b);
    const notIndented = b.lines[0]!.bbox.x0 - b.bbox.x0 < 0.5 * sizeB;
    if (!TERMINAL.test(lastText) && notIndented && Math.abs(avgSize(a) - sizeB) < 0.3) link(a, b);
  }
}

/** Full analysis: raw MuPDF pages → IR pages with roles, columns, reading order, chains and tables. */
export function analyzeDocument(raw: RawPage[]): PageIR[] {
  const pages = raw.map((r) => {
    const tables = detectTables(r);
    return { raw: r, tables, blocks: buildBlocks(r, tables) };
  });
  const stats = documentStats(pages.map((p) => p.blocks));
  classify(pages, stats);
  const result = pages.map(({ raw: r, blocks }) => {
    const columns = orderPage(blocks, r.width);
    return {
      index: r.index,
      width: r.width,
      height: r.height,
      rotation: r.rotation,
      blocks,
      images: r.images,
      vectors: r.vectors.map((v) => ({
        bbox: v.bbox,
        isRectangle: v.isRectangle,
        isStroked: v.isStroked,
      })),
      columns,
    } satisfies PageIR;
  });
  linkChains(result.map((p) => p.blocks));
  return result;
}

export { blockText };
