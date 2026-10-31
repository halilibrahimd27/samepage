import { coverage, expand, union, unionAll } from '../../core/ir/geometry';
import {
  CAPTION,
  REFERENCES_HEADING as REFERENCES,
  SELF_CITATION_LABEL,
} from '../../core/references';
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
  /** The shapes themselves, without the margin that joins neighbours. */
  content: Rect;
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
    let r: FigureRegion = { ...expand(s.rect, 12), bars: s.bar, content: s.rect };
    for (let i = regions.length - 1; i >= 0; i--) {
      if (coverage(regions[i]!, r) > 0 || coverage(r, regions[i]!) > 0) {
        r = {
          ...union(r, regions[i]!),
          bars: r.bars && regions[i]!.bars,
          content: union(r.content, regions[i]!.content),
        };
        regions.splice(i, 1);
      }
    }
    regions.push(r);
  }
  // A lone rule (e.g. the footnote separator) is not a figure, nor a frame around the running
  // text (a journal's page border).
  const running = (r: Rect) =>
    lines
      .filter((l) => l.chars.length > 40 && coverage(l.bbox, r) > 0.8)
      .reduce((n, l) => n + l.chars.length, 0);
  return regions.filter((r) => r.y1 - r.y0 > 30 && r.x1 - r.x0 > 30 && running(r) < 800);
}

/**
 * Rotated text beside the page's running text and away from its figures: a margin stamp. The
 * running text spans the horizontal blocks of two lines or more.
 */
function inMargin(b: BlockIR, blocks: BlockIR[], figures: Rect[]): boolean {
  const text = blocks.filter((x) => x.direction[1] === 0 && x.lines.length >= 2);
  if (!text.length || figures.some((f) => coverage(b.bbox, f) > 0.3)) return false;
  const left = Math.min(...text.map((x) => x.bbox.x0));
  const right = Math.max(...text.map((x) => x.bbox.x1));
  return b.bbox.x1 <= left + 2 || b.bbox.x0 >= right - 2;
}

function assignTableCells(blocks: BlockIR[], table: TableRegion): void {
  const cells = blocks.filter((b) => coverage(b.bbox, table.rect) > 0.6);
  if (!cells.length) return;
  // A cell of two lines belongs to the row of its first line ("Mean, std. deviation … of
  // strings in" | "all source code files" beside "Continuous"), unless the row's other cells are
  // centred on it.
  const mid = (r: Rect) => (r.y0 + r.y1) / 2;
  const singles = cells.filter((b) => b.lines.length < 2).map((b) => mid(b.bbox));
  const centreOf = (b: BlockIR) =>
    b.lines.length < 2 || singles.some((y) => Math.abs(y - mid(b.bbox)) < 3)
      ? mid(b.bbox)
      : mid(b.lines[0]!.bbox);
  const rowYs = cluster(cells.map(centreOf), 3);
  // Columns = merged horizontal extents of the cells (works for left-, right- and centre-aligned
  // columns); vertical rules, when present, refine the boundaries. Only the rows with the most
  // cells count: a header spanning a column group ("Mono-language" over "Pr. Rec. F1 Acc.")
  // would merge its columns into one.
  const rowOf = (b: BlockIR) => nearestIndex(rowYs, centreOf(b));
  const perRow = rowYs.map((_, r) => cells.filter((b) => rowOf(b) === r).length);
  const most = Math.max(...perRow);
  const columnCells = cells.filter((b) => perRow[rowOf(b)]! >= Math.max(2, 0.8 * most));
  const mergeIntervals = (boxes: BlockIR[]) => {
    const out: [number, number][] = [];
    for (const [x0, x1] of boxes
      .map((b) => [b.bbox.x0, b.bbox.x1] as [number, number])
      .sort((p, q) => p[0] - q[0])) {
      const last = out[out.length - 1];
      if (last && x0 <= last[1] + 2) last[1] = Math.max(last[1], x1);
      else out.push([x0, x1]);
    }
    return out;
  };
  const intervals = mergeIntervals(columnCells.length ? columnCells : cells);
  // A label column whose cells wrap onto rows of their own ("1. High interest rates … |" with
  // the figures on the first line only) has no cell in the rows with the most cells: cells that
  // lie beside every known column are a column of their own.
  if (columnCells.length) {
    const beside = cells.filter(
      (b) =>
        !columnCells.includes(b) && !intervals.some(([x0, x1]) => b.bbox.x1 > x0 && b.bbox.x0 < x1),
    );
    if (beside.length) {
      intervals.push(...mergeIntervals(beside));
      intervals.sort((p, q) => p[0] - q[0]);
      for (let i = intervals.length - 1; i > 0; i--) {
        if (intervals[i]![0] <= intervals[i - 1]![1] + 2) {
          intervals[i - 1]![1] = Math.max(intervals[i - 1]![1], intervals[i]![1]);
          intervals.splice(i, 1);
        }
      }
    }
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
  const rowBounds = rowYs.map(
    (c, i) =>
      [
        i === 0 ? table.rect.y0 : (rowYs[i - 1]! + c) / 2,
        i === rowYs.length - 1 ? table.rect.y1 : (c + rowYs[i + 1]!) / 2,
      ] as const,
  );
  for (const b of cells) {
    const row = rowOf(b);
    const cx = (b.bbox.x0 + b.bbox.x1) / 2;
    // A header over a column group starts in its first column and keeps the group's width.
    const covered = intervals.flatMap(([x0, x1], i) =>
      Math.min(x1, b.bbox.x1) - Math.max(x0, b.bbox.x0) > 0 ? [i] : [],
    );
    const centred = intervals.findIndex(([x0, x1]) => cx >= x0 - 1 && cx <= x1 + 1);
    const col = covered.length > 1 ? covered[0]! : Math.max(0, centred);
    const last = covered.length > 1 ? covered[covered.length - 1]! : col;
    b.role = 'table-cell';
    b.tableCell = {
      tableId: table.id,
      row,
      col,
      cellRect: {
        x0: colBounds[col]![0],
        x1: colBounds[last]![1],
        y0: rowBounds[row]![0],
        y1: rowBounds[row]![1],
      },
    };
  }
}

const nearestIndex = (arr: number[], v: number) =>
  arr.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(arr[best]! - v) ? i : best), 0);

/** Roles (ARCHITECTURE.md §4.1 step 3). */
function classify(
  pages: { raw: RawPage; blocks: BlockIR[]; tables: TableRegion[]; figures: FigureRegion[] }[],
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
  // A short mark at the same height on many pages, outside the bands: a thumb index ("K") or
  // a section tab in the margin.
  const place = (b: BlockIR) => `${normalizeRepeat(blockText(b))}@${Math.round(b.bbox.y0 / 3)}`;
  const placeCounts = new Map<string, number>();
  for (const { blocks } of pages)
    new Set(blocks.filter((b) => blockText(b).trim().length <= 3).map(place)).forEach((k) =>
      placeCounts.set(k, (placeCounts.get(k) ?? 0) + 1),
    );
  const marked = (b: BlockIR) =>
    blockText(b).trim().length <= 3 &&
    pages.length >= 3 &&
    (placeCounts.get(place(b)) ?? 0) >= Math.max(3, pages.length * 0.3);

  for (const { raw, blocks, tables, figures } of pages) {
    for (const t of tables) assignTableCells(blocks, t);
    for (const b of blocks) {
      if (b.role === 'table-cell') {
        // Code listings framed by rules are not tables to translate.
        if (allMono(b)) {
          b.role = 'code';
          b.translatable = false;
        }
        // An equation in a cell ("Prev = 3.940⋅Fn") stays as it is.
        if (equationBlock(b)) b.translatable = false;
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
      else if (marked(b)) role = 'header';
      else if (mathRatio(b) >= 0.3 && !worded) role = 'formula';
      else if (allMono(b)) role = 'code';
      else if (CAPTION.test(text)) role = 'caption';
      // Rotated text: an axis title, or a stamp in the margin ("arXiv:2310.09571v1 [cs.CR]"),
      // which is the page's furniture: never translated ("[CS.Cr]"), not part of the text.
      else if (b.direction[1] !== 0) role = inMargin(b, blocks, figuresNear) ? 'header' : 'label';
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
        (allBold(b) &&
          b.lines.length <= 2 &&
          text.length < 120 &&
          !TERMINAL.test(text) &&
          // A bold item of a bulleted list ("• počtu výrobků, …") is not a heading.
          !/^\s*[•◦▪▫‣●○■□➢✓]|[,;]\s*$/u.test(text))
      )
        role = 'heading';
      else if (size <= stats.bodySize * 0.92 && b.bbox.y0 > raw.height * 0.6) role = 'footnote';

      // Formulas set in a text font (Times italic variables, Symbol operators) come out as
      // scattered letters ("O m m", "j j j", "(W"): nothing to translate, and engines glue them.
      if (
        !['caption', 'header', 'footer', 'page-number'].includes(role) &&
        (mathFragments(text) || equationBlock(b) || mathLike(text))
      )
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
        // A stamp in the margin is an identifier: "[cs.CR]" must not become "[CS.Cr]".
        if (b.direction[1] !== 0) b.translatable = false;
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
 * An equation set in a text font, read with its span boundaries too: a subscript set apart is
 * not part of a word ("F" + "head" is not "Fhead"; Google turned the "E" beside it into "AND").
 */
export function equationBlock(b: BlockIR): boolean {
  return (
    equationLike(blockText(b)) ||
    equationLike(b.lines.map((l) => l.spans.map((s) => s.text).join(' ')).join(' '))
  );
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

/** A numbered reference entry's first line ("[20] …", "20. …", "20) …"). */
const ENTRY_START = /^(?:\[\s*\d{1,3}\s*\]\s*|\(?\d{1,3}[.)]\s+)(?=\S)/u;
const entryNumber = (text: string): number | undefined => {
  const m = ENTRY_START.exec(text);
  return m ? Number(/\d+/.exec(m[0])![0]) : undefined;
};
const lineText = (l: BlockIR['lines'][number]) => l.spans.map((s) => s.text).join('');
/** A heading inside a reference list that is not one (an entry set large, an alphabet letter). */
const entryLike = (text: string) =>
  text.length <= 2 ||
  ENTRY_START.test(text) ||
  (text.length > 40 && /\b(?:1[5-9]|20)\d\d\b/.test(text));

/**
 * Everything after a references heading (any language) up to the next heading is a reference
 * entry, however small its type or low on the page; returns those blocks in reading order. A
 * paper's citation of itself ("ACM Reference Format: …") is kept as published too.
 */
function markReferences(pages: PageIR[]): BlockIR[] {
  const section: BlockIR[] = [];
  let inRefs = false;
  const keep = (b: BlockIR) => {
    b.role = 'reference';
    b.translatable = false;
  };
  for (const page of pages) {
    const order = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    for (const [i, b] of order.entries()) {
      const text = blockText(b).trim();
      if (b.role === 'heading') {
        if (REFERENCES.test(text)) inRefs = true;
        else if (inRefs && !entryLike(text)) inRefs = false;
        if (!SELF_CITATION_LABEL.test(text) || inRefs) continue;
      }
      if (b.role !== 'body' && b.role !== 'footnote' && b.role !== 'heading') continue;
      // A heading set as body text ("Literatura:" in the size of the text).
      if (b.role === 'body' && b.lines.length === 1 && text.length < 70 && REFERENCES.test(text)) {
        b.role = 'heading';
        inRefs = true;
        continue;
      }
      const label = SELF_CITATION_LABEL.exec(text);
      if (label && !inRefs) {
        const rest = text.slice(label[0].length).trim();
        if (rest.length >= 20) {
          keep(b);
        } else {
          // The label stays text; the blocks right below it are the citation.
          const size = avgSize(b);
          let prev = b;
          for (const next of order.slice(i + 1)) {
            if (!['body', 'footnote'].includes(next.role) || next.tableCell) break;
            if (next.bbox.y0 - prev.bbox.y1 > 0.9 * Math.max(size, avgSize(next))) break;
            if (SELF_CITATION_LABEL.test(blockText(next))) break;
            keep(next);
            prev = next;
          }
        }
        continue;
      }
      if (inRefs && b.role !== 'heading') {
        keep(b);
        section.push(b);
      }
    }
  }
  return section;
}

/** A page locator at the end of a citation ("s. 365.", "pp. 12–15", "S. 780-781", "с. 42"). */
const LOCATOR_END =
  /(?:\b(?:s|S|ss|p|pp|str|S|с|стр|ç|sf)\.\s*\d+(?:\s*[-–]\s*\d+)?|\b\d+\s*[-–]\s*\d+)\s*\.?\s*$/u;
/** The work cited: an author's initials ("K. Kautsky"), a title in quotes, a year or a volume. */
const CITED =
  /^(?:\p{Lu}\.\s*){1,3}\p{Lu}[\p{L}’'-]+|[„“"«][^„“”"«»]{3,}[“”"»]|\b(?:1[5-9]|20)\d\d\b|\b(?:vol|Vol|bd|Bd|Jahrg|Jahgr|Jg|t|nr|Nr|no|No|cilt|sayı|т|вып)\.?\s+(?:\d+|[IVXLC]+)\b/u;

/**
 * A footnote that is only a citation ("1 K. Kautsky, Eine neue Strategie, „Die Neue Zeit“,
 * Jahrg. XXVIII, bd. II, s. 365.") is kept as published, like a reference entry: its parts
 * are names, titles and abbreviations an engine mistranslates ("bd. II" → "no. II"). A note
 * that says something besides ("Tamże, s. 370." is too short to tell; a sentence has no list of
 * parts) is translated.
 */
function keepCitationNotes(pages: PageIR[]): void {
  for (const page of pages)
    for (const b of page.blocks) {
      if (b.role !== 'footnote' || !b.translatable || b.chain) continue;
      const text = blockText(b)
        .trim()
        .replace(/^(?:\d{1,3}|[*∗†‡§¶]{1,3})\s*/u, '');
      const parts = text.split(/,\s+/u);
      if (text.length > 300 || parts.length < 3 || !LOCATOR_END.test(text)) continue;
      // Every part short: a list of a citation's pieces, not a sentence with a page at its end.
      if (parts.some((p) => p.split(/\s+/u).length > 8) || !CITED.test(text)) continue;
      b.translatable = false;
    }
}

/**
 * A footnote is small text at the foot of a page that starts with its mark ("1 Instituto …",
 * "* Artículo …") and goes on in the lines right below. Small text low on the page that is
 * neither (a figure's labels, the items of a table, a licence line) is not one: it is a label
 * next to a figure, else body text. Returns the continuation lines of each footnote, to chain.
 */
function refineFootnotes(pages: PageIR[]): Map<string, string> {
  const continues = new Map<string, string>();
  const MARKED = /^(?:\d{1,3}|[*∗†‡§¶]{1,3})(?:\s+|(?=\p{L}))\S/u;
  for (const page of pages) {
    const order = [...page.blocks]
      .sort((a, b) => a.readingOrder - b.readingOrder)
      .filter((b) => b.role === 'footnote');
    const marked = (b: BlockIR) => {
      const first = b.lines[0]?.spans[0];
      return (
        MARKED.test(blockText(b).trim()) ||
        (!!first &&
          first.size < 0.8 * Math.max(...b.lines[0]!.spans.map((s) => s.size)) &&
          /^[\d*†‡§¶]{1,3}$/.test(first.text.trim()))
      );
    };
    let prev: BlockIR | undefined;
    for (const [i, b] of order.entries()) {
      const mark = marked(b);
      const size = avgSize(b);
      // A note without a mark right above the marked ones ("This document is fictional"): a
      // footnote too, not the end of the column's text.
      const next = order[i + 1];
      const aboveNotes =
        !!next &&
        marked(next) &&
        next.columnIndex === b.columnIndex &&
        next.bbox.y0 >= b.bbox.y1 - 1 &&
        next.bbox.y0 - b.bbox.y1 < 1.5 * size;
      const goesOn =
        !mark &&
        !!prev &&
        b.bbox.y0 - prev.bbox.y1 < 0.9 * Math.max(size, avgSize(prev)) &&
        b.bbox.y0 >= prev.bbox.y0 &&
        Math.abs(b.bbox.x0 - prev.bbox.x0) < 3 * Math.max(size, 6) &&
        b.columnIndex === prev.columnIndex;
      if (mark || aboveNotes) prev = b;
      else if (goesOn) {
        continues.set(b.id, prev!.id);
        prev = b;
      } else {
        const nearFigure = (page.figures ?? []).some(
          (f) => coverage(b.bbox, expand(f.bbox, 12)) > 0.5,
        );
        b.role = nearFigure ? 'label' : 'body';
        prev = undefined;
      }
    }
  }
  return continues;
}

/**
 * Splits the reference list into entries: the blocks that hold several (a line that starts the
 * next one) are cut there, and the ids of the blocks that start an entry are returned. Entries
 * start with a number ("[12]", "12."), or, in a list without numbers, at the outer edge of the
 * hanging indent (or at the indented line, when the first lines are indented).
 */
function splitReferenceEntries(
  pages: PageIR[],
  sectionBlocks: BlockIR[],
): { starts: Set<string>; ids: Set<string> } {
  const starts = new Set<string>();
  const ids = new Set(sectionBlocks.map((b) => b.id));
  if (!sectionBlocks.length) return { starts, ids };
  const pageNo = (b: BlockIR) => Number(b.id.split('-')[0]!.slice(1));
  const section = [...sectionBlocks].sort(
    (a, b) =>
      pageNo(a) - pageNo(b) ||
      a.columnIndex - b.columnIndex ||
      a.bbox.y0 - b.bbox.y0 ||
      a.bbox.x0 - b.bbox.x0,
  );
  const lines = section.flatMap((block) => block.lines.map((line, i) => ({ block, line, i })));
  const byBlock = new Map<BlockIR, typeof lines>();
  for (const l of lines) byBlock.set(l.block, [...(byBlock.get(l.block) ?? []), l]);
  const size = Math.max(1, avgSize(section[0]!));
  // Numbered: numbers in sequence ("[21]" after "[20]"; a skipped number is tolerated).
  const isStart = new Map<(typeof lines)[number], boolean>();
  let last = 0;
  let numbered = 0;
  for (const l of lines) {
    const n = entryNumber(lineText(l.line).trim());
    if (n !== undefined && n > last && n <= last + 3) {
      isStart.set(l, true);
      last = n;
      numbered++;
    } else isStart.set(l, false);
  }
  let finalMode: 'number' | 'hanging' | 'first-line' | 'blocks' =
    numbered >= 3 ? 'number' : 'blocks';
  if (finalMode === 'blocks') {
    // Where the lines of a column start: the outer edge of the text there.
    const groups = new Map<string, typeof lines>();
    for (const l of lines) {
      const key = `${l.block.id.split('-')[0]}:${l.block.columnIndex}`;
      groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    const outer = new Map<(typeof lines)[number], boolean>();
    // An entry's first line follows the end of the one before: the outer lines of a hanging
    // indent (the indented lines of a first-line indent) come after a finished line.
    const finished = (t: string) => TERMINAL.test(t) || /\d$|https?:\S+$/.test(t);
    const seen = { out: 0, outAfter: 0, ind: 0, indAfter: 0 };
    for (const g of groups.values()) {
      const xs = g.map((l) => l.line.bbox.x0).sort((a, b) => a - b);
      const edge = xs[Math.floor(xs.length * 0.1)]!;
      g.forEach((l, k) => {
        const o = l.line.bbox.x0 <= edge + 0.6 * size;
        outer.set(l, o);
        const prev = g[k - 1];
        if (!prev) return;
        const after = finished(lineText(prev.line).trim());
        if (o) {
          seen.out++;
          if (after) seen.outAfter++;
        } else {
          seen.ind++;
          if (after) seen.indAfter++;
        }
      });
    }
    if (seen.out >= 3 && seen.ind >= 3) {
      const diff = seen.outAfter / seen.out - seen.indAfter / seen.ind;
      if (diff > 0.25) finalMode = 'hanging';
      else if (diff < -0.25) finalMode = 'first-line';
    }
    for (const l of lines) {
      const o = outer.get(l)!;
      isStart.set(l, finalMode === 'hanging' ? o : finalMode === 'first-line' ? !o : l.i === 0);
    }
  }
  // A block that continues the entry above it: lower case after an unfinished line.
  lines.forEach((l, k) => {
    if (k === 0) return isStart.set(l, true);
    if (finalMode === 'number' || !isStart.get(l)) return;
    const prev = lines[k - 1]!;
    const text = lineText(l.line).trim();
    const before = lineText(prev.line).trim();
    const firstInBlock = l.i === 0;
    if (firstInBlock && /^\p{Ll}/u.test(text) && !TERMINAL.test(before) && !/\d$/.test(before))
      isStart.set(l, false);
  });
  // Cut the blocks at their entry starts.
  for (const page of pages) {
    const mine = new Set(section.filter((b) => page.blocks.includes(b)));
    if (!mine.size) continue;
    const order = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
    const out: BlockIR[] = [];
    for (const b of order) {
      if (!mine.has(b)) {
        out.push(b);
        continue;
      }
      const mineLines = byBlock.get(b)!;
      const cuts = mineLines.flatMap((l) => (l.i > 0 && isStart.get(l) ? [l.i] : []));
      if (isStart.get(mineLines[0]!)) starts.add(b.id);
      if (!cuts.length) {
        out.push(b);
        continue;
      }
      const all = b.lines;
      const bounds = [0, ...cuts, all.length];
      for (let k = 0; k + 1 < bounds.length; k++) {
        const part = all.slice(bounds[k], bounds[k + 1]);
        const bbox = unionAll(part.map((l) => l.bbox));
        if (k === 0) {
          b.lines = part;
          b.bbox = bbox;
          out.push(b);
          continue;
        }
        const piece: BlockIR = { ...b, id: `${b.id}.${k}`, lines: part, bbox };
        delete piece.underlines;
        delete piece.extraRedact;
        starts.add(piece.id);
        ids.add(piece.id);
        out.push(piece);
      }
    }
    // Columns of the list are read one after the other (the reading order may interleave them).
    const spots = out.flatMap((b, i) => (ids.has(b.id) ? [i] : []));
    const listed = spots
      .map((i) => out[i]!)
      .sort(
        (a, b) => a.columnIndex - b.columnIndex || a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
      );
    spots.forEach((i, k) => (out[i] = listed[k]!));
    out.forEach((b, i) => (b.readingOrder = i));
    page.blocks = out;
  }
  return { starts, ids };
}

/**
 * Paragraph chains across columns and pages (ARCHITECTURE.md §4.1), and across display formulas
 * or floats that interrupt a sentence ("… ortalaması olan [equation] ölçütüyle hesaplanmıştır.").
 */
const INTERRUPTING = new Set<Role>(['formula', 'caption', 'table-cell', 'label']);
function linkChains(
  pages: BlockIR[][],
  entryStarts: Set<string>,
  sectionIds: Set<string>,
  footLinks: Map<string, string>,
): void {
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

  // A chart's legend set as text in the column flow ("Cross-language = 1083") is not where a
  // sentence goes on: "…contain obfuscated code," and "we attempt to de-obfuscate them" were
  // sent apart, and "de-obfuscate" came back as "obfuscate".
  const labelLike = (b: BlockIR) => {
    const t = blockText(b).trim();
    // One line to the eye: "Cross-language =" and its right-aligned "1083" are two lines.
    const baselines = new Set(b.lines.map((l) => Math.round(l.baseline)));
    return baselines.size === 1 && t.length < 40 && !/^\p{Ll}/u.test(t);
  };
  // Sentences continued after one or more display formulas.
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i]!;
    if (a.role !== 'body' || !worded(a) || labelLike(a)) continue;
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

  // Reference entries split into one block per line by their hanging indent ("Çetin, B. (2017).
  // Basit Brayton çevriminde elektrik üretimi" | "maliyetinin parametrik analizi. Fırat …"): a
  // line continues the entry when it is indented under the entry's first line, or when the line
  // before does not end a sentence and no entry number starts it.
  // By position, not reading order: two-column reference lists interleave in reading order and
  // an entry's first line may be wider than its column. A block that starts an entry (found
  // before, by number or by the hanging indent) never continues the one above.
  const references = ordered.filter((b) => b.role === 'reference');
  for (const a of references) {
    const size = avgSize(a);
    const last = a.lines[a.lines.length - 1]!;
    const step = (b: BlockIR) => b.lines[0]!.baseline - last.baseline;
    const below = references
      .filter(
        (b) =>
          b !== a &&
          pageOf(b) === pageOf(a) &&
          step(b) > 0.5 * size &&
          step(b) <= Math.max(1.6 * size, 1.25 * (lineStep(a) ?? size)) &&
          b.bbox.x0 >= a.bbox.x0 - 3 * size &&
          b.bbox.x0 <= a.bbox.x0 + 3 * size &&
          Math.abs(avgSize(b) - size) < Math.max(0.3, 0.08 * size),
      )
      .sort((x, y) => step(x) - step(y));
    const b = below[0];
    if (!b || !free(a, b)) continue;
    if (entryStarts.has(b.id)) continue;
    const head = a.chain ? (byId.get(a.chain.paragraphId) ?? a) : a;
    const hanging = b.bbox.x0 > head.bbox.x0 + 0.5 * size;
    if (hanging || (!TERMINAL.test(blockText(a).trim()) && !ENTRY_START.test(blockText(b))))
      link(a, b);
  }
  // A footnote's next lines are part of it.
  for (const b of ordered) {
    const a = byId.get(footLinks.get(b.id) ?? '');
    if (a && b.role === 'footnote' && free(a, b)) link(a, b);
  }
  // The rest of the list in reading order: an entry goes on in the next column or on the next
  // page, or under its first line when the blocks were not joined by position.
  const listed = ordered.filter((b) => sectionIds.has(b.id));
  for (let i = 1; i < listed.length; i++) {
    const a = listed[i - 1]!;
    const b = listed[i]!;
    if (!entryStarts.has(b.id) && free(a, b)) link(a, b);
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
    if (labelLike(a)) continue;
    let k = i + 1;
    while (
      k + 1 < sequence.length &&
      labelLike(sequence[k]!) &&
      (pageOf(sequence[k]!) !== pageOf(a) || sequence[k]!.columnIndex !== a.columnIndex)
    )
      k++;
    const b = sequence[k]!;
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

/**
 * A subscript or superscript that came out as a block of its own ("t" under the "v" of
 * "v_t^(u)" in a sentence) joins the line it belongs to, beside the formula there: it then
 * travels and is set with that formula, not left behind as a lone letter.
 */
function joinScripts(blocks: BlockIR[]): BlockIR[] {
  const joined = new Set<BlockIR>();
  for (const s of blocks) {
    if (s.role !== 'formula' || s.lines.length !== 1) continue;
    const t = blockText(s).replace(/\s/g, '');
    if (!t || [...t].length > 3) continue;
    const cy = (s.bbox.y0 + s.bbox.y1) / 2;
    const size = avgSize(s);
    for (const host of blocks) {
      if (!['body', 'caption', 'footnote'].includes(host.role) || host.direction[1] !== 0) continue;
      // The line it hangs from or rises above, with a formula piece right beside it.
      const line = host.lines.find(
        (l) =>
          cy > l.bbox.y0 - 0.5 * size &&
          cy < l.bbox.y1 + 0.6 * size &&
          l.spans.some(
            (sp) => sp.font.isMath && sp.bbox.x1 >= s.bbox.x0 - 3 && sp.bbox.x0 <= s.bbox.x1 + 1,
          ),
      );
      if (!line) continue;
      const baseline = s.lines[0]!.baseline;
      line.spans = [
        ...line.spans,
        ...s.lines[0]!.spans.map((sp) => ({ ...sp, baseline: sp.baseline ?? baseline })),
      ].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      line.bbox = union(line.bbox, s.bbox);
      host.bbox = union(host.bbox, s.bbox);
      joined.add(s);
      break;
    }
  }
  return blocks.filter((b) => !joined.has(b));
}

/** Full analysis: raw MuPDF pages → IR pages with roles, columns, reading order, chains and tables. */
export function analyzeDocument(raw: RawPage[]): PageIR[] {
  const pages = raw.map((r) => {
    const tables = detectTables(r);
    return { raw: r, tables, blocks: buildBlocks(r, tables), figures: figureRegions(r, tables) };
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
  for (const p of pages) {
    formulaPieces(p.blocks);
    p.blocks = joinScripts(p.blocks);
  }
  const result = pages.map(({ raw: r, blocks, figures }) => {
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
      figures: figures.map((f) => ({ bbox: f.content, formula: f.bars })),
    } satisfies PageIR;
  });
  const section = markReferences(result);
  const footLinks = refineFootnotes(result);
  keepCitationNotes(result);
  const entries = splitReferenceEntries(result, section);
  linkChains(
    result.map((p) => p.blocks),
    entries.starts,
    entries.ids,
    footLinks,
  );
  if (result[0]) {
    orderAuthors(result[0]);
    splitCentredLines(result[0]);
  }
  return result;
}

/** The heading that ends a paper's front matter: the abstract, keywords or the first section. */
export const FRONT_END =
  /^(?:\d+\.?\s|abstract|özet|öz$|zusammenfassung|résumé|resumen|resumo|riassunto|samenvatting|streszczenie|аннотация|анотація|keywords|introduction)/iu;

/**
 * The author grid above the abstract, read author by author: each name (set as a heading) with
 * the affiliation and e-mail below it, row by row, left to right. Column detection put the right
 * half of the grid after the abstract's column ("Nicola Ronzoni" | … | "nicola.ronzoni@sap.com").
 */
function orderAuthors(page: PageIR): void {
  const end = Math.min(
    ...page.blocks
      .filter((b) => b.role === 'heading' && FRONT_END.test(blockText(b).trim()))
      .map((b) => b.bbox.y0),
  );
  const front = page.blocks.filter(
    (b) => b.bbox.y1 <= end && !['header', 'footer', 'page-number'].includes(b.role),
  );
  const narrow = front.filter((b) => b.bbox.x1 - b.bbox.x0 < 0.6 * page.width);
  const names = narrow.filter((b) => b.role === 'heading');
  // A grid has names side by side; a title over its author line is none.
  const beside = (a: BlockIR, b: BlockIR) =>
    Math.min(a.bbox.y1, b.bbox.y1) > Math.max(a.bbox.y0, b.bbox.y0) &&
    (a.bbox.x1 <= b.bbox.x0 || b.bbox.x1 <= a.bbox.x0);
  if (!names.some((a) => names.some((b) => beside(a, b)))) return;
  const overlap = (a: BlockIR, b: BlockIR) =>
    Math.min(a.bbox.x1, b.bbox.x1) - Math.max(a.bbox.x0, b.bbox.x0) >
    0.5 * Math.min(a.bbox.x1 - a.bbox.x0, b.bbox.x1 - b.bbox.x0);
  const members = new Map<BlockIR, BlockIR[]>(names.map((n) => [n, [n]]));
  for (const b of narrow) {
    if (members.has(b)) continue;
    const name = names
      .filter((n) => n.bbox.y1 <= b.bbox.y0 + 2 && overlap(n, b))
      .sort((p, q) => q.bbox.y1 - p.bbox.y1)[0];
    if (!name) return; // Not a grid of names: leave the order as it is.
    members.get(name)!.push(b);
  }
  // An affiliation is set line by line ("SAP Security Research" over "Mougins, France"): each
  // line a block of its own, translated and laid out in its place.
  let next = page.blocks.length;
  for (const [name, blocks] of members)
    members.set(
      name,
      blocks.flatMap((b) => {
        if (b === name || b.lines.length < 2 || b.role !== 'body') return [b];
        const lines = b.lines.map((line): BlockIR => ({
          ...b,
          id: `p${page.index}-b${next++}`,
          bbox: { ...line.bbox },
          lines: [line],
        }));
        page.blocks.splice(page.blocks.indexOf(b), 1, ...lines);
        front.splice(front.indexOf(b), 1, ...lines);
        return lines;
      }),
    );
  const row = (b: BlockIR) => Math.round(b.bbox.y0 / 6);
  const top = Math.min(...names.map((n) => n.bbox.y0));
  const wide = front.filter((b) => !narrow.includes(b)).sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const ordered = [
    ...wide.filter((b) => b.bbox.y0 < top),
    ...names
      .sort((a, b) => row(a) - row(b) || a.bbox.x0 - b.bbox.x0)
      .flatMap((n) => members.get(n)!.sort((a, b) => a.bbox.y0 - b.bbox.y0)),
    ...wide.filter((b) => b.bbox.y0 >= top),
  ];
  // The grid comes as a whole where it starts, before the abstract's column.
  const page_ = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
  const at = page_.findIndex((b) => front.includes(b));
  const rest = page_.filter((b) => !front.includes(b));
  [...rest.slice(0, at), ...ordered, ...rest.slice(at)].forEach((b, i) => (b.readingOrder = i));
}

/**
 * Centred lines above the abstract, each centred on its own ("†School of Computer Science …,
 * Singapore" over "*School of Cyber Science …, China"): one affiliation per line, each a block,
 * translated and laid out in its place. The title (a heading) stays one block.
 */
function splitCentredLines(page: PageIR): void {
  const end = Math.min(
    ...page.blocks
      .filter((b) => b.role === 'heading' && FRONT_END.test(blockText(b).trim()))
      .map((b) => b.bbox.y0),
  );
  const middle = (r: Rect) => (r.x0 + r.x1) / 2;
  let next = page.blocks.length;
  const order = [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder);
  const out = order.flatMap((b) => {
    const split =
      b.role === 'body' &&
      b.bbox.y1 <= end &&
      b.lines.length >= 2 &&
      b.lines.every((l) => Math.abs(middle(l.bbox) - middle(b.bbox)) < 3) &&
      b.lines.some((l) => l.bbox.x1 - l.bbox.x0 < 0.9 * (b.bbox.x1 - b.bbox.x0));
    if (!split) return [b];
    return b.lines.map((line): BlockIR => ({
      ...b,
      id: `p${page.index}-b${next++}`,
      bbox: { ...line.bbox },
      lines: [line],
    }));
  });
  if (out.length === order.length) return;
  out.forEach((b, i) => (b.readingOrder = i));
  page.blocks = out;
}

export { blockText };
