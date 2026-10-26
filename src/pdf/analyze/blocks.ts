import { union, unionAll } from '../../core/ir/geometry';
import type { BlockIR, LineIR, Rect, SpanIR } from '../../core/ir/types';
import { coverage } from '../../core/ir/geometry';
import type { RawChar, RawFont, RawLine, RawPage } from '../extract/raw';
import type { TableRegion } from './tables';

const MATH_FONT =
  /^(CM(MI|SY|EX|BSY)|LMMath|MSAM|MSBM|Symbol|STIX.*Math|Cambria\s*Math|Euclid|rsfs|eufm|.*Math)/i;
const MONO_FONT = /(Mono|Courier|CMTT|LMMono|Consolas|Menlo|Typewriter)/i;
const SANS_FONT = /(Sans|Arial|Helvetica|CMSS|LMSans|Calibri|Verdana|Segoe|Roboto)/i;
const BOLD_FONT = /(Bold|Black|Heavy|Semibold|Demi|CMBX|-Bd|BX\d)/i;
const ITALIC_FONT = /(Italic|Oblique|CMTI|CMSL|Slanted|-It)/i;

export function fontInfo(name: string, flags?: RawFont): SpanIR['font'] {
  const isMath = MATH_FONT.test(name);
  return {
    name,
    family: MONO_FONT.test(name) || flags?.mono ? 'mono' : SANS_FONT.test(name) ? 'sans' : 'serif',
    bold: BOLD_FONT.test(name) || !!flags?.bold,
    italic: (!isMath && ITALIC_FONT.test(name)) || (!isMath && !!flags?.italic),
    isMath,
  };
}

const sameStyle = (a: RawChar, b: RawChar) =>
  a.font === b.font &&
  Math.abs(a.size - b.size) < 0.05 &&
  a.color.every((v, i) => Math.abs(v - b.color[i]!) < 0.02);

function linkAt(r: Rect, links: RawPage['links']): string | undefined {
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  return links.find((l) => cx >= l.bbox.x0 && cx <= l.bbox.x1 && cy >= l.bbox.y0 && cy <= l.bbox.y1)
    ?.uri;
}

function toLine(chars: RawChar[], page: RawPage): LineIR {
  const spans: SpanIR[] = [];
  let cur: RawChar[] = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0]!;
    const bbox = unionAll(cur.map((c) => c.bbox));
    const span: SpanIR = {
      text: cur.map((c) => c.c).join(''),
      bbox,
      font: fontInfo(first.font, page.fonts[first.font]),
      size: first.size,
      color: first.color,
      baseline: cur.reduce((sum, c) => sum + c.y, 0) / cur.length,
    };
    const uri = linkAt(bbox, page.links);
    if (uri) span.linkUri = uri;
    spans.push(span);
    cur = [];
  };
  for (const ch of chars) {
    const prev = cur[cur.length - 1];
    if (
      prev &&
      (!sameStyle(prev, ch) || linkAt(prev.bbox, page.links) !== linkAt(ch.bbox, page.links))
    )
      flush();
    cur.push(ch);
  }
  flush();
  // The line's baseline is that of its longest regular (non-math) span, so sub/superscripts and
  // math do not pull it up or down.
  const main = [...spans].sort(
    (a, b) => Number(a.font.isMath) - Number(b.font.isMath) || b.text.length - a.text.length,
  )[0];
  const baseline =
    main?.baseline ?? (chars.length ? chars.reduce((s, c) => s + c.y, 0) / chars.length : 0);
  return { bbox: unionAll(spans.map((s) => s.bbox)), baseline, spans };
}

/** Lines on the same baseline with a small gap are one visual line (MuPDF splits at large gaps). */
function mergeBaselines(lines: RawLine[], gapLimit: number): RawLine[] {
  const out: RawLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const by = (l: RawLine) => l.chars[0]!.y;
    if (
      prev &&
      line.dir[1] === 0 &&
      prev.dir[1] === 0 &&
      Math.abs(by(prev) - by(line)) < 1 &&
      line.bbox.x0 - prev.bbox.x1 < gapLimit &&
      line.bbox.x0 >= prev.bbox.x0
    ) {
      const space: RawChar = { ...prev.chars[prev.chars.length - 1]!, c: ' ' };
      out[out.length - 1] = {
        ...prev,
        bbox: union(prev.bbox, line.bbox),
        chars: [...prev.chars, space, ...line.chars],
      };
    } else {
      out.push(line);
    }
  }
  return out;
}

const MARK_ONLY = /^[\d*†‡§¶]{1,3}$/u;

const dominantSize = (line: RawLine) => {
  const counts = new Map<number, number>();
  for (const c of line.chars) counts.set(c.size, (counts.get(c.size) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};

/**
 * Splits a MuPDF block into paragraphs: a new paragraph starts after a short last line followed
 * by an indented line, after a clear vertical gap, or when the font size changes.
 */
function splitParagraphs(
  lines: RawLine[],
  blockBox: Rect,
  backgroundOf: (r: Rect) => number,
): RawLine[][] {
  const groups: RawLine[][] = [];
  let cur: RawLine[] = [];
  const blockWidth = blockBox.x1 - blockBox.x0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const prev = lines[i - 1];
    if (prev && cur.length) {
      const size = dominantSize(line);
      const prevSize = dominantSize(prev);
      const lineGap = line.bbox.y0 - prev.bbox.y1;
      const em = Math.max(size, 1);
      const indented = line.bbox.x0 - blockBox.x0 > 0.6 * em && line.bbox.x0 - blockBox.x0 < 4 * em;
      const prevShort = blockBox.x1 - prev.bbox.x1 > 0.08 * blockWidth;
      // A line that starts with a superscript mark is a new item (affiliations, footnotes). The
      // mark may come as a line of its own (raised baseline); the text after it stays with it.
      const markOnly = (l: RawLine) =>
        MARK_ONLY.test(
          l.chars
            .map((c) => c.c)
            .join('')
            .trim(),
        );
      const prevIsMark = markOnly(prev) && prevSize < 0.8 * size;
      const sizeChange = Math.abs(size - prevSize) > 0.5 && !prevIsMark;
      const lead = /^[\d*†‡§¶]{1,3}/u.exec(line.chars.map((c) => c.c).join(''))?.[0] ?? '';
      const marked =
        (lead.length > 0 && line.chars.slice(0, lead.length).every((c) => c.size < 0.8 * size)) ||
        (markOnly(line) && size < 0.8 * prevSize);
      const bigGap = lineGap > 0.8 * em;
      // Text on a coloured box and text outside it are different paragraphs.
      const backgroundChange = backgroundOf(line.bbox) !== backgroundOf(prev.bbox);
      if (sizeChange || bigGap || backgroundChange || marked || (indented && prevShort)) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(line);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

function alignment(lines: LineIR[], box: Rect): BlockIR['align'] {
  if (lines.length < 2) {
    const l = lines[0]!;
    const leftGap = l.bbox.x0 - box.x0;
    const rightGap = box.x1 - l.bbox.x1;
    return Math.abs(leftGap - rightGap) < 2 && leftGap > 2 ? 'center' : 'left';
  }
  const tol = 1.5;
  const centre = (l: LineIR) => (l.bbox.x0 + l.bbox.x1) / 2;
  const mid = (box.x0 + box.x1) / 2;
  // A shorter last line centred under the others: a centred title, not a justified paragraph
  // (whose last line starts at the left edge).
  const last = lines[lines.length - 1]!;
  if (Math.abs(centre(last) - mid) < 3 && last.bbox.x0 - box.x0 > 4) return 'center';
  const body = lines.slice(0, -1);
  const fullRight = body.filter((l) => box.x1 - l.bbox.x1 < tol).length / body.length;
  const fullLeft = body.filter((l) => l.bbox.x0 - box.x0 < tol * 8).length / body.length;
  if (fullRight > 0.8 && fullLeft > 0.6) return 'justify';
  if (lines.every((l) => Math.abs(centre(l) - mid) < 3)) return 'center';
  if (lines.every((l) => box.x1 - l.bbox.x1 < tol)) return 'right';
  return 'left';
}

/**
 * Raw MuPDF page → paragraph blocks (roles, order and chains are added by later passes).
 * Inside table regions every MuPDF line is its own block (one cell), never merged.
 */
export function buildBlocks(page: RawPage, tables: TableRegion[] = []): BlockIR[] {
  const blocks: BlockIR[] = [];
  const inTable = (r: Rect) => tables.some((t) => coverage(r, t.rect) > 0.6);
  // Filled rectangles behind text (coloured boxes, shaded cells): index of the one under a line.
  const fills = page.vectors
    .filter((v) => v.isRectangle && !v.isStroked && v.bbox.y1 - v.bbox.y0 > 4)
    .map((v) => v.bbox);
  const backgroundOf = (r: Rect) => fills.findIndex((f) => coverage(r, f) > 0.8);
  for (const raw of page.blocks) {
    const sizes = raw.lines.map(dominantSize);
    const em = sizes.length ? Math.max(...sizes) : 10;
    const cellLines = raw.lines.filter((l) => inTable(l.bbox));
    const flowLines = raw.lines.filter((l) => !inTable(l.bbox));
    const groups = [
      ...cellLines.map((l) => [l]),
      ...(flowLines.length
        ? splitParagraphs(mergeBaselines(flowLines, 3 * em), raw.bbox, backgroundOf)
        : []),
    ];
    for (const group of groups) {
      const lines = group.map((l) => toLine(l.chars, page)).filter((l) => l.spans.length);
      if (!lines.length) continue;
      const bbox = unionAll(lines.map((l) => l.bbox));
      blocks.push({
        id: `p${page.index}-b${blocks.length}`,
        bbox,
        role: 'unknown',
        translatable: true,
        lines,
        align: alignment(lines, bbox),
        direction: group[0]!.dir,
        columnIndex: 0,
        readingOrder: 0,
      });
    }
  }
  return mergeSplitParagraphs(blocks);
}

/**
 * MuPDF sometimes ends a block in the middle of a paragraph. Adjacent blocks are merged when the
 * first ends mid-sentence, with normal line spacing and the same font size, and the second
 * either starts in lower case at the same left edge without a paragraph indent, or continues a
 * centred heading (same centre, same font: "A Machine Learning-Based Approach For Detecting
 * Malicious" + "PyPI Packages" is one title and must be translated as one).
 */
function mergeSplitParagraphs(blocks: BlockIR[]): BlockIR[] {
  const out: BlockIR[] = [];
  for (const b of blocks) {
    const a = out[out.length - 1];
    if (a) {
      const aLast = a.lines[a.lines.length - 1]!;
      const bFirst = b.lines[0]!;
      const size = bFirst.spans[0]!.size;
      const aText = aLast.spans
        .map((s) => s.text)
        .join('')
        .trim();
      const bText = bFirst.spans
        .map((s) => s.text)
        .join('')
        .trim();
      const gap = bFirst.bbox.y0 - aLast.bbox.y1;
      const centre = (r: Rect) => (r.x0 + r.x1) / 2;
      const fontA = aLast.spans[0]!.font;
      const fontB = bFirst.spans[0]!.font;
      const continuesLeft =
        /^\p{Ll}/u.test(bText) &&
        bFirst.bbox.x0 <= a.bbox.x0 + 2 &&
        bFirst.bbox.x0 >= a.bbox.x0 - 3 * size;
      const continuesCentred =
        Math.abs(centre(aLast.bbox) - centre(bFirst.bbox)) < 3 &&
        Math.abs(aLast.bbox.x0 - bFirst.bbox.x0) > 6 &&
        fontA.name === fontB.name &&
        fontA.bold === fontB.bold;
      // A block that opens with a superscript mark is a new item (the next affiliation).
      const lead = bFirst.spans[0]!;
      const opensWithMark =
        MARK_ONLY.test(lead.text.trim()) &&
        lead.size < 0.8 * Math.max(...bFirst.spans.map((x) => x.size));
      if (
        !/[.!?…:]["”»’)\]]*$/.test(aText) &&
        !opensWithMark &&
        (continuesLeft || continuesCentred) &&
        gap >= -1 &&
        gap < 0.6 * size &&
        Math.abs(aLast.spans[0]!.size - size) < 0.3
      ) {
        const lines = [...a.lines, ...b.lines];
        const bbox = union(a.bbox, b.bbox);
        out[out.length - 1] = { ...a, lines, bbox, align: alignment(lines, bbox) };
        continue;
      }
    }
    out.push(b);
  }
  return out.map((b, i) => ({ ...b, id: b.id.replace(/-b\d+$/, `-b${i}`) }));
}

/** Plain text of a block; hyphenated line ends are joined ("ge-" + "lişme" → "gelişme"). */
export function blockText(block: BlockIR): string {
  let out = '';
  block.lines.forEach((line, i) => {
    const text = line.spans.map((s) => s.text).join('');
    if (i > 0) {
      if (/[\p{L}]-$/u.test(out) && /^\p{Ll}/u.test(text)) out = out.slice(0, -1);
      else if (!out.endsWith(' ')) out += ' ';
    }
    out += text;
  });
  return out.replace(/\s+/g, ' ').trim();
}
