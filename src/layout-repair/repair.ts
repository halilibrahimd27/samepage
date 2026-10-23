import { coverage, expand, intersect, union } from '../core/ir/geometry';
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
  strategies?: { r1?: boolean; r2?: boolean; scale?: boolean; fallbacks?: boolean };
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
  const use = { r1: true, r2: true, scale: true, fallbacks: true, ...input.strategies };
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

  /** Obstacles of a page for a given state: untouched blocks, other units' boxes, figures. */
  const obstaclesFor = (s: State, pageIndex: number): Obstacle[] => {
    const page = pages[pageIndex]!;
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
      if (!preexisting(v.bbox)) out.push({ rect: v.bbox, owner: 'vector' });
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
    const below = obstacles.filter(
      (o) => o.rect.x0 < box.x1 && o.rect.x1 > box.x0 && o.rect.y0 >= box.y1 - 0.5,
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
      if (s.fallback) continue;
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
        if (m.params.scale <= best) continue;
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
      if (s.fallback) continue;
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
    if (s.fallback) continue;
    const key = groupKey(s);
    byGroup.set(key, [...(byGroup.get(key) ?? []), s]);
  }
  for (const [, members] of byGroup) {
    const scales = members.map((m) => m.params.scale);
    if (Math.max(...scales) - Math.min(...scales) > policy.consistency.maxScaleSpread + 1e-9) {
      issues.push({
        code: 'SCALE_INCONSISTENT',
        severity: 'warning',
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
