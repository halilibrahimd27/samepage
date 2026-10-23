import type { Rect } from './types';

/** Pure rectangle helpers (PDF points, y down). */
export const width = (r: Rect) => r.x1 - r.x0;
export const height = (r: Rect) => r.y1 - r.y0;
export const area = (r: Rect) => Math.max(0, width(r)) * Math.max(0, height(r));

export function union(a: Rect, b: Rect): Rect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

export function unionAll(rects: Rect[]): Rect {
  return rects.reduce(union);
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

export function iou(a: Rect, b: Rect): number {
  const i = intersect(a, b);
  if (!i) return 0;
  const ai = area(i);
  return ai / (area(a) + area(b) - ai);
}

/** Fraction of `inner` covered by `outer`. */
export function coverage(inner: Rect, outer: Rect): number {
  const i = intersect(inner, outer);
  return i ? area(i) / Math.max(area(inner), 1e-9) : 0;
}

export function contains(outer: Rect, inner: Rect, tolerance = 0): boolean {
  return (
    inner.x0 >= outer.x0 - tolerance &&
    inner.y0 >= outer.y0 - tolerance &&
    inner.x1 <= outer.x1 + tolerance &&
    inner.y1 <= outer.y1 + tolerance
  );
}

export function expand(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

/** Horizontal overlap length. */
export const xOverlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
export const yOverlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** Uniform-grid spatial index for "which rects touch this area" queries. */
export class SpatialIndex<T> {
  private readonly cells = new Map<string, { rect: Rect; item: T }[]>();
  constructor(private readonly cellSize = 50) {}
  private keys(r: Rect): string[] {
    const out: string[] = [];
    for (let x = Math.floor(r.x0 / this.cellSize); x <= Math.floor(r.x1 / this.cellSize); x++) {
      for (let y = Math.floor(r.y0 / this.cellSize); y <= Math.floor(r.y1 / this.cellSize); y++)
        out.push(`${x},${y}`);
    }
    return out;
  }
  insert(rect: Rect, item: T): void {
    for (const k of this.keys(rect)) {
      const list = this.cells.get(k) ?? [];
      list.push({ rect, item });
      this.cells.set(k, list);
    }
  }
  query(rect: Rect): T[] {
    const seen = new Set<T>();
    for (const k of this.keys(rect)) {
      for (const e of this.cells.get(k) ?? []) if (intersect(e.rect, rect)) seen.add(e.item);
    }
    return [...seen];
  }
}
