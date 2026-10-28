import { coverage, expand, union } from '../../core/ir/geometry';
import { CAPTION, REFERENCES_HEADING as REFERENCES } from '../../core/references';
import type { BlockIR, PageIR, Rect, Role } from '../../core/ir/types';
import type { RawPage } from '../extract/raw';
import { blockText, buildBlocks } from './blocks';
import { cluster, detectTables, type TableRegion } from './tables';

/** Share of the page height searched for running heads, feet and page numbers. */
const BAND = 0.2;
const PAGE_NUMBER =
  /^\s*(?:(?:page|p\.|seite|sayfa|страница|стр\.|página|pagina|strona|strana)\s*)?[-–—]?\s*(\d{1,4}|[ivxlcdm]{1,7})\s*(?:(?:of|von|de|di|из|\/|z|ze)\s*\d{1,4}\s*)?[-–—]?\s*$/iu;
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

/** A list item's opening: a bullet or an enumerator ("b) ", "ii. ", "– "). */
const ITEM = /^(?:\(?(?:\d{1,3}|\p{L}|[ivx]{1,4})[.)]|[•◦▪▫‣●○■□➢✓–—-])\s/iu;

/** Median distance between a block's baselines (undefined for one line). */
function lineStep(b: BlockIR): number | undefined {
  const steps = b.lines
    .slice(1)
    .map((l, i) => l.baseline - b.lines[i]!.baseline)
    .filter((s) => s > 0)
    .sort((x, y) => x - y);
  return steps.length ? steps[Math.floor(steps.length / 2)] : undefined;
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
/**
 * Running heads/feet compared by their letters only: page numbers differ per page, and fonts
 * with a broken text mapping turn them into a different invisible character on every page.
 */
const normalizeRepeat = (t: string) =>
  t
    .normalize('NFKC')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
    .toLowerCase();

/**
 * A figure region; `bars` when it is made of nothing but fraction bars (display formulas), whose
 * neighbouring sentences are running text, not labels.
 */
interface FigureRegion extends Rect {
  bars: boolean;
}

/** Groups vectors and images into figure regions (tables excluded). */
function figureRegions(page: RawPage, tables: TableRegion[]): FigureRegion[] {
  // Filled boxes behind running text (coloured callouts, a paragraph's shading behind each line
  // and display formula) are backgrounds, not figures. A chart's plot area holds other shapes;
  // shaded table cells have neighbours beside them.
  const lines = page.blocks.flatMap((b) => b.lines);
  const thin = (r: Rect) => r.y1 - r.y0 <= 2 && r.x1 - r.x0 < 120;
  const filled = page.vectors.filter((v) => v.isRectangle && !v.isStroked);
  const withText = new Set(filled.filter((v) => lines.some((l) => coverage(l.bbox, v.bbox) > 0.8)));
  const beside = (v: Rect, o: Rect) =>
    o.y0 < v.y1 - 1 && o.y1 > v.y0 + 1 && (Math.abs(o.x0 - v.x1) < 3 || Math.abs(v.x0 - o.x1) < 3);
  const isTextBackground = (v: RawPage['vectors'][number]) =>
    withText.has(v) &&
    (lines.some((l) => l.chars.length > 40 && coverage(l.bbox, v.bbox) > 0.8) ||
      (!filled.some((o) => o !== v && beside(v.bbox, o.bbox)) &&
        !page.vectors.some(
          (o) => o !== v && !withText.has(o) && !thin(o.bbox) && coverage(o.bbox, v.bbox) > 0.8,
        )));
  const vectors = page.vectors
    .filter((v) => !isTextBackground(v))
    .filter((v) => !tables.some((t) => coverage(v.bbox, expand(t.rect, 2)) > 0.9))
    .filter((v) => v.bbox.x1 - v.bbox.x0 > 3 || v.bbox.y1 - v.bbox.y0 > 3)
    .map((v) => v.bbox);
  // A fraction bar is a short thin rule on its own; a table's borders come in segments that
  // join at the same height.
  const bar = (r: Rect) =>
    thin(r) &&
    !vectors.some(
      (o) =>
        o !== r &&
        Math.abs(o.y0 - r.y0) < 1.5 &&
        (Math.abs(o.x0 - r.x1) < 3 || Math.abs(r.x0 - o.x1) < 3),
    );
  const shapes = [
    ...page.images.map((i) => ({ rect: i.bbox, bar: false })),
    ...vectors.map((v) => ({ rect: v, bar: bar(v) })),
  ];
  const regions: FigureRegion[] = [];
  for (const s of shapes) {
    let r: FigureRegion = { ...expand(s.rect, 12), bars: s.bar };
    for (let i = regions.length - 1; i >= 0; i--) {
      if (coverage(regions[i]!, r) > 0 || coverage(r, regions[i]!) > 0) {
        r = { ...union(r, regions[i]!), bars: r.bars && regions[i]!.bars };
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
  // Running headers/footers: the same text (digits normalised) in the top/bottom 20 % of the
  // page (books have wide margins) on enough pages.
  const bandCounts = new Map<string, number>();
  for (const { raw, blocks } of pages) {
    const seen = new Set<string>();
    for (const b of blocks) {
      if (b.bbox.y1 < raw.height * BAND || b.bbox.y0 > raw.height * (1 - BAND))
        seen.add(normalizeRepeat(blockText(b)));
    }
    seen.delete('');
    seen.forEach((k) => bandCounts.set(k, (bandCounts.get(k) ?? 0) + 1));
  }
  const repeated = (k: string) =>
    // Books alternate running heads/feet between left and right pages: 30 % is enough.
    pages.length >= 2 && (bandCounts.get(k) ?? 0) >= Math.max(2, pages.length * 0.3);

  let inReferences = false;
  for (const { raw, blocks, tables } of pages) {
    for (const t of tables) assignTableCells(blocks, t);
    const figures = figureRegions(raw, tables);
    for (const b of blocks) {
      if (b.role === 'table-cell') {
        // Code listings framed by rules are not tables to translate.
        if (allMono(b)) {
          b.role = 'code';
          b.translatable = false;
        }
        // An equation in a cell ("Prev = 3.940⋅Fn") stays as it is.
        if (equationLike(blockText(b))) b.translatable = false;
        continue;
      }
      const text = blockText(b);
      const size = avgSize(b);
      const inTopBand = b.bbox.y1 < raw.height * BAND;
      const inBottomBand = b.bbox.y0 > raw.height * (1 - BAND);
      // Words outside math fonts: a block with none is a formula's piece.
      const worded = /\p{L}{4,}/u.test(
        b.lines
          .map((l) =>
            l.spans
              .filter((s) => !s.font.isMath)
              .map((s) => s.text)
              .join(''),
          )
          .join(' '),
      );
      // Sentences around a display formula are text, not labels of the fractions in it.
      const figuresNear = figures.filter((f) => !(f.bars && worded));
      let role: Role = 'body';
      // A number in a math font is part of a formula (a fraction's denominator), not the page's.
      if ((inTopBand || inBottomBand) && PAGE_NUMBER.test(text) && mathRatio(b) < 0.5)
        role = 'page-number';
      else if ((inTopBand || inBottomBand) && repeated(normalizeRepeat(text)))
        role = inTopBand ? 'header' : 'footer';
      else if (mathRatio(b) >= 0.3 && !worded) role = 'formula';
      else if (allMono(b)) role = 'code';
      else if (CAPTION.test(text)) role = 'caption';
      else if (b.direction[1] !== 0)
        role = 'label'; // rotated text: margin stamps, axis titles
      else if (size >= stats.bodySize * 1.12 && b.lines.length <= 3) role = 'heading';
      else if (
        b.direction[1] !== 0 ||
        (figuresNear.some((f) => coverage(b.bbox, f) > 0.5) && text.length < 80) ||
        (b.lines.length === 1 &&
          text.length < 50 &&
          !TERMINAL.test(text) &&
          // Small type just outside a chart (tick labels under the axis, the axis title)
          // belongs to it too.
          figuresNear.some(
            (f) =>
              coverage(b.bbox, size < stats.bodySize * 0.95 ? expand(f, 1.5 * stats.bodySize) : f) >
              0,
          ))
      )
        role = 'label';
      else if (
        size >= stats.bodySize * 1.12 ||
        (allBold(b) && b.lines.length <= 2 && text.length < 120 && !TERMINAL.test(text))
      )
        role = 'heading';
      else if (size <= stats.bodySize * 0.92 && b.bbox.y0 > raw.height * 0.6) role = 'footnote';

      if (role === 'heading') inReferences = REFERENCES.test(text.replace(/^\d+(\.\d+)*\s*/, ''));
      // Reference entries low on the page look like footnotes (small type); they are references.
      else if (inReferences && (role === 'body' || role === 'footnote')) role = 'reference';
      // Formulas set in a text font (Times italic variables, Symbol operators) come out as
      // scattered letters ("O m m", "j j j", "(W"): nothing to translate, and engines glue them.
      if (role !== 'caption' && (mathFragments(text) || equationLike(text) || mathLike(text)))
        role = 'formula';
      b.role = role;
      b.translatable = !['formula', 'code', 'page-number', 'reference'].includes(role);
      // A one-word running head or foot is a journal or brand name ("sinergie", "Forest@"); one
      // with a year and a volume is the journal's citation line ("Journal of Health Monitoring ·
      // 2018 3(1)", "Forest@ (2019) 16: 3-9"). Both stay as they are.
      if (role === 'header' || role === 'footer') {
        const citation =
          /\b(19|20)\d{2}\b/.test(text) &&
          /\d+\s*\(\d+\)|\d+\s*:\s*\d+|\b(vol|no|nr|bd|issue|cilt|sayı|том|вып)\b\.?/iu.test(text);
        // A running head with a person's name ("M.V. Naghiyeva", "V. P. Tarasik et al.").
        const person =
          /\p{Lu}\.\s?/u.test(text) &&
          text
            .replace(/\bet al\.?/g, '')
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
            .every((w) => /^(?:\p{Lu}\.)+(?:\p{Lu}[\p{L}'’-]+)?$|^\p{Lu}[\p{L}'’-]+$/u.test(w));
        if (!/\s/.test(text.trim()) || citation || person) b.translatable = false;
      }
      // Headings are never justified: a translated heading with fewer words would gape.
      if (role === 'heading' && b.align === 'justify') b.align = 'left';
    }
    keepCodeLabels(blocks);
  }
}

/**
 * Text that is only formula pieces: Latin or Greek letters in tokens of at most three letters
 * ("Max", "Min"), mostly single characters, with digits and symbols.
 */
export function mathFragments(text: string): boolean {
  // Function names ("exp", "max", "log") and |norms| are formula pieces, not words.
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (MATH_FUNCTION.test(t) ? 'f' : t));
  if (!tokens.length || tokens.length > 16) return false;
  const rest = tokens.join(' ');
  if (/[^\p{Script=Latin}\p{Script=Greek}\p{N}\p{P}\p{S}\s]/u.test(rest)) return false;
  if (!/\p{L}/u.test(rest)) return false;
  const norm = (t: string) => /^[|‖].*[|‖]$|^[|‖]|[|‖]$/.test(t);
  if (tokens.some((t) => (t.match(/\p{L}/gu)?.length ?? 0) > 3 && !norm(t))) return false;
  const singles = tokens.filter((t) => (t.match(/[\p{L}\p{N}]/gu)?.length ?? 0) <= 1).length;
  const letters = tokens.filter((t) =>
    t
      .match(/[\p{L}\p{N}]/gu)
      ?.join('')
      .match(/^\p{L}$/u),
  );
  return (letters.length > 0 && singles > 0.5 * tokens.length) || tokens.some(norm);
}

const MATH_FUNCTION =
  /^[([|‖−\-\ufffd]*(?:exp|log|ln|lg|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|max|min|sup|inf|lim|det|tr|rank|dim|ker|deg|arg|mod|gcd|lcm|sgn|erf|Re|Im|Pr|var|cov|argmax|argmin)[)\]|‖,.;:]*$/;

/**
 * A short equation set in a text font ("HT = 1,75⋅250", "Prev = 3.940⋅Fn", "Φ = cos−1R"): a
 * relation sign and no word of five letters or more.
 */
export function equationLike(text: string): boolean {
  if (text.length > 60 || !/[=≤≥≈]/.test(text)) return false;
  return !text.split(/\s+/).some((t) => (t.match(/\p{L}/gu)?.length ?? 0) >= 5);
}

/**
 * A line of mathematics in a text font ("4L Bh −D R(g)h", "〈u,v〉g dVg"): no letter run longer
 * than three, and a mathematical operator.
 */
export function mathLike(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80 || !/\p{L}/u.test(t)) return false;
  if ((t.match(/\p{L}+/gu) ?? []).some((run) => run.length > 3 && !MATH_FUNCTION.test(run)))
    return false;
  return /[=<>≤≥≈∗×·−+∑∫∂∇∆〈〉⟨⟩|^∈∉⊂⊆∀∃→↦]/u.test(t);
}

const IDENTIFIER = /^(?:[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]*)$/;

/**
 * On a page whose chart labels are mostly code identifiers ("has_url", "is_license"), the other
 * one-word lower-case labels are code too ("connect", "open", "read" are API names, not verbs): they
 * stay as they are.
 */
function keepCodeLabels(labels: BlockIR[]): void {
  const words = labels.filter(
    (b) => b.role === 'label' && /^\S*\p{L}\S*$/u.test(blockText(b).trim()),
  );
  const code = words.filter((b) => IDENTIFIER.test(blockText(b).trim()));
  if (code.length < 3 || code.length < 0.4 * words.length) return;
  // Rotated labels are axis titles ("features"), not ticks.
  for (const b of words)
    if (b.direction[1] === 0 && /^[a-z][a-z0-9]*$/.test(blockText(b).trim()))
      b.translatable = false;
}

/** Columns and reading order (ARCHITECTURE.md §4.1): full-width blocks split the flow. */
function orderPage(blocks: BlockIR[], width: number): Rect[] {
  const flow = blocks.filter((b) => !['header', 'footer', 'page-number'].includes(b.role));
  if (!flow.length) return [];
  const contentX0 = Math.min(...flow.map((b) => b.bbox.x0));
  const contentX1 = Math.max(...flow.map((b) => b.bbox.x1));
  const contentWidth = Math.max(contentX1 - contentX0, width * 0.3);
  // Columns are the horizontal extents of the running text: the x-intervals of multi-line,
  // non-centred paragraphs, merged where they overlap (an indented list stays in its column).
  const intervals = flow
    .filter(
      (b) =>
        b.bbox.x1 - b.bbox.x0 < contentWidth * 0.6 &&
        (b.role === 'body' || b.role === 'reference') &&
        b.align !== 'center' &&
        b.lines.length >= 2,
    )
    .map((b) => [b.bbox.x0, b.bbox.x1] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  // Merge only real overlaps (an indented list inside its column), not a block that just
  // reaches into the gutter (a two-line affiliation under the title).
  for (const [x0, x1] of intervals) {
    const last = merged[merged.length - 1];
    const overlap = last ? last[1] - x0 : 0;
    if (last && overlap > 0.3 * Math.min(last[1] - last[0], x1 - x0)) {
      last[1] = Math.max(last[1], x1);
    } else merged.push([x0, x1]);
  }
  const columns: Rect[] = merged.map(([x0, x1], i) => ({
    x0,
    x1: i + 1 < merged.length ? x1 : Math.max(x1, contentX1),
    y0: 0,
    y1: Number.POSITIVE_INFINITY,
  }));
  const multi = columns.length > 1;
  // A table's cells share its extent, so a full-width table spans as a whole.
  const tableBox = new Map<string, Rect>();
  for (const b of flow) {
    if (!b.tableCell) continue;
    const r = tableBox.get(b.tableCell.tableId);
    tableBox.set(b.tableCell.tableId, r ? union(r, b.bbox) : b.bbox);
  }
  const crossesGutter = (r: Rect) =>
    columns.slice(1).some((c) => r.x0 < c.x0 - 8 && r.x1 > c.x0 + 8);
  const columnOf = (b: BlockIR) => {
    if (!multi) return 0;
    if (b.bbox.x1 - b.bbox.x0 >= contentWidth * 0.6) return -1;
    const extent = b.tableCell ? tableBox.get(b.tableCell.tableId)! : b.bbox;
    if (crossesGutter(extent)) return -1;
    const cx = (b.bbox.x0 + b.bbox.x1) / 2;
    const i = columns.findIndex(
      (c, k) => cx >= c.x0 - 5 && (k === columns.length - 1 || cx < columns[k + 1]!.x0),
    );
    // Narrow blocks in the margin (a rotated arXiv stamp) belong to the nearest column; only
    // wide blocks split the flow.
    return i >= 0 ? i : 0;
  };
  for (const b of flow) b.columnIndex = columnOf(b);

  // A single line cannot tell its own alignment: one centred in its column (or across the
  // columns) and not starting at the column's edge is centred. Text edges come from the running
  // text, not from margin stamps or the gutter.
  const textRight = (k: number) =>
    Math.max(
      ...flow
        .filter((b) => b.columnIndex === k && b.role === 'body' && b.lines.length >= 2)
        .map((b) => b.bbox.x1),
      columns[k]?.x0 ?? contentX0,
    );
  for (const b of flow) {
    if (b.lines.length !== 1 || b.align !== 'left' || b.role === 'table-cell') continue;
    const area =
      multi && b.columnIndex >= 0
        ? { x0: columns[b.columnIndex]!.x0, x1: textRight(b.columnIndex) }
        : multi
          ? { x0: columns[0]!.x0, x1: textRight(columns.length - 1) }
          : { x0: contentX0, x1: contentX1 };
    const centre = (b.bbox.x0 + b.bbox.x1) / 2;
    if (Math.abs(centre - (area.x0 + area.x1) / 2) < 4 && b.bbox.x0 - area.x0 > 6) {
      b.align = 'center';
    }
  }

  // Bands separated by full-width blocks, then columns left → right, top → bottom.
  const spanning = flow.filter((b) => b.columnIndex === -1).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const ordered: BlockIR[] = [];
  const placed = new Set<BlockIR>();
  const emitBand = (bottom: number) => {
    // Everything above `bottom` not placed yet, including blocks that start beside a tall
    // full-width block.
    const inBand = flow.filter((b) => !placed.has(b) && b.columnIndex !== -1 && b.bbox.y0 < bottom);
    // Blocks that start on the same line (a line cut by an inline formula, whose exponents
    // raise the right part's top) are read left to right.
    const sameLine = (a: BlockIR, b: BlockIR) =>
      Math.abs(a.lines[0]!.baseline - b.lines[0]!.baseline) < 0.3 * avgSize(a);
    inBand.sort(
      (a, b) =>
        a.columnIndex - b.columnIndex ||
        (sameLine(a, b) ? 0 : a.bbox.y0 - b.bbox.y0) ||
        a.bbox.x0 - b.bbox.x0,
    );
    inBand.forEach((b) => (ordered.push(b), placed.add(b)));
  };
  for (const s of spanning) {
    emitBand(s.bbox.y0);
    ordered.push(s);
    placed.add(s);
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
  const byId = new Map(ordered.map((b) => [b.id, b]));
  /** Whether `b` may continue `a`: `a` ends a chain, `b` starts one (or is alone). */
  const free = (a: BlockIR, b: BlockIR) =>
    !a.chain?.next &&
    !(b.chain && b.chain.index > 0) &&
    (a.chain?.paragraphId ?? a.id) !== (b.chain?.paragraphId ?? b.id);
  const link = (a: BlockIR, b: BlockIR, afterFormula = false) => {
    const paragraphId = a.chain?.paragraphId ?? a.id;
    const index = a.chain?.index ?? 0;
    a.chain = { ...a.chain, paragraphId, index, next: b.id };
    // `b` may head a chain of its own: its blocks continue `a`'s.
    let k = index + 1;
    for (let cur: BlockIR | undefined = b; cur; k++) {
      const next: string | undefined = cur.chain?.next;
      const formula = cur === b ? afterFormula : !!cur.chain?.afterFormula;
      cur.chain = {
        paragraphId,
        index: k,
        ...(next ? { next } : {}),
        ...(formula ? { afterFormula: true } : {}),
      };
      cur = next ? byId.get(next) : undefined;
    }
  };
  const pageOf = (b: BlockIR) => Number(b.id.split('-')[0]!.slice(1));
  // Only text with a word in it continues a sentence: formula pieces set in a text font ("dT",
  // "т 1", "ср", "h2 (4)") are skipped like formulas and never chained.
  const worded = (b: BlockIR) => /\p{L}{3}/u.test(blockText(b));

  // Sentences continued after one or more display formulas.
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    if (a.role !== 'body' || !worded(a)) continue;
    let j = i + 1;
    // Display formulas and floats (tables, figures, captions) may interrupt a sentence.
    while (ordered[j] && (INTERRUPTING.has(ordered[j]!.role) || !worded(ordered[j]!))) j++;
    const b = ordered[j];
    if (
      j > i + 1 &&
      b?.role === 'body' &&
      free(a, b) &&
      !TERMINAL.test(blockText(a)) &&
      /^\p{Ll}/u.test(blockText(b))
    )
      // The formula is part of the sentence ("…alınırsa [formula] olur"); a float is not.
      link(
        a,
        b,
        ordered.slice(i + 1, j).some((x) => x.role === 'formula'),
      );
  }

  // Paragraphs split inside a column that the block builder could not rejoin: a list item's
  // hanging indent ("• La charge … des maladies" | "bucco-dentaires est …"), a first-line indent
  // wider than its limit ("2. Fideiusiunea … două mijloace de" | "apărare, …"), a line cut by
  // an inline formula ("… Вдоль оси" | "x расположены …"). The text runs on in lower case at
  // the next line's distance, or on the same line, where it may also go on with the formula's
  // relation ("Burada [fraction]" | "= cos θ olmak üzere"). Lettered items ("b) …") are new ones.
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    if (a.role !== 'body' || b.role !== 'body' || !worded(a) || !worded(b) || !free(a, b)) continue;
    if (pageOf(a) !== pageOf(b) || a.columnIndex !== b.columnIndex) continue;
    if (TERMINAL.test(blockText(a))) continue;
    const text = blockText(b);
    const runsOn = /^\p{Ll}/u.test(text) && !ITEM.test(text);
    const relation = /^[=<>≤≥≈≠∈]/u.test(text) && !!a.lines.at(-1)!.spans.at(-1)?.font.isMath;
    if (!runsOn && !relation) continue;
    const size = avgSize(b);
    if (Math.abs(avgSize(a) - size) >= Math.max(0.3, 0.08 * size)) continue;
    const aLast = a.lines[a.lines.length - 1]!;
    const bFirst = b.lines[0]!;
    const step = bFirst.baseline - aLast.baseline;
    const pitch = lineStep(b) ?? lineStep(a) ?? 1.2 * size;
    const below =
      runsOn &&
      step > 0.5 * size &&
      step < Math.max(1.6 * size, 1.25 * pitch) &&
      b.bbox.x0 <= a.bbox.x0 + 3 * size;
    const besides =
      Math.abs(step) < 0.3 * size &&
      bFirst.bbox.x0 >= aLast.bbox.x1 - 1 &&
      bFirst.bbox.x0 - aLast.bbox.x1 < 3 * size;
    if (below || besides) link(a, b);
  }

  // Paragraphs continued in the next column or on the next page. Full-width blocks on
  // multi-column pages (table descriptions, author lists) are not part of the column flow.
  const inFlow = ordered.filter((b) => b.role === 'body' && b.columnIndex !== -1 && worded(b));
  // A paragraph that continues fills its last line: a short last line ("R. Walton", an
  // address) ends it, whatever its punctuation. The text edge comes from the column's
  // multi-line paragraphs.
  const rightEdge = new Map<string, number>();
  for (const b of inFlow) {
    if (b.lines.length < 2) continue;
    const key = `${pageOf(b)}:${b.columnIndex}`;
    rightEdge.set(key, Math.max(rightEdge.get(key) ?? 0, b.bbox.x1));
  }
  const lastLineFull = (a: BlockIR) => {
    const edge = rightEdge.get(`${pageOf(a)}:${a.columnIndex}`) ?? a.bbox.x1;
    return a.lines[a.lines.length - 1]!.bbox.x1 >= edge - 0.04 * (edge - a.bbox.x0);
  };
  // A short line set apart at the foot of a column ("© Тарасик В. П., 2015") is not where the
  // column's text ends.
  const sequence = inFlow.filter((b, i) => {
    const next = inFlow[i + 1];
    const prev = inFlow[i - 1];
    const last = !next || pageOf(next) !== pageOf(b) || next.columnIndex !== b.columnIndex;
    if (!last || b.lines.length > 1 || lastLineFull(b)) return true;
    if (!prev || pageOf(prev) !== pageOf(b) || prev.columnIndex !== b.columnIndex) return true;
    const gap = b.lines[0]!.baseline - prev.lines[prev.lines.length - 1]!.baseline;
    return gap < 2 * (lineStep(prev) ?? 1.2 * avgSize(b));
  });
  for (let i = 0; i + 1 < sequence.length; i++) {
    const a = sequence[i]!;
    const b = sequence[i + 1]!;
    if (!free(a, b)) continue;
    if (pageOf(a) === pageOf(b) && a.columnIndex === b.columnIndex) continue;
    const lastText = a.lines[a.lines.length - 1]!.spans.map((s) => s.text)
      .join('')
      .trim();
    const sizeB = avgSize(b);
    const notIndented = b.lines[0]!.bbox.x0 - b.bbox.x0 < 0.5 * sizeB;
    // A continuation in lower case needs no full last line ("… karşılaştırılması Tablo 1'de" |
    // "sunulmuştur. …": the line was broken by hand before the column's end).
    const textB = blockText(b);
    const runsOn = /^\p{Ll}/u.test(textB) && !ITEM.test(textB);
    if (
      !TERMINAL.test(lastText) &&
      (lastLineFull(a) || runsOn) &&
      notIndented &&
      Math.abs(avgSize(a) - sizeB) < 0.3
    )
      link(a, b);
  }
}

/**
 * Drop caps — a large initial letter beside the first lines of a paragraph — join their
 * paragraph so the first word is whole for translation ("W" + "hen I" → "When I", "I" + "am"
 * → "I am": the document's own words decide whether the letter starts the word). The letter's
 * area is removed with the paragraph; the translation starts with an ordinary capital.
 */
function absorbDropCaps(blocks: BlockIR[], bodySize: number, words: Set<string>): BlockIR[] {
  const absorbed = new Set<BlockIR>();
  for (const cap of blocks) {
    const letter = blockText(cap);
    if (!/^\p{Lu}$/u.test(letter) || avgSize(cap) < 1.8 * bodySize) continue;
    const capHeight = cap.bbox.y1 - cap.bbox.y0;
    const para = blocks.find(
      (b) =>
        b !== cap &&
        b.lines.length >= 2 &&
        /^\p{L}/u.test(blockText(b)) &&
        b.bbox.y0 >= cap.bbox.y0 - bodySize &&
        b.bbox.y0 <= cap.bbox.y0 + capHeight / 2 &&
        // The first lines are indented beside the letter (its font box is wider than its ink).
        b.lines[0]!.bbox.x0 > cap.bbox.x0 + 2 &&
        b.lines[0]!.bbox.x0 - b.bbox.x0 > 3 &&
        b.lines[0]!.bbox.x0 - cap.bbox.x1 < 3 * bodySize,
    );
    if (!para) continue;
    const firstWord = /^\p{L}+/u.exec(blockText(para))![0];
    const joined = words.has((letter + firstWord).toLowerCase());
    const line = para.lines[0]!;
    const first = line.spans[0]!;
    para.lines[0] = {
      ...line,
      spans: [{ ...first, text: joined ? letter : `${letter} `, bbox: cap.bbox }, ...line.spans],
    };
    para.extraRedact = [...(para.extraRedact ?? []), cap.bbox];
    absorbed.add(cap);
  }
  return blocks.filter((b) => !absorbed.has(b));
}

/**
 * A letter or two touching a formula ("T" with its subscript "ср", "W" + "ф") is part of it,
 * set in a text font — no word to translate ("ср" became "Wed"). Words apart from a formula
 * by a space ("x ve y") stay text.
 */
function formulaPieces(blocks: BlockIR[]): void {
  const formulas = blocks.filter((b) => b.role === 'formula');
  for (const b of blocks) {
    if (b.role !== 'body' && b.role !== 'label') continue;
    if (b.lines.length !== 1 || /\p{L}{3}/u.test(blockText(b))) continue;
    const height = b.bbox.y1 - b.bbox.y0;
    const touches = formulas.some(
      (f) =>
        f.bbox.x0 <= b.bbox.x1 + 0.5 &&
        b.bbox.x0 <= f.bbox.x1 + 0.5 &&
        Math.min(f.bbox.y1, b.bbox.y1) - Math.max(f.bbox.y0, b.bbox.y0) > 0.3 * height,
    );
    if (touches) {
      b.role = 'formula';
      b.translatable = false;
    }
  }
}

/** Full analysis: raw MuPDF pages → IR pages with roles, columns, reading order, chains and tables. */
export function analyzeDocument(raw: RawPage[]): PageIR[] {
  const pages = raw.map((r) => {
    const tables = detectTables(r);
    return { raw: r, tables, blocks: buildBlocks(r, tables) };
  });
  const stats = documentStats(pages.map((p) => p.blocks));
  const words = new Set(
    pages.flatMap((p) =>
      p.blocks.flatMap(
        (b) =>
          blockText(b)
            .toLowerCase()
            .match(/\p{L}+/gu) ?? [],
      ),
    ),
  );
  for (const p of pages) p.blocks = absorbDropCaps(p.blocks, stats.bodySize, words);
  classify(pages, stats);
  for (const p of pages) formulaPieces(p.blocks);
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
