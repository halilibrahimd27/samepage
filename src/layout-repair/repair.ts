import { contains, coverage, expand, intersect, union } from '../core/ir/geometry';
import type { BlockIR, PageIR, Rect, Role } from '../core/ir/types';
import type { DecodedRun } from '../core/segment/codec';
import { layoutUnit, type BlockLayout } from '../pdf/typeset/layout';
import type { PdfStyle, PdfUnit } from '../pdf/typeset/segments';
import type { Measurer } from '../pdf/typeset/types';
import { minScaleFor, type Policy } from './policy';
import type { FallbackKind, Issue, LayoutParams, RepairStep } from './types';

/**
 * Layout Repair Engine (LAYOUT_REPAIR.md §5–§6): pure, deterministic and bounded. Works on
 * translation units (a unit may span several boxes of a chain) and returns their final layouts,
 * fallbacks, repair steps and the issues left for the report.
 */
export interface RepairUnitInput {
  unit: PdfUnit;
  runs: DecodedRun<PdfStyle>[];
}

export interface RepairInput {
  pages: PageIR[];
  units: RepairUnitInput[];
  measurer: Measurer;
  sizeFactor: (fontName: string) => number;
  policy: Policy;
  /** Enabled strategies (all by default); used to measure baselines and each strategy's effect. */
  strategies?: {
    flow?: boolean;
    r1?: boolean;
    r2?: boolean;
    scale?: boolean;
    fallbacks?: boolean;
  };
}

export interface UnitResult {
  unitId: string;
  role: Role;
  pageIndex: number;
  layouts: BlockLayout[];
  params: LayoutParams;
  fallback?: FallbackKind;
  steps: RepairStep[];
  /** Overflow-note fallback: marker number and the text moved to the appendix. */
  overflowNote?: { marker: number; text: string };
  /** Annotation fallback: original text kept, translation in a PDF note at `rect`. */
  annotation?: { rect: Rect; text: string };
}

export interface RepairOutput {
  units: UnitResult[];
  issues: Issue[];
}

interface State {
  input: RepairUnitInput;
  role: Role;
  pageIndex: number;
  blocks: BlockIR[];
  baseSize: number;
  params: LayoutParams;
  layouts: BlockLayout[];
  steps: RepairStep[];
  fallback?: FallbackKind;
  overflowNote?: { marker: number; text: string };
  annotation?: { rect: Rect; text: string };
  noExpand: boolean;
  iterations: number;
}

const pageOf = (b: BlockIR) => Number(b.id.split('-')[0]!.slice(1));
/** The repair note of a unit whose translation reads as its source: nothing is kept untranslated. */
export const SAME_AS_SOURCE = 'translation same as the source; original kept as it is';
const fits = (layouts: BlockLayout[]) => !layouts.some((l) => l.overflow);
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Ink bounding box of a block layout (text runs only). */
export function inkBox(layout: BlockLayout): Rect | null {
  let r: Rect | null = null;
  for (const line of layout.lines) {
    for (const run of line.runs) {
      let box: Rect;
      if (line.dir && line.origin) {
        const [dx, dy] = line.dir;
        const x0 = line.origin.x + dx * run.x;
        const y0 = line.origin.y + dy * run.x;
        const x1 = x0 + dx * run.width;
        const y1 = y0 + dy * run.width;
        const ux = dy * run.size * 0.75;
        box = {
          x0: Math.min(x0, x1, x0 + ux),
          y0: Math.min(y0, y1),
          x1: Math.max(x0, x1, x0 + ux),
          y1: Math.max(y0, y1),
        };
      } else {
        box = {
          x0: run.x,
          y0: line.baseline - run.rise - run.size * 0.72,
          x1: run.x + run.width,
          y1: line.baseline - run.rise + run.size * 0.2,
        };
      }
      r = r ? union(r, box) : box;
    }
  }
  return r;
}

/** Everything on a page that translated text must not run into. */
interface Obstacle {
  rect: Rect;
  owner: string;
}

function contentBounds(page: PageIR): Rect {
  const rects = [
    ...page.blocks.map((b) => b.bbox),
    ...page.images.map((i) => i.bbox),
    ...page.vectors.map((v) => v.bbox),
  ];
  if (!rects.length) return { x0: 0, y0: 0, x1: page.width, y1: page.height };
  const r = rects.reduce(union);
  return {
    x0: Math.max(0, r.x0),
    y0: Math.max(0, r.y0),
    x1: Math.min(page.width, r.x1),
    y1: Math.min(page.height, r.y1),
  };
}

export function repairDocument(input: RepairInput): RepairOutput {
  const { pages, measurer, policy } = input;
  const use = { flow: true, r1: true, r2: true, scale: true, fallbacks: true, ...input.strategies };
  const clearance = policy.expansion.minClearancePt;

  const states: State[] = input.units
    .map((u) => {
      const first = u.unit.blocks[0]!;
      return {
        input: u,
        role: u.unit.role,
        pageIndex: pageOf(first),
        blocks: u.unit.blocks,
        baseSize: u.unit.encoded.baseStyle.size,
        params: {
          scale: 1,
          trackingEm: 0,
          leading: 1,
          spaceFactor: 1,
          boxes: Object.fromEntries(u.unit.blocks.map((b) => [b.id, { ...b.bbox }])),
        },
        layouts: [] as BlockLayout[],
        steps: [] as RepairStep[],
        noExpand: false,
        iterations: 0,
      };
    })
    .sort(
      (a, b) => a.pageIndex - b.pageIndex || a.blocks[0]!.readingOrder - b.blocks[0]!.readingOrder,
    );

  const translated = new Set(states.flatMap((s) => s.blocks.map((b) => b.id)));
  const layoutWith = (s: State, params: LayoutParams) =>
    layoutUnit(s.input.unit.id, s.blocks, s.input.runs, s.input.unit.encoded.baseStyle, measurer, {
      sizeFactor: input.sizeFactor,
      scale: params.scale,
      trackingEm: params.trackingEm,
      leading: params.leading,
      spaceFactor: params.spaceFactor,
      boxes: params.boxes,
    });
  const relayout = (s: State) => {
    s.layouts = layoutWith(s, s.params);
    return fits(s.layouts);
  };
  const tryParams = (s: State, params: LayoutParams) => {
    s.iterations++;
    const layouts = layoutWith(s, params);
    if (!fits(layouts)) return false;
    s.params = params;
    s.layouts = layouts;
    return true;
  };

  // Filled boxes holding text (a paragraph's shading, line by line in Word's PDFs) are
  // backgrounds: text set over them collides with nothing. Not a card drawn in a picture of the
  // page: only its own text may stand on it, a title above runs into it.
  const backgroundsByPage = new Map<number, Set<PageIR['vectors'][number]>>();
  const backgroundsOf = (pageIndex: number) => {
    let set = backgroundsByPage.get(pageIndex);
    if (!set) {
      const page = pages[pageIndex]!;
      const lines = page.blocks.flatMap((b) => b.lines.map((l) => l.bbox));
      set = new Set(
        page.vectors.filter(
          (v) =>
            v.isRectangle &&
            !v.isStroked &&
            !v.picture &&
            lines.some((l) => coverage(l, v.bbox) > 0.8),
        ),
      );
      backgroundsByPage.set(pageIndex, set);
    }
    return set;
  };

  /** Obstacles of a page for a given state: untouched blocks, other units' boxes, figures. */
  const obstaclesFor = (s: State, pageIndex: number): Obstacle[] => {
    const page = pages[pageIndex]!;
    const backgrounds = backgroundsOf(pageIndex);
    const own = new Set(s.blocks.map((b) => b.id));
    const ownBoxes = s.blocks.filter((b) => pageOf(b) === pageIndex).map((b) => b.bbox);
    // Shapes the block already sat on in the original (backgrounds, figure areas) are not obstacles.
    const preexisting = (r: Rect) => ownBoxes.some((o) => intersect(o, r));
    const out: Obstacle[] = [];
    for (const b of page.blocks) {
      if (own.has(b.id)) continue;
      if (translated.has(b.id)) continue; // their current boxes are added below
      out.push({ rect: b.bbox, owner: b.id });
    }
    for (const other of states) {
      if (other === s) continue;
      for (const b of other.blocks)
        if (pageOf(b) === pageIndex)
          out.push({ rect: other.params.boxes[b.id] ?? b.bbox, owner: b.id });
    }
    for (const img of page.images)
      if (!preexisting(img.bbox)) out.push({ rect: img.bbox, owner: 'image' });
    for (const v of page.vectors)
      if (!preexisting(v.bbox) && !backgrounds.has(v)) out.push({ rect: v.bbox, owner: 'vector' });
    return out;
  };

  /**
   * Consistency groups (§5 R3): same role and original size. Running text (body, headings,
   * captions, footnotes…) is grouped across the whole document so a paragraph continued on the
   * next page keeps the same size; figure labels and table cells are grouped per page.
   */
  const groupKey = (s: State) => {
    const local = s.role === 'label' || s.role === 'table-cell';
    return `${local ? s.pageIndex : '*'}|${s.role}|${Math.round(s.baseSize / policy.consistency.sizeTolerancePt)}`;
  };

  // ---- R1: micro-typography -------------------------------------------------------------
  const r1 = (s: State): boolean => {
    const justify = s.blocks.some((b) => b.align === 'justify');
    const attempts: Partial<LayoutParams>[] = [
      ...(justify ? [{ spaceFactor: policy.wordSpacing.minRatio }] : []),
      {
        spaceFactor: justify ? policy.wordSpacing.minRatio : 1,
        trackingEm: policy.tracking.minEm / 2,
      },
      { spaceFactor: justify ? policy.wordSpacing.minRatio : 1, trackingEm: policy.tracking.minEm },
      {
        spaceFactor: justify ? policy.wordSpacing.minRatio : 1,
        trackingEm: policy.tracking.minEm,
        leading: 0.92,
      },
    ];
    for (const a of attempts) {
      if (s.iterations >= policy.maxIterationsPerBlock * 4) return false;
      if (tryParams(s, { ...s.params, ...a })) {
        s.steps.push({
          code: 'R1_MICRO',
          unitId: s.input.unit.id,
          note: `tracking ${a.trackingEm ?? 0} em, spacing ×${a.spaceFactor ?? 1}, leading ×${a.leading ?? 1}`,
        });
        return true;
      }
    }
    return false;
  };

  // ---- R2: expand into free whitespace -----------------------------------------------------
  const r2 = (s: State): boolean => {
    if (!policy.expansion.enabled || s.noExpand) return false;
    const last = s.blocks[s.blocks.length - 1]!;
    if (last.direction[1] !== 0) return false;
    const p = pageOf(last);
    const page = pages[p]!;
    const bounds = contentBounds(page);
    const obstacles = obstaclesFor(s, p);
    const box = s.params.boxes[last.id]!;
    const original = last.bbox;
    const h = original.y1 - original.y0;
    const w = original.x1 - original.x0;
    const advance =
      last.lines.length > 1 ? (original.y1 - original.y0) / last.lines.length : s.baseSize * 1.25;
    const grown = { ...box };

    // Down: until the next obstacle overlapping horizontally, the content bottom, or the growth cap.
    // Line boxes of adjacent paragraphs overlap by a point or two (ascenders, descenders): a
    // block that starts inside our box but reaches below it is still the next obstacle.
    const below = obstacles.filter(
      (o) =>
        o.rect.x0 < box.x1 &&
        o.rect.x1 > box.x0 &&
        o.rect.y0 > box.y0 + 0.5 * (box.y1 - box.y0) &&
        o.rect.y1 > box.y1,
    );
    const floor = Math.min(bounds.y1, ...below.map((o) => o.rect.y0 - clearance));
    grown.y1 = Math.max(
      box.y1,
      Math.min(floor, original.y1 + Math.max(policy.expansion.maxGrowRatio * h, 1.2 * advance)),
    );

    // Sideways: within the column (or the content width for full-width blocks); never across a gutter.
    const column = last.columnIndex >= 0 ? page.columns[last.columnIndex] : undefined;
    const left = column ? Math.max(bounds.x0, column.x0) : bounds.x0;
    const right = column ? Math.min(bounds.x1, column.x1) : bounds.x1;
    const beside = obstacles.filter((o) => o.rect.y0 < grown.y1 && o.rect.y1 > grown.y0);
    const rightLimit = Math.min(
      right,
      ...beside.filter((o) => o.rect.x0 >= box.x1 - 0.5).map((o) => o.rect.x0 - clearance),
    );
    const leftLimit = Math.max(
      left,
      ...beside.filter((o) => o.rect.x1 <= box.x0 + 0.5).map((o) => o.rect.x1 + clearance),
    );
    const singleLine = last.lines.length === 1;
    const capW = singleLine ? Number.POSITIVE_INFINITY : policy.expansion.maxGrowRatio * w;
    if (last.align === 'center') {
      const d = Math.max(0, Math.min(rightLimit - box.x1, box.x0 - leftLimit, capW / 2));
      grown.x0 = box.x0 - d;
      grown.x1 = box.x1 + d;
    } else if (last.align === 'right') {
      grown.x0 = Math.min(box.x0, Math.max(leftLimit, box.x0 - capW));
    } else {
      grown.x1 = Math.max(box.x1, Math.min(rightLimit, box.x1 + capW));
    }
    if (last.tableCell) {
      const cell = last.tableCell.cellRect;
      grown.x0 = Math.max(grown.x0, cell.x0 + 1);
      grown.x1 = Math.min(grown.x1, cell.x1 - 1);
      grown.y1 = Math.min(grown.y1, cell.y1 - 1);
    }
    // Text in a framed or shaded box (a callout, a highlighted finding) stays inside it with the
    // box's own inner margin: the smallest shape around the block, not a page-sized background.
    const frame = page.vectors
      .map((v) => v.bbox)
      .filter(
        (r) =>
          contains(r, original, 1) &&
          (r.x1 - r.x0) * (r.y1 - r.y0) < 4 * Math.max(1, w * h) &&
          r.x1 - r.x0 > w + 2,
      )
      .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
    if (frame) {
      const pad = Math.max(2, Math.min(original.x0 - frame.x0, frame.x1 - original.x1));
      grown.x0 = Math.max(grown.x0, Math.min(box.x0, frame.x0 + pad));
      grown.x1 = Math.min(grown.x1, Math.max(box.x1, frame.x1 - pad));
      grown.y1 = Math.min(
        grown.y1,
        Math.max(box.y1, frame.y1 - Math.max(2, original.y0 - frame.y0)),
      );
    }
    if (grown.x0 >= box.x0 - 0.01 && grown.x1 <= box.x1 + 0.01 && grown.y1 <= box.y1 + 0.01)
      return false;
    s.iterations++;
    const params = { ...s.params, boxes: { ...s.params.boxes, [last.id]: grown } };
    const layouts = layoutWith(s, params);
    if (!fits(layouts)) {
      // Keep the growth (it helps the next strategies) but record nothing yet.
      s.params = params;
      s.layouts = layouts;
      return false;
    }
    // Tighten the box to the ink actually used so later blocks see the real obstacle.
    const ink = inkBox(layouts[layouts.length - 1]!);
    const tight = ink
      ? {
          x0: Math.min(original.x0, Math.max(grown.x0, ink.x0)),
          y0: original.y0,
          x1: Math.max(original.x1, Math.min(grown.x1, ink.x1)),
          y1: Math.max(original.y1, Math.min(grown.y1, ink.y1 + 1)),
        }
      : grown;
    s.params = { ...params, boxes: { ...params.boxes, [last.id]: tight } };
    s.layouts = layoutWith(s, s.params);
    if (!fits(s.layouts)) {
      s.params = params;
      s.layouts = layouts;
    }
    const b = s.params.boxes[last.id]!;
    s.steps.push({
      code: 'R2_EXPAND',
      unitId: s.input.unit.id,
      note: `box grown by ${round(b.x1 - original.x1 + original.x0 - b.x0)} pt wide, ${round(b.y1 - original.y1)} pt down`,
    });
    return true;
  };

  /** Smallest scale ≥ `floor` at which the unit fits (step 0.01), or null. */
  const requiredScale = (s: State, floor: number): number | null => {
    for (let sc = 1; sc >= floor - 1e-9; sc = round(sc - 0.01)) {
      if (fits(layoutWith(s, { ...s.params, scale: sc }))) return sc;
    }
    return null;
  };

  // ---- R4: individual scale (binary search) -------------------------------------------------
  const r4 = (s: State, floor: number, ceiling: number): boolean => {
    if (fits(layoutWith(s, { ...s.params, scale: ceiling }))) {
      s.params = { ...s.params, scale: ceiling };
      relayout(s);
      return true;
    }
    if (!fits(layoutWith(s, { ...s.params, scale: floor }))) return false;
    let lo = floor;
    let hi = ceiling;
    while (hi - lo > 0.005) {
      const mid = round((lo + hi) / 2);
      if (fits(layoutWith(s, { ...s.params, scale: mid }))) lo = mid;
      else hi = mid;
    }
    s.params = { ...s.params, scale: round(lo) };
    relayout(s);
    s.steps.push({ code: 'R4_BLOCK_SCALE', unitId: s.input.unit.id, note: `scale ${round(lo)}` });
    return true;
  };

  // ---- Base layout -----------------------------------------------------------------------
  for (const s of states) relayout(s);

  // ---- R0: column flow -------------------------------------------------------------------
  // Consecutive paragraphs of a column are set one after another, as a typesetter would: each
  // takes the height its translation needs, the original gaps between them stay, and a column
  // part that still overflows gets one scale for all its paragraphs. Fitting each paragraph in
  // its own box left gaps under the short ones and shrank the long ones.
  const flowed = new Set<State>();
  if (use.flow) flowColumns();

  function flowColumns(): void {
    const horizontal = (b: BlockIR) => b.direction[1] === 0 && !b.tableCell && b.lines.length > 0;
    const single = states.filter(
      (s) =>
        (s.role === 'body' || s.role === 'heading') &&
        s.blocks.length === 1 &&
        horizontal(s.blocks[0]!),
    );
    // A paragraph that goes on in the next column or page may end a column part: its first box
    // follows the paragraphs above it down to its own bottom, and the chain carries the rest.
    const heads = new Set(
      states.filter(
        (s) =>
          s.role === 'body' &&
          s.blocks.length > 1 &&
          horizontal(s.blocks[0]!) &&
          pageOf(s.blocks[0]!) === s.pageIndex,
      ),
    );
    const lineStep = (b: BlockIR) => {
      const steps = b.lines
        .slice(1)
        .map((l, k) => l.baseline - b.lines[k]!.baseline)
        .filter((g) => g > 0)
        .sort((x, y) => x - y);
      return steps.length ? steps[Math.floor(steps.length / 2)]! : (b.bbox.y1 - b.bbox.y0) * 1.2;
    };
    // A one-line heading or label may take its column's width (bold type runs wider).
    const widths = new Map<State, { x0: number; x1: number }>();
    const needed = (s: State, scale: number): number => {
      const b = s.blocks[0]!;
      const w = widths.get(s) ?? b.bbox;
      const tall = { ...b.bbox, x0: w.x0, x1: w.x1, y1: b.bbox.y0 + 5000 };
      const [l] = layoutWith(s, { ...s.params, scale, boxes: { [b.id]: tall } });
      if (!l || l.overflow) return Infinity;
      if (!l.lines.length) return b.bbox.y1 - b.bbox.y0;
      const lastLine = b.lines[b.lines.length - 1]!;
      const descent = (lastLine.bbox.y1 - lastLine.baseline) * scale;
      return l.lines[l.lines.length - 1]!.baseline + descent - b.bbox.y0 + 0.5;
    };
    const overlapX = (a: Rect, b: Rect) =>
      Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
    const byPage = new Map<number, State[]>();
    for (const s of [...single, ...heads])
      byPage.set(s.pageIndex, [...(byPage.get(s.pageIndex) ?? []), s]);
    for (const [pageIndex, members] of byPage) {
      const page = pages[pageIndex]!;
      // A head stays an obstacle to every part it does not end.
      const ids = new Set(members.filter((m) => !heads.has(m)).map((m) => m.blocks[0]!.id));
      const backgrounds = backgroundsOf(pageIndex);
      const fixed: Rect[] = [
        ...page.blocks.filter((b) => !ids.has(b.id)).map((b) => b.bbox),
        ...page.images.map((i) => i.bbox),
        ...page.vectors.filter((v) => !backgrounds.has(v)).map((v) => v.bbox),
      ];
      const sorted = [...members].sort((a, b) => a.blocks[0]!.bbox.y0 - b.blocks[0]!.bbox.y0);
      const taken = new Set<State>();
      for (const start of sorted) {
        if (taken.has(start) || heads.has(start)) continue;
        const region = [start];
        taken.add(start);
        for (;;) {
          const last = region[region.length - 1]!.blocks[0]!;
          const next = sorted.find(
            (o) =>
              !taken.has(o) &&
              o.blocks[0]!.columnIndex === last.columnIndex &&
              o.blocks[0]!.bbox.y0 >= last.bbox.y1 - 1 &&
              overlapX(o.blocks[0]!.bbox, last.bbox),
          );
          if (!next) break;
          const b = next.blocks[0]!;
          const between = fixed.some(
            (r) =>
              r.y1 > last.bbox.y1 + 0.5 &&
              r.y0 < b.bbox.y0 - 0.5 &&
              Math.min(r.x1, last.bbox.x1) - Math.max(r.x0, last.bbox.x0) > 2,
          );
          if (between || b.bbox.y0 - last.bbox.y1 > 2.5 * lineStep(last)) break;
          region.push(next);
          taken.add(next);
          if (heads.has(next)) break;
        }
        if (region.length < 2) continue;
        const head = heads.has(region[region.length - 1]!) ? region.pop()! : null;
        const span = region.reduce(
          (r, s) => union(r, s.blocks[0]!.bbox),
          region[0]!.blocks[0]!.bbox,
        );
        for (const s of region) {
          const b = s.blocks[0]!;
          if (b.lines.length === 1 && (s.role === 'heading' || b.align !== 'justify'))
            widths.set(s, { x0: b.align === 'center' ? span.x0 : b.bbox.x0, x1: span.x1 });
        }
        // Only where the boxes do not serve: a paragraph that needs more than a slight shrink, or
        // one that leaves a line and a half empty under it. Text about as long as the original
        // keeps its place.
        const slight = (s: State) =>
          fits(s.layouts) || fits(layoutWith(s, { ...s.params, scale: 0.95 }));
        const gapping = (s: State) => {
          const b = s.blocks[0]!;
          return needed(s, 1) < b.bbox.y1 - b.bbox.y0 - 1.5 * lineStep(b);
        };
        if (region.every(slight) && !region.some(gapping)) {
          if (head) taken.delete(head);
          continue;
        }
        const blocks = region.map((s) => s.blocks[0]!);
        const top = blocks[0]!.bbox.y0;
        const lastBox = blocks[blocks.length - 1]!.bbox;
        const headBox = head?.blocks[0]!.bbox;
        const headGap = headBox ? Math.max(0, headBox.y0 - lastBox.y1) : 0;
        // Room down to whatever stands below this part of the column, or the page's content end.
        const below = fixed
          .filter(
            (r) =>
              r.y0 >= lastBox.y1 - 0.5 && Math.min(r.x1, span.x1) - Math.max(r.x0, span.x0) > 2,
          )
          .map((r) => r.y0 - clearance);
        const limit = headBox
          ? headBox.y0 - headGap + 0.5 * lineStep(head.blocks[0]!)
          : Math.max(lastBox.y1, Math.min(contentBounds(page).y1, ...below));
        const gaps = blocks.map((b, k) =>
          k ? Math.max(0, b.bbox.y0 - blocks[k - 1]!.bbox.y1) : 0,
        );
        const total = (scale: number) =>
          region.reduce((sum, s, k) => sum + needed(s, scale) + gaps[k]!, 0);
        const floor = minScaleFor(policy, 'body');
        let scale = 1;
        if (top + total(1) > limit) {
          if (top + total(floor) > limit) {
            if (head) taken.delete(head);
            continue;
          }
          let lo = floor;
          let hi = 1;
          while (hi - lo > 0.005) {
            const mid = round((lo + hi) / 2);
            if (top + total(mid) <= limit) lo = mid;
            else hi = mid;
          }
          scale = round(lo);
        }
        let cursor = top;
        region.forEach((s, k) => {
          const b = s.blocks[0]!;
          const y0 = k ? cursor + gaps[k]! : top;
          const w = widths.get(s) ?? b.bbox;
          const box = { x0: w.x0, x1: w.x1, y0, y1: y0 + needed(s, scale) };
          cursor = box.y1;
          s.params = { ...s.params, scale, boxes: { [b.id]: box } };
          s.noExpand = true;
          relayout(s);
          flowed.add(s);
          s.steps.push({
            code: 'R0_FLOW',
            unitId: s.input.unit.id,
            note: `set in the column's flow${scale < 1 ? `, scale ${scale}` : ''}`,
          });
        });
        if (head) {
          const b = head.blocks[0]!;
          const box = { ...b.bbox, y0: Math.min(b.bbox.y1 - 1, cursor + headGap) };
          head.params = { ...head.params, boxes: { ...head.params.boxes, [b.id]: box } };
          relayout(head);
          flowed.add(head);
          head.steps.push({
            code: 'R0_FLOW',
            unitId: head.input.unit.id,
            note: "first box set in the column's flow",
          });
        }
      }
    }
  }

  // ---- Repair passes -------------------------------------------------------------------------
  for (let pass = 0; pass < policy.maxPassesPerPage; pass++) {
    const failing = states.filter((s) => !s.fallback && !fits(s.layouts));
    if (!failing.length) break;
    for (const s of failing) {
      if (use.r1 && r1(s)) continue;
      if (use.r2 && r2(s)) continue;
      if (use.r1) r1(s);
    }
    if (!use.scale) break;

    // R3: consistency groups — same page, same role, same original size (± tolerance).
    const groups = new Map<string, State[]>();
    for (const s of states) {
      if (s.fallback || flowed.has(s)) continue;
      const key = groupKey(s);
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const [, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      if (members.every((m) => fits(m.layouts))) continue;
      const floor = minScaleFor(policy, members[0]!.role);
      const required = members.map((m) =>
        fits(m.layouts) ? m.params.scale : requiredScale(m, floor),
      );
      const candidates = [...new Set(required.filter((r): r is number => r !== null))].sort(
        (a, b) => b - a,
      );
      let best = 1;
      let bestCount = -1;
      for (const c of candidates) {
        const count = required.filter((r) => r !== null && r >= c - 1e-9).length;
        if (count > bestCount) {
          best = c;
          bestCount = count;
        }
      }
      if (best >= 1) continue;
      for (const m of members) {
        // A paragraph that fits keeps its size: shrinking it too left a gap under it.
        if (m.params.scale <= best || fits(m.layouts)) continue;
        m.params = { ...m.params, scale: best };
        relayout(m);
        m.steps.push({
          code: 'R3_GROUP_SCALE',
          unitId: m.input.unit.id,
          note: `group scale ${best}`,
        });
      }
    }

    // R4 then R6 for what still does not fit.
    for (const s of states.filter((x) => !x.fallback && !fits(x.layouts))) {
      const floor = minScaleFor(policy, s.role);
      const group = s.params.scale;
      if (r4(s, Math.max(floor, round(group - policy.consistency.maxScaleSpread)), group)) continue;
      if (r4(s, floor, group)) continue;
      fallback(s);
    }

    // Collisions created by expansion: revert the later unit's growth and retry next pass.
    for (const s of states) {
      if (s.fallback || flowed.has(s)) continue;
      const collision = s.layouts.some((l) => {
        const ink = inkBox(l);
        if (!ink) return false;
        const block = s.blocks.find((b) => b.id === l.blockId)!;
        return obstaclesFor(s, pageOf(block)).some((o) => {
          const hit = intersect(expand(ink, -0.5), o.rect);
          return hit && !intersect(block.bbox, o.rect);
        });
      });
      if (collision && !s.noExpand) {
        s.noExpand = true;
        s.params = {
          ...s.params,
          boxes: Object.fromEntries(s.blocks.map((b) => [b.id, { ...b.bbox }])),
        };
        s.steps = s.steps.filter((st) => st.code !== 'R2_EXPAND');
        relayout(s);
      }
    }
  }
  for (const s of states.filter((x) => !x.fallback && !fits(x.layouts))) fallback(s);

  // ---- R6: fallbacks -----------------------------------------------------------------------
  function fallback(s: State): void {
    const id = s.input.unit.id;
    if (!use.fallbacks) {
      s.fallback = 'keep-original';
      s.steps.push({
        code: 'R6_FALLBACK',
        unitId: id,
        note: 'translation does not fit; original text kept',
      });
      return;
    }
    const absolute = s.role === 'label' ? policy.minFontPt.label : policy.minFontPt.absolute;
    const relaxedFloor = Math.min(
      minScaleFor(policy, s.role),
      absolute /
        Math.max(s.baseSize * input.sizeFactor(s.input.unit.encoded.baseStyle.fontName), 0.1),
    );
    if (r4(s, round(relaxedFloor), s.params.scale)) {
      s.fallback = 'relaxed-min';
      s.steps.push({
        code: 'R6_FALLBACK',
        unitId: id,
        note: `relaxed minimum size, scale ${s.params.scale}`,
      });
      return;
    }
    const kind = policy.fallback[s.role] ?? policy.fallback.default;
    const translation = s.input.runs.map((r) => r.text).join('');
    // A name or a code the translation leaves as it is ("SECURICOM"): the original stays, no note.
    const flat = (t: string) => t.replace(/\s+/gu, ' ').trim();
    const original = s.blocks
      .flatMap((b) => b.lines.map((l) => l.spans.map((sp) => sp.text).join('')))
      .join(' ');
    if (flat(translation) === flat(original)) {
      s.fallback = 'keep-original';
      s.steps.push({ code: 'R6_FALLBACK', unitId: id, note: SAME_AS_SOURCE });
      return;
    }
    if (kind === 'annotation') {
      s.fallback = 'annotation';
      s.annotation = { rect: s.blocks[0]!.bbox, text: translation };
      s.steps.push({
        code: 'R6_FALLBACK',
        unitId: id,
        note: 'original kept; translation added as a PDF note',
      });
      return;
    }
    if (kind === 'overflow-note') {
      // Fit as much as possible at the role minimum, cut at a sentence/clause boundary, and move
      // the rest to the overflow notes appendix.
      s.params = { ...s.params, scale: minScaleFor(policy, s.role) };
      relayout(s);
      const remaining = s.layouts[s.layouts.length - 1]?.remaining ?? '';
      if (remaining && remaining.length < translation.length * 0.7) {
        s.fallback = 'overflow-note';
        s.overflowNote = { marker: 0, text: remaining };
        s.steps.push({
          code: 'R6_FALLBACK',
          unitId: id,
          note: `${remaining.length} characters moved to the overflow notes`,
        });
        return;
      }
    }
    s.fallback = 'keep-original';
    s.steps.push({
      code: 'R6_FALLBACK',
      unitId: id,
      note: 'translation does not fit; original text kept',
    });
  }

  // Overflow-note markers are numbered in reading order.
  let marker = 0;
  for (const s of states) if (s.overflowNote) s.overflowNote.marker = ++marker;

  // ---- Final plan-time detection ---------------------------------------------------------------
  const issues: Issue[] = [];
  for (const s of states) {
    const id = s.input.unit.id;
    if (s.fallback === 'keep-original') {
      issues.push({
        code: 'KEPT_ORIGINAL',
        severity: 'error',
        pageIndex: s.pageIndex,
        unitId: id,
        bbox: s.blocks[0]!.bbox,
        message: 'translation does not fit; original text kept',
      });
      continue;
    }
    if (s.fallback === 'annotation') {
      issues.push({
        code: 'ANNOTATION',
        severity: 'warning',
        pageIndex: s.pageIndex,
        unitId: id,
        bbox: s.blocks[0]!.bbox,
        message: 'original label kept, translation in a PDF note',
      });
      continue;
    }
    if (s.fallback === 'overflow-note') {
      issues.push({
        code: 'OVERFLOW_NOTE',
        severity: 'warning',
        pageIndex: s.pageIndex,
        unitId: id,
        bbox: s.blocks[0]!.bbox,
        message: 'part of the translation moved to the overflow notes',
        metrics: { characters: s.overflowNote!.text.length },
      });
    }
    if (s.fallback === 'relaxed-min') {
      issues.push({
        code: 'BELOW_MIN_SIZE',
        severity: 'warning',
        pageIndex: s.pageIndex,
        unitId: id,
        bbox: s.blocks[0]!.bbox,
        message: 'text reduced below the normal minimum size',
        metrics: { scale: s.params.scale },
      });
    }
    for (const l of s.layouts) {
      const block = s.blocks.find((b) => b.id === l.blockId)!;
      const p = pageOf(block);
      const ink = inkBox(l);
      if (!ink) continue;
      const page = pages[p]!;
      if (
        ink.x0 < -0.5 ||
        ink.y0 < -0.5 ||
        ink.x1 > page.width + 0.5 ||
        ink.y1 > page.height + 0.5
      ) {
        issues.push({
          code: 'OUT_OF_BOUNDS',
          severity: 'error',
          pageIndex: p,
          unitId: id,
          bbox: ink,
          message: 'text outside the page',
        });
      }
      const hit = obstaclesFor(s, p).find((o) => {
        const i = intersect(expand(ink, -1), o.rect);
        return i && !intersect(block.bbox, o.rect) && coverage(i, ink) > 0.01;
      });
      if (hit && s.fallback !== 'overflow-note') {
        issues.push({
          code: 'COLLISION',
          severity: 'error',
          pageIndex: p,
          unitId: id,
          bbox: ink,
          message: `text runs into ${hit.owner}`,
        });
      }
    }
    if (s.blocks.length > 1 && !fits(s.layouts) && s.fallback !== 'overflow-note') {
      issues.push({
        code: 'CHAIN_BROKEN',
        severity: 'error',
        pageIndex: s.pageIndex,
        unitId: id,
        message: 'chained paragraph does not complete within its boxes',
      });
    }
  }
  // Consistency: members of a group should not differ by more than maxScaleSpread.
  const byGroup = new Map<string, State[]>();
  for (const s of states) {
    // A column part set in its flow has its own scale by design.
    if (s.fallback || flowed.has(s)) continue;
    const key = groupKey(s);
    byGroup.set(key, [...(byGroup.get(key) ?? []), s]);
  }
  for (const [, members] of byGroup) {
    const scales = members.map((m) => m.params.scale);
    if (Math.max(...scales) - Math.min(...scales) > policy.consistency.maxScaleSpread + 1e-9) {
      issues.push({
        code: 'SCALE_INCONSISTENT',
        // Paragraphs that fit keep their size while a tight one shrinks: noted, not a fault.
        severity: 'info',
        pageIndex: members[0]!.pageIndex,
        message: `scales ${Math.min(...scales)}–${Math.max(...scales)} in one group`,
      });
    }
  }

  return {
    units: states.map((s) => ({
      unitId: s.input.unit.id,
      role: s.role,
      pageIndex: s.pageIndex,
      layouts: s.layouts,
      params: s.params,
      ...(s.fallback ? { fallback: s.fallback } : {}),
      steps: s.steps,
      ...(s.overflowNote ? { overflowNote: s.overflowNote } : {}),
      ...(s.annotation ? { annotation: s.annotation } : {}),
    })),
    issues,
  };
}
