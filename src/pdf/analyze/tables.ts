import { coverage, xOverlap } from '../../core/ir/geometry';
import type { Rect } from '../../core/ir/types';
import type { RawPage } from '../extract/raw';

export interface TableRegion {
  id: string;
  rect: Rect;
  /** y positions of horizontal rules and x positions of vertical rules inside the region. */
  rows: number[];
  cols: number[];
}

/**
 * Finds ruled tables from vector graphics: thin horizontal rules that overlap horizontally and
 * are stacked closely form a table (booktabs or fully ruled). Regions without text are ignored.
 */
export function detectTables(page: RawPage): TableRegion[] {
  const hrules = page.vectors
    .filter((v) => v.bbox.y1 - v.bbox.y0 < 2 && v.bbox.x1 - v.bbox.x0 > 30)
    .map((v) => v.bbox)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const vrules = page.vectors
    .filter((v) => v.bbox.x1 - v.bbox.x0 < 2 && v.bbox.y1 - v.bbox.y0 > 6)
    .map((v) => v.bbox);

  const groups: Rect[][] = [];
  for (const rule of hrules) {
    const g = groups.find((grp) => {
      const last = grp[grp.length - 1]!;
      const overlap = xOverlap(last, rule) / Math.min(last.x1 - last.x0, rule.x1 - rule.x0);
      return overlap > 0.8 && rule.y0 - last.y1 < 120;
    });
    if (g) g.push(rule);
    else groups.push([rule]);
  }

  const textLines = page.blocks.flatMap((b) => b.lines.map((l) => l.bbox));
  const regions: TableRegion[] = [];
  for (const g of groups) {
    if (g.length < 2) continue;
    const rect: Rect = {
      x0: Math.min(...g.map((r) => r.x0)),
      y0: g[0]!.y0,
      x1: Math.max(...g.map((r) => r.x1)),
      y1: g[g.length - 1]!.y1,
    };
    const inside = textLines.filter((l) => coverage(l, rect) > 0.6);
    if (inside.length < 2) continue;
    regions.push({
      id: `p${page.index}-t${regions.length}`,
      rect,
      rows: g.map((r) => (r.y0 + r.y1) / 2),
      cols: vrules
        .filter((v) => coverage(v, rect) > 0.8)
        .map((v) => (v.x0 + v.x1) / 2)
        .sort((a, b) => a - b),
    });
  }
  return regions;
}

/** Clusters sorted values whose gaps are below `tolerance`; returns cluster means. */
export function cluster(values: number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last && v - last[last.length - 1]! <= tolerance) last.push(v);
    else out.push([v]);
  }
  return out.map((c) => c.reduce((s, v) => s + v, 0) / c.length);
}
