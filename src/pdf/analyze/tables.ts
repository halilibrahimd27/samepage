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
 * Finds ruled tables from vector graphics: thin horizontal rules of about the same width that
 * are stacked closely form a table (booktabs or fully ruled). A narrow rule never joins a wider
 * one as a table of its own (a column table under a full-width table, a chart axis); narrower
 * rules inside a table (booktabs \cmidrule) only add row boundaries. In booktabs style a thick
 * bottom rule followed by another thick rule starts the next table. Regions without text are
 * ignored.
 */
export function detectTables(page: RawPage): TableRegion[] {
  const width = (r: Rect) => r.x1 - r.x0;
  const thickness = (r: Rect) => r.y1 - r.y0;
  // Graphics between two rules (chart bars) mean the lower rule is not part of the table; a
  // row background spanning the table (\rowcolor) does not.
  const graphics = page.vectors
    .map((v) => v.bbox)
    .filter((b) => b.y1 - b.y0 > 3 && b.x1 - b.x0 > 2);
  // A rule that a shape runs across (a bar across a chart's grid line) is no table rule; cell
  // borders are thinner than a shape.
  const crossed = (r: Rect) =>
    graphics.some((g) => g.y0 < r.y0 - 1 && g.y1 > r.y1 + 1 && xOverlap(g, r) > 0);
  const hrules = page.vectors
    .filter((v) => v.bbox.y1 - v.bbox.y0 < 2 && v.bbox.x1 - v.bbox.x0 > 30)
    .map((v) => v.bbox)
    .filter((r) => !crossed(r))
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const vrules = page.vectors
    .filter((v) => v.bbox.x1 - v.bbox.x0 < 2 && v.bbox.y1 - v.bbox.y0 > 6)
    .map((v) => v.bbox);
  const graphicsBetween = (a: Rect, b: Rect) =>
    graphics.some(
      (g) =>
        g.y0 >= a.y1 - 0.5 &&
        g.y1 <= b.y0 + 0.5 &&
        xOverlap(g, b) > 0 &&
        width(g) < 0.9 * Math.min(width(a), width(b)),
    );

  // A table's text stays within its rules; a line running past them (the paragraph between a
  // table and a chart's grid lines below it) means the rules belong to different things.
  const textLines = page.blocks.flatMap((b) => b.lines.map((l) => l.bbox));
  const textBeyond = (a: Rect, b: Rect) => {
    const span = { x0: Math.min(a.x0, b.x0), y0: 0, x1: Math.max(a.x1, b.x1), y1: 0 };
    return textLines.some(
      (l) =>
        l.y0 >= a.y1 - 0.5 &&
        l.y1 <= b.y0 + 0.5 &&
        xOverlap(l, span) > 0 &&
        (l.x0 < span.x0 - 5 || l.x1 > span.x1 + 5),
    );
  };

  const groups: Rect[][] = [];
  const narrow: Rect[] = [];
  for (const rule of hrules) {
    const g = groups.find((grp) => {
      const last = grp[grp.length - 1]!;
      const overlap = xOverlap(last, rule) / Math.max(width(last), width(rule));
      return (
        overlap > 0.8 &&
        rule.y0 - last.y1 < 120 &&
        !graphicsBetween(last, rule) &&
        !textBeyond(last, rule)
      );
    });
    if (g) g.push(rule);
    else groups.push([rule]);
  }
  // Single narrow rules inside a wider group are row boundaries of that table.
  const tables: Rect[][] = [];
  for (const g of groups) {
    if (g.length === 1) narrow.push(g[0]!);
    else tables.push(...splitBooktabs(g, thickness));
  }

  const regions: TableRegion[] = [];
  for (const g of tables) {
    if (g.length < 2) continue;
    const rect: Rect = {
      x0: Math.min(...g.map((r) => r.x0)),
      y0: g[0]!.y0,
      x1: Math.max(...g.map((r) => r.x1)),
      y1: g[g.length - 1]!.y1,
    };
    const inside = textLines.filter((l) => coverage(l, rect) > 0.6);
    if (inside.length < 2) continue;
    // Tables without a bottom rule: rows that continue right below the last rule, at the
    // table's row pitch and inside its width, belong to it.
    const tops = cluster(
      inside.map((l) => l.y0),
      1,
    );
    const pitch = tops.length > 1 ? median(tops.slice(1).map((t, i) => t - tops[i]!)) : 0;
    let lastTop = tops[tops.length - 1] ?? rect.y1;
    while (pitch > 0) {
      // …and line up with the table's cells (a chart right below does not).
      const aligned = (l: Rect) =>
        inside.some((m) => Math.abs(m.x0 - l.x0) < 2.5 || Math.abs(m.x1 - l.x1) < 2.5);
      const next = textLines.filter(
        (l) =>
          l.y0 > lastTop + 1 &&
          l.y0 - lastTop <= 1.3 * pitch &&
          coverage(l, { ...rect, y0: l.y0, y1: l.y1 }) > 0.9 &&
          aligned(l),
      );
      if (!next.length) break;
      lastTop = Math.max(...next.map((l) => l.y0));
      rect.y1 = Math.max(rect.y1, ...next.map((l) => l.y1));
    }
    const inner = narrow.filter((r) => coverage(r, rect) > 0.9);
    regions.push({
      id: `p${page.index}-t${regions.length}`,
      rect,
      rows: [...g, ...inner].map((r) => (r.y0 + r.y1) / 2).sort((a, b) => a - b),
      cols: vrules
        .filter((v) => coverage(v, rect) > 0.8)
        .map((v) => (v.x0 + v.x1) / 2)
        .sort((a, b) => a - b),
    });
  }
  // Widest first: a booktabs \cmidrule inside a table is not a table of its own.
  const singles: { rect: Rect; rows: number[] }[] = [];
  for (const rule of [...narrow].sort((a, b) => width(b) - width(a))) {
    const taken = [...regions.map((t) => t.rect), ...singles.map((s) => s.rect)];
    if (taken.some((t) => coverage(rule, t) > 0.5)) continue;
    const rect = singleRuleTable(page, rule, regions);
    if (rect) singles.push({ rect, rows: [(rule.y0 + rule.y1) / 2] });
  }
  for (const s of mergeSideBySide(singles, textLines, page.width))
    regions.push({ id: `p${page.index}-t${regions.length}`, rect: s.rect, rows: s.rows, cols: [] });
  return regions;
}

/**
 * Column groups ruled apart (\cmidrule per group: "Mono-language | Cross-language") are one
 * table, with the row labels on their left ("DT", "RF", "XGB") that no rule spans.
 */
function mergeSideBySide(
  tables: { rect: Rect; rows: number[] }[],
  textLines: Rect[],
  pageWidth: number,
): { rect: Rect; rows: number[] }[] {
  const out: { rect: Rect; rows: number[] }[] = [];
  for (const t of [...tables].sort((a, b) => a.rect.x0 - b.rect.x0)) {
    const height = (r: Rect) => r.y1 - r.y0;
    const beside = out.find(
      (o) =>
        Math.min(o.rect.y1, t.rect.y1) - Math.max(o.rect.y0, t.rect.y0) >
          0.5 * Math.min(height(o.rect), height(t.rect)) && t.rect.x0 - o.rect.x1 < 40,
    );
    if (beside) {
      beside.rect = {
        x0: Math.min(beside.rect.x0, t.rect.x0),
        y0: Math.min(beside.rect.y0, t.rect.y0),
        x1: Math.max(beside.rect.x1, t.rect.x1),
        y1: Math.max(beside.rect.y1, t.rect.y1),
      };
      beside.rows = [...beside.rows, ...t.rows].sort((a, b) => a - b);
    } else out.push({ rect: { ...t.rect }, rows: [...t.rows] });
  }
  for (const o of out) {
    // Row labels: lines just left of the table, level with its rows, in its half of a
    // two-column page (the other column's text is no label).
    const mid = pageWidth / 2;
    const half = o.rect.x0 >= mid - 10 ? mid - 10 : -Infinity;
    const rowCentres = textLines
      .filter((l) => coverage(l, o.rect) > 0.6)
      .map((l) => (l.y0 + l.y1) / 2);
    const labels = textLines.filter(
      (l) =>
        l.x1 <= o.rect.x0 + 1 &&
        o.rect.x0 - l.x1 < 40 &&
        l.x0 >= half &&
        rowCentres.some((c) => Math.abs(c - (l.y0 + l.y1) / 2) < 2),
    );
    if (labels.length >= 2) o.rect.x0 = Math.min(...labels.map((l) => l.x0));
  }
  return out;
}

const CAPTION =
  /^(?:Table|Tab\.|Tablo|Tabelle|Tableau|Tabla|Tabella|Tabela|Tabel|Tabulka|Tabell|Таблица|Таблиця|Πίνακας)\s*[\dIVX]/iu;

/**
 * A table with a single rule, under its header row (ACM, many journals): header cells right above
 * the rule and data cells below, side by side within its width, and its caption close by. Rows
 * continue at the table's pitch until the caption, a paragraph line or the end of the cells.
 */
function singleRuleTable(page: RawPage, rule: Rect, tables: TableRegion[]): Rect | null {
  const lines = page.blocks
    .flatMap((b) => b.lines)
    .map((l) => ({
      bbox: l.bbox,
      text: l.chars
        .map((c) => c.c)
        .join('')
        .trim(),
    }))
    .filter((l) => l.text && !tables.some((t) => coverage(l.bbox, t.rect) > 0.5));
  const within = (r: Rect) => r.x0 >= rule.x0 - 3 && r.x1 <= rule.x1 + 3;
  const rows = (ls: typeof lines) =>
    cluster(
      ls.map((l) => l.bbox.y0),
      2,
    ).map((y) => ls.filter((l) => Math.abs(l.bbox.y0 - y) <= 2));

  const header = lines.filter(
    (l) => within(l.bbox) && l.bbox.y1 <= rule.y0 + 1 && rule.y0 - l.bbox.y1 < 26,
  );
  if (!rows(header).some((r) => r.length >= 2)) return null;

  // Lines of the neighbouring column are not the table's (nor its end).
  const below = lines
    .filter(
      (l) => xOverlap(l.bbox, rule) > 0 && l.bbox.y0 >= rule.y1 - 1 && l.bbox.y0 - rule.y1 < 400,
    )
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const data: typeof lines = [];
  let last = rule.y1;
  let pitch = 0;
  for (const row of rows(below)) {
    const top = Math.min(...row.map((l) => l.bbox.y0));
    const height = Math.max(...row.map((l) => l.bbox.y1 - l.bbox.y0));
    const gap = top - last;
    if (gap > (pitch ? 1.7 * pitch : 1.4 * height)) break;
    const inside = row.filter((l) => within(l.bbox));
    // The caption, a paragraph line or text running past the table ends it.
    if (inside.some((l) => CAPTION.test(l.text))) break;
    if (!inside.length || inside.length < row.filter((l) => xOverlap(l.bbox, rule) > 0).length)
      break;
    if (inside.length === 1 && inside[0]!.bbox.x1 - inside[0]!.bbox.x0 > 0.6 * (rule.x1 - rule.x0))
      break;
    if (data.length) pitch ||= top - last;
    data.push(...inside);
    last = top;
  }
  if (!rows(data).some((r) => r.length >= 2) || data.length < 4) return null;

  const cells = [...header, ...data];
  const rect: Rect = {
    x0: Math.min(rule.x0, ...cells.map((l) => l.bbox.x0)),
    y0: Math.min(...header.map((l) => l.bbox.y0)),
    x1: Math.max(rule.x1, ...cells.map((l) => l.bbox.x1)),
    y1: Math.max(...data.map((l) => l.bbox.y1)),
  };
  // Its caption: above the header (IEEE) or below the data (ACM), over the table's width.
  const caption = lines.some(
    (l) =>
      CAPTION.test(l.text) &&
      xOverlap(l.bbox, rect) > 0 &&
      ((l.bbox.y1 <= rect.y0 + 1 && rect.y0 - l.bbox.y1 < 40) ||
        (l.bbox.y0 >= rect.y1 - 1 && l.bbox.y0 - rect.y1 < 120)),
  );
  return caption ? rect : null;
}

/**
 * booktabs draws top and bottom rules thicker than the rules in between; a thick rule that
 * follows a thick bottom rule is the top rule of the next table. Groups with uniform rules
 * (fully ruled tables) are returned unchanged.
 */
function splitBooktabs(group: Rect[], thickness: (r: Rect) => number): Rect[][] {
  const max = Math.max(...group.map(thickness));
  const min = Math.min(...group.map(thickness));
  if (max - min < 0.15) return [group];
  const thick = (r: Rect) => thickness(r) > (max + min) / 2;
  const out: Rect[][] = [[group[0]!]];
  for (let i = 1; i < group.length; i++) {
    const cur = out[out.length - 1]!;
    const prev = group[i - 1]!;
    if (cur.length > 1 && thick(prev) && thick(group[i]!)) out.push([group[i]!]);
    else cur.push(group[i]!);
  }
  return out;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

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
