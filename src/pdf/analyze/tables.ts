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
  const hrules = stitchRules(
    page.vectors
      .filter((v) => v.bbox.y1 - v.bbox.y0 < 2 && v.bbox.x1 - v.bbox.x0 > 8)
      .map((v) => v.bbox)
      .filter((r) => !crossed(r)),
  )
    .filter((r) => r.x1 - r.x0 > 30)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const vrules = page.vectors
    .filter((v) => v.bbox.x1 - v.bbox.x0 < 2 && v.bbox.y1 - v.bbox.y0 > 6)
    .map((v) => v.bbox);
  const graphicsBetween = (a: Rect, b: Rect) => {
    const between = graphics.filter(
      (g) =>
        g.y0 >= a.y1 - 0.5 &&
        g.y1 <= b.y0 + 0.5 &&
        xOverlap(g, b) > 0 &&
        width(g) < 0.9 * Math.min(width(a), width(b)),
    );
    if (!between.length) return false;
    // Shapes that tile the table's width (one filled rectangle per cell) are a row's
    // background, not chart bars.
    let covered = 0;
    let end = -Infinity;
    for (const g of [...between].sort((p, q) => p.x0 - q.x0)) {
      const x0 = Math.max(g.x0, end);
      if (g.x1 > x0) covered += g.x1 - x0;
      end = Math.max(end, g.x1);
    }
    const gaps = between.length > 1 && covered >= 0.9 * Math.min(width(a), width(b));
    return !gaps;
  };

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

  const captionLines = page.blocks.flatMap((b) =>
    b.lines
      .filter((l) =>
        CAPTION.test(
          l.chars
            .map((c) => c.c)
            .join('')
            .trim(),
        ),
      )
      .map((l) => l.bbox),
  );
  const captionBetween = (a: Rect, b: Rect) =>
    captionLines.some((c) => c.y0 >= a.y1 - 0.5 && c.y1 <= b.y0 + 0.5 && xOverlap(c, b) > 0);

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
        !textBeyond(last, rule) &&
        // A caption between two rules starts the next table (unless it is the first row of
        // this one: a caption inside the grid).
        !(grp.length > 1 && captionBetween(last, rule))
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

  let regions: TableRegion[] = [];
  // A caption drawn inside the first or last row of a fully ruled grid is not a table row.
  const inRow = (c: Rect, a: Rect, b: Rect) => c.y0 >= a.y1 - 1 && c.y1 <= b.y0 + 1;
  const trimmed = (rules: Rect[]): Rect[] => {
    let g = rules;
    while (g.length > 2 && captionLines.some((c) => inRow(c, g[0]!, g[1]!))) g = g.slice(1);
    while (g.length > 2 && captionLines.some((c) => inRow(c, g[g.length - 2]!, g[g.length - 1]!)))
      g = g.slice(0, -1);
    return g;
  };
  for (const g0 of tables) {
    const g = trimmed(g0);
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
  regions = joinBeside(regions, page.index);
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
  for (const rect of captionTables(
    page,
    regions.map((r) => r.rect),
  ))
    regions.push({ id: `p${page.index}-t${regions.length}`, rect, rows: [], cols: [] });
  return regions;
}

interface TextLine {
  bbox: Rect;
  text: string;
  size: number;
}

/**
 * Tables without (enough) rules, found from their caption: the rows just below a caption
 * (above, for a caption under its table) in the caption's page column where lines sit side by
 * side and the columns repeat from row to row (left, right or centre edges within 3 pt). The run
 * ends at a paragraph line, the next caption, a large gap or a change of type size. A table
 * needs 3 rows and 2 columns; lines of both columns of a two-column page are no table.
 */
export function captionTables(page: RawPage, taken: Rect[]): Rect[] {
  const lines: TextLine[] = page.blocks.flatMap((b) =>
    b.lines
      .filter((l) => l.dir[1] === 0)
      .map((l) => ({
        bbox: l.bbox,
        text: l.chars
          .map((c) => c.c)
          .join('')
          .trim(),
        size: l.chars[0]?.size ?? 0,
      }))
      .filter((l) => l.text),
  );
  const mid = page.width / 2;
  const out: Rect[] = [];
  const free = (l: TextLine) => ![...taken, ...out].some((t) => coverage(l.bbox, t) > 0.3);
  for (const cap of lines.filter((l) => CAPTION.test(l.text))) {
    if (!free(cap)) continue;
    // The caption's page column.
    const wide =
      cap.bbox.x1 - cap.bbox.x0 > 0.55 * page.width ||
      (cap.bbox.x0 < mid - 20 && cap.bbox.x1 > mid + 20);
    const band: [number, number] = wide
      ? [0, page.width]
      : cap.bbox.x1 <= mid + 10
        ? [0, mid + 5]
        : [mid - 5, page.width];
    for (const dir of [1, -1]) {
      const rect = tableFromRows(lines, cap, dir, band, free, mid, wide);
      if (rect) {
        out.push(rect);
        break;
      }
    }
  }
  return out;
}

function tableFromRows(
  lines: TextLine[],
  cap: TextLine,
  dir: number,
  band: [number, number],
  free: (l: TextLine) => boolean,
  mid: number,
  wide: boolean,
): Rect | null {
  const inBand = lines.filter(
    (l) =>
      l !== cap &&
      l.bbox.x0 >= band[0] - 1 &&
      l.bbox.x1 <= band[1] + 1 &&
      (dir > 0 ? l.bbox.y0 >= cap.bbox.y1 - 1 : l.bbox.y1 <= cap.bbox.y0 + 1),
  );
  // Rows nearest the caption first.
  const centre = (l: TextLine) => (l.bbox.y0 + l.bbox.y1) / 2;
  const ys = cluster(inBand.map(centre), 3);
  if (dir < 0) ys.reverse();
  const bandWidth = band[1] - band[0];
  const rows: TextLine[][] = [];
  let prevEdge = dir > 0 ? cap.bbox.y1 : cap.bbox.y0;
  let skipped = 0;
  const heights: number[] = [];
  for (const y of ys) {
    const row = inBand
      .filter((l) => Math.abs(centre(l) - y) <= 3)
      .sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const top = Math.min(...row.map((l) => l.bbox.y0));
    const bottom = Math.max(...row.map((l) => l.bbox.y1));
    const h = Math.max(...row.map((l) => l.bbox.y1 - l.bbox.y0));
    const gap = dir > 0 ? top - prevEdge : prevEdge - bottom;
    const limit = rows.length ? Math.max(2.2 * h, 1.6 * (median(heights) || h)) : 2.5 * h + 8;
    if (gap > limit) break;
    if (!row.every(free)) break;
    if (row.some((l) => CAPTION.test(l.text))) break;
    const sizes = rows.flat().map((l) => l.size);
    if (sizes.length && row.some((l) => l.size > 1.2 * median(sizes))) break;
    // A paragraph line: one long line.
    if (
      row.length === 1 &&
      (row[0]!.text.length > 70 || row[0]!.bbox.x1 - row[0]!.bbox.x0 > 0.75 * bandWidth)
    ) {
      if (!rows.length && skipped < 2 && row[0]!.bbox.x0 - cap.bbox.x0 < 3) {
        // The caption's second line.
        skipped++;
        prevEdge = dir > 0 ? bottom : top;
        continue;
      }
      break;
    }
    // Lines of both columns of a two-column page: text, not a table.
    if (
      wide &&
      row.some((l) => l.bbox.x1 < mid - 3 && l.text.length > 35) &&
      row.some((l) => l.bbox.x0 > mid + 3 && l.text.length > 35)
    )
      break;
    rows.push(row);
    heights.push(h);
    prevEdge = dir > 0 ? bottom : top;
  }
  const multi = rows.filter((r) => r.length >= 2);
  if (rows.length < 3 || multi.length < Math.max(2, 0.5 * rows.length)) return null;
  // Columns repeat: some edge position (left, right or centre) is shared by 3 rows, at two
  // places at least 12 pt apart.
  const anchors: number[] = [];
  const edges = (l: TextLine) => [l.bbox.x0, l.bbox.x1, (l.bbox.x0 + l.bbox.x1) / 2];
  for (const kind of [0, 1, 2]) {
    const xs = cluster(
      rows.flatMap((r) => r.map((l) => edges(l)[kind]!)),
      3,
    );
    for (const x of xs) {
      const hits = rows.filter((r) => r.some((l) => Math.abs(edges(l)[kind]! - x) <= 3)).length;
      if (hits >= Math.max(3, 0.5 * rows.length) && !anchors.some((a) => Math.abs(a - x) < 12))
        anchors.push(x);
    }
  }
  if (anchors.length < 2) return null;
  const all = rows.flat();
  return {
    x0: Math.min(...all.map((l) => l.bbox.x0)),
    y0: Math.min(...all.map((l) => l.bbox.y0)),
    x1: Math.max(...all.map((l) => l.bbox.x1)),
    y1: Math.max(...all.map((l) => l.bbox.y1)),
  };
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
 * Ruled regions that touch side by side over the same rows are one table: column borders drawn
 * per column (a table drawn as one table per column, a header block next to the body) must not
 * come out as one-column strips.
 */
function joinBeside(regions: TableRegion[], pageIndex: number): TableRegion[] {
  const out = regions.map((r) => ({
    ...r,
    rect: { ...r.rect },
    rows: [...r.rows],
    cols: [...r.cols],
  }));
  const height = (r: Rect) => r.y1 - r.y0;
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length && !merged; j++) {
        const a = out[i]!;
        const b = out[j]!;
        const gap = Math.max(a.rect.x0, b.rect.x0) - Math.min(a.rect.x1, b.rect.x1);
        const shared = Math.min(a.rect.y1, b.rect.y1) - Math.max(a.rect.y0, b.rect.y0);
        if (gap > 6 || shared < 0.5 * Math.min(height(a.rect), height(b.rect))) continue;
        a.rect = {
          x0: Math.min(a.rect.x0, b.rect.x0),
          y0: Math.min(a.rect.y0, b.rect.y0),
          x1: Math.max(a.rect.x1, b.rect.x1),
          y1: Math.max(a.rect.y1, b.rect.y1),
        };
        a.rows = [...new Set([...a.rows, ...b.rows])].sort((p, q) => p - q);
        a.cols = [...a.cols, ...b.cols].sort((p, q) => p - q);
        out.splice(j, 1);
        merged = true;
      }
    }
  }
  return out.map((r, k) => ({ ...r, id: `p${pageIndex}-t${k}` }));
}

/**
 * Cell borders drawn cell by cell (Word, InDesign exports) arrive as one short rule per cell:
 * rules on the same line that touch or overlap are one rule.
 */
function stitchRules(rules: Rect[]): Rect[] {
  const sorted = [...rules].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: Rect[] = [];
  const used = new Set<number>();
  sorted.forEach((r, i) => {
    if (used.has(i)) return;
    const cur = { ...r };
    for (let j = i + 1; j < sorted.length; j++) {
      const s = sorted[j]!;
      if (s.y0 - cur.y0 > 1) break;
      if (used.has(j)) continue;
      if (
        Math.abs(s.y0 - cur.y0) < 0.6 &&
        Math.abs(s.y1 - cur.y1) < 0.6 &&
        s.x0 <= cur.x1 + 4 &&
        s.x1 >= cur.x0 - 4
      ) {
        cur.x0 = Math.min(cur.x0, s.x0);
        cur.x1 = Math.max(cur.x1, s.x1);
        used.add(j);
        j = i; // restart: a later segment may now touch
      }
    }
    out.push(cur);
  });
  return out;
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
