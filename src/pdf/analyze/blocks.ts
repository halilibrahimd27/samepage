import { iou, union, unionAll } from '../../core/ir/geometry';
import type { BlockIR, LineIR, Rect, SpanIR } from '../../core/ir/types';
import { coverage } from '../../core/ir/geometry';
import type { RawChar, RawFont, RawLine, RawPage, RawTextBlock } from '../extract/raw';
import type { TableRegion } from './tables';

/** TeX math fonts (Computer/Latin Modern, AMS, txfonts/pxfonts, newtx/newpx, MathTime) and OpenType math. */
const MATH_FONT =
  /^(CM(MI|SY|EX|BSY)|LMMath|MSAM|MSBM|Symbol|STIX.*Math|Cambria\s*Math|Euclid|rsfs|eufm|eus[mb]|stmary|bbm|dsrom|esint|mathabx|mathx|NewTXB?MI|NewPXB?MI|ntx(mi|sy|exx|sym)|r?(tx|px)(mi|sy|ex|ms)|zplm[rb]7[mty]|MT(MI|SY|EX)|.*Math)/i;
/** Mathematical Alphanumeric Symbols ("𝐻", "𝑛"): math whatever the font is called. */
const MATH_LETTER = /[\u{1d400}-\u{1d7ff}]/u;
const MONO_FONT =
  /(Mono|Courier|CMTT|LMMono|Consolas|Inconsolata|Menlo|Monaco|Typewriter|SFTT|TXTT|SourceCode|FiraCode|LucidaConsole|Cursor)/i;
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

/**
 * Letter-spaced text ("İ N Ö N Ü  Ü N İ V E R S İ T E S İ", "A R T I C L E  I N F O") arrives
 * as single letters between spaces, which no engine can translate. When most of a line is single
 * letters, the letters are joined and a space is kept only where the gap is clearly wider than
 * the letter spacing (a word boundary).
 */
export function collapseLetterSpacing(chars: RawChar[]): RawChar[] {
  const tokens = chars
    .map((c) => c.c)
    .join('')
    .split(/\s+/)
    .filter(Boolean);
  const singles = tokens.filter((t) => /^\p{L}$/u.test(t)).length;
  if (tokens.length < 5 || singles < 0.7 * tokens.length) return chars;
  const glyphs = chars.filter((c) => c.c.trim());
  const gaps = glyphs.slice(1).map((c, i) => c.bbox.x0 - glyphs[i]!.bbox.x1);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const size = glyphs[0]?.size ?? 10;
  const out: RawChar[] = [];
  glyphs.forEach((c, i) => {
    const prev = glyphs[i - 1];
    if (prev && gaps[i - 1]! > median + 0.3 * size) {
      const x = prev.bbox.x1;
      out.push({ ...prev, c: ' ', x, bbox: { ...prev.bbox, x0: x, x1: c.bbox.x0 } });
    }
    out.push(c);
  });
  return out;
}

function toLine(rawChars: RawChar[], page: RawPage): LineIR {
  const chars = collapseLetterSpacing(rawChars);
  const spans: SpanIR[] = [];
  let cur: RawChar[] = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0]!;
    const bbox = unionAll(cur.map((c) => c.bbox));
    const inked = cur.filter((c) => /\S/.test(c.c));
    const ink = inked.length ? inked : cur;
    const span: SpanIR = {
      // Some PDFs store accents as combining marks ("e" + U+0301): composed text reads as words.
      text: cur
        .map((c) => c.c)
        .join('')
        .normalize('NFC'),
      bbox,
      font: fontInfo(first.font, page.fonts[first.font]),
      size: first.size,
      color: first.color,
      // Of the inked characters: a space takes the height of the script before it.
      baseline: ink.reduce((sum, c) => sum + c.y, 0) / ink.length,
    };
    const letters = cur.filter((c) => /\p{L}/u.test(c.c));
    if (letters.length && letters.filter((c) => MATH_LETTER.test(c.c)).length * 2 >= letters.length)
      span.font = { ...span.font, isMath: true, italic: false };
    const uri = linkAt(bbox, page.links);
    if (uri) span.linkUri = uri;
    spans.push(span);
    cur = [];
  };
  for (const ch of chars) {
    const prev = cur[cur.length - 1];
    if (
      prev &&
      (!sameStyle(prev, ch) ||
        linkAt(prev.bbox, page.links) !== linkAt(ch.bbox, page.links) ||
        // A superscript and the subscript under it ("vᵁᵤ") are two scripts, not one.
        (/\S/.test(ch.c) && /\S/.test(prev.c) && Math.abs(ch.y - prev.y) > 0.4 * ch.size))
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

/**
 * Text printed twice at almost the same place (a shadow or an embossed heading: "Rapporti
 * Tecnici" in black, then in white half a point off) is one line, not two: the copy drawn last
 * is the one on top.
 */
function dropShadowLines(lines: RawLine[]): RawLine[] {
  const text = (l: RawLine) =>
    l.chars
      .map((c) => c.c)
      .join('')
      .trim();
  return lines.filter(
    (l, i) =>
      !text(l) ||
      !lines.some(
        (o, j) =>
          j > i &&
          text(o) === text(l) &&
          Math.abs(o.bbox.x0 - l.bbox.x0) < 1.5 &&
          Math.abs(o.bbox.y0 - l.bbox.y0) < 1.5,
      ),
  );
}

/** Lines on the same baseline with a small gap are one visual line (MuPDF splits at large gaps). */
function mergeBaselines(lines: RawLine[], gapLimit: number): RawLine[] {
  const out: RawLine[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    // The text's baseline, not the first character's: a piece may start with a subscript.
    if (
      prev &&
      line.dir[1] === 0 &&
      prev.dir[1] === 0 &&
      Math.abs(baselineOf(prev) - baselineOf(line)) < 1 &&
      line.bbox.x0 - prev.bbox.x1 < gapLimit &&
      line.bbox.x0 >= prev.bbox.x0
    ) {
      const space: RawChar = { ...prev.chars[prev.chars.length - 1]!, c: ' ' };
      // A script stacked under the one before it ("vᵁᵤ") is no new word.
      const apart = line.bbox.x0 > prev.bbox.x1;
      out[out.length - 1] = {
        ...prev,
        bbox: union(prev.bbox, line.bbox),
        chars: apart ? [...prev.chars, space, ...line.chars] : [...prev.chars, ...line.chars],
      };
    } else {
      out.push(line);
    }
  }
  return out;
}

const MARK_ONLY = /^[\d*†‡§¶]{1,3}$/u;
/** List items start a new paragraph: bullets and numbered items ("1. ", "(2) "). */
const BULLET = /^(?:[•◦▪▫‣●○■□➢✓]|\(?\d{1,2}[.)]\s)/u;

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
  fonts: RawPage['fonts'],
  layout: PageLayout,
): RawLine[][] {
  const textOf = (l: RawLine) => l.chars.map((c) => c.c).join('');
  const styled = (c: RawChar) => !!(fonts[c.font]?.bold || fonts[c.font]?.italic);
  /**
   * A run-in heading opens a new paragraph inside the block: after a sentence end, the line
   * starts with a bold or italic phrase that ends in "." or ":" and is followed by regular text
   * ("Test dataset. While …", "Has long string: The …").
   */
  const runIn = (line: RawLine, prev: RawLine) => {
    if (!/[.!?:]["”’)\]]*\s*$/u.test(textOf(prev))) return false;
    let k = 0;
    while (k < line.chars.length && (styled(line.chars[k]!) || /\s/u.test(line.chars[k]!.c))) k++;
    if (k === 0 || k >= line.chars.length) return false;
    const lead = textOf(line).slice(0, k).trim();
    return /\p{L}{2,}/u.test(lead) && (/[.:]$/u.test(lead) || /^[.:]/u.test(line.chars[k]!.c));
  };
  const groups: RawLine[][] = [];
  let cur: RawLine[] = [];
  const blockWidth = blockBox.x1 - blockBox.x0;
  // On a justified page every line but a paragraph's last reaches the text edge, so a short
  // line followed by one starting at the left edge is a forced break (closing lines of a
  // letter, an address) — measured against the page's text edge, not the block's own, unless
  // the block's lines end together: a column of a few lines, which the page-wide count of
  // line ends misses, has its own edge.
  const ownEdge = lines.filter((l) => blockBox.x1 - l.bbox.x1 < 1).length >= 2;
  const edge = ownEdge ? Math.min(layout.edgeFor(blockBox), blockBox.x1) : layout.edgeFor(blockBox);
  const reaches = (l: RawLine) => edge - l.bbox.x1 < 3;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const prev = lines[i - 1];
    if (prev && cur.length) {
      const size = dominantSize(line);
      const prevSize = dominantSize(prev);
      const step = baselineOf(line) - baselineOf(prev);
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
        (markOnly(line) && size < 0.8 * prevSize) ||
        BULLET.test(
          line.chars
            .map((c) => c.c)
            .join('')
            .trimStart(),
        );
      // Wider than the page's usual line spacing (theses are often one-and-a-half spaced) and
      // than the spacing around it (a double-spaced section on a page of tighter text).
      const next = lines[i + 1];
      const around = [
        lines[i - 2] ? baselineOf(prev) - baselineOf(lines[i - 2]!) : undefined,
        next ? baselineOf(next) - baselineOf(line) : undefined,
      ];
      const regular = around.some((g) => g !== undefined && Math.abs(g - step) < 0.15 * em);
      const bigGap =
        step > Math.max(1.75, layout.lineStepEm + 0.5) * em && !(regular && step < 3 * em);
      // Text on a coloured box and text outside it are different paragraphs.
      const backgroundChange = backgroundOf(line.bbox) !== backgroundOf(prev.bbox);
      if (
        sizeChange ||
        bigGap ||
        backgroundChange ||
        marked ||
        runIn(line, prev) ||
        (indented && prevShort) ||
        (layout.justified && !reaches(prev) && Math.abs(line.bbox.x0 - blockBox.x0) < 2)
      ) {
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
  // LaTeX's microtype lets hyphens and punctuation protrude into the margin: the right edge of
  // a justified paragraph varies by a couple of points.
  const tol = 3;
  const centre = (l: LineIR) => (l.bbox.x0 + l.bbox.x1) / 2;
  const mid = (box.x0 + box.x1) / 2;
  // A shorter last line centred under the others: a centred title, not a justified paragraph
  // (whose last line starts at the left edge).
  const last = lines[lines.length - 1]!;
  if (Math.abs(centre(last) - mid) < 3 && last.bbox.x0 - box.x0 > 4) return 'center';
  const body = lines.slice(0, -1);
  const fullRight = body.filter((l) => box.x1 - l.bbox.x1 < tol).length / body.length;
  const fullLeft = body.filter((l) => l.bbox.x0 - box.x0 < 12).length / body.length;
  if (fullRight > 0.8 && fullLeft > 0.6) return 'justify';
  // Centred lines have different lengths; lines that all fill the width are not "centred".
  if (
    lines.every((l) => Math.abs(centre(l) - mid) < 3) &&
    lines.some((l) => l.bbox.x0 - box.x0 > 4)
  )
    return 'center';
  if (lines.every((l) => box.x1 - l.bbox.x1 < tol)) return 'right';
  return 'left';
}

/**
 * MuPDF sometimes ends a block with the first part of a line and starts the next block with the
 * rest ("Has invalid or no homepage (repository):" | "Previous work showed that"): the run-in
 * heading belongs to the paragraph it introduces, so the trailing line moves to the next block.
 */
function rejoinSplitLines(blocks: RawTextBlock[]): RawTextBlock[] {
  const out = blocks.map((b) => ({ ...b, lines: [...b.lines] }));
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i]!;
    const b = out[i + 1]!;
    // A line with sub- and superscripts can come in several pieces, one per block ("be Pᵀvᵁ" |
    // "ᵤ and item latent vector qᵢ be Qᵀvᴵ" | "ᵢ. We define the"): all of it moves on.
    for (;;) {
      const last = a.lines[a.lines.length - 1];
      const first = b.lines[0];
      if (!last || !first || last.dir[1] !== 0) break;
      if (a.lines.length < 2 && !b.lines.slice(1).length) break;
      const size = Math.max(...last.chars.map((c) => c.size), 1);
      const sameBaseline = Math.abs(baselineOf(last) - baselineOf(first)) < 0.5;
      const gap = first.bbox.x0 - last.bbox.x1;
      // A script stacked under the one before it ("vᵁᵤ") starts left of where that one ends.
      const script = (first.chars.find((c) => c.c.trim())?.size ?? size) < 0.8 * size;
      if (!sameBaseline || gap < (script ? -0.8 * size : -1) || gap > 3 * size) break;
      a.lines.pop();
      if (a.lines.length) a.bbox = unionAll(a.lines.map((l) => l.bbox));
      b.lines.unshift(last);
      b.bbox = union(b.bbox, last.bbox);
    }
  }
  return out.filter((b) => b.lines.length);
}

interface PageLayout {
  /** Most lines end at a common text edge (justified setting). */
  justified: boolean;
  /**
   * Usual baseline-to-baseline distance of running text, in em (≈ 1.2 single-spaced, ≈ 1.8 in
   * a one-and-a-half-spaced thesis). Paragraph gaps are measured against it.
   */
  lineStepEm: number;
  /** The text edge a block's lines run to (a column's right margin). */
  edgeFor: (block: Rect) => number;
}

/** Right text edges of the page: x positions where many long lines end. */
function pageLayout(page: RawPage): PageLayout {
  const ends = page.blocks
    .flatMap((b) => b.lines)
    .filter((l) => l.chars.length > 20)
    .map((l) => l.bbox.x1)
    .sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const x of ends) {
    const g = groups[groups.length - 1];
    if (g && x - g[g.length - 1]! <= 3) g.push(x);
    else groups.push([x]);
  }
  const edges = groups
    .filter((g) => g.length >= Math.max(3, 0.15 * ends.length))
    .map((g) => Math.max(...g));
  const onEdge = groups.filter((g) => edges.includes(Math.max(...g))).flat().length;
  return {
    justified: ends.length >= 6 && onEdge >= 0.5 * ends.length,
    edgeFor: (r) => edges.find((e) => e >= r.x1 - 3) ?? r.x1,
    lineStepEm: usualLineStep(page),
  };
}

/** Baseline of a raw line: the median of its glyph origins. */
function baselineOf(line: RawLine): number {
  const ys = line.chars
    .filter((c) => c.c.trim())
    .map((c) => c.y)
    .sort((a, b) => a - b);
  return ys.length ? ys[Math.floor(ys.length / 2)]! : line.bbox.y1;
}

/**
 * Median distance (in em) between the baselines of each long line and the next long line below
 * it in its column. Baselines, not line boxes: some fonts give boxes that overlap.
 */
function usualLineStep(page: RawPage): number {
  const lines = page.blocks
    .flatMap((b) => b.lines)
    .filter((l) => l.chars.length > 20 && l.dir[1] === 0)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const steps: number[] = [];
  lines.forEach((line, i) => {
    const size = dominantSize(line);
    const width = line.bbox.x1 - line.bbox.x0;
    const base = baselineOf(line);
    const next = lines.slice(i + 1).find((n) => {
      const overlap = Math.min(n.bbox.x1, line.bbox.x1) - Math.max(n.bbox.x0, line.bbox.x0);
      return baselineOf(n) > base + 0.5 * size && overlap > 0.5 * width;
    });
    if (!next || Math.abs(dominantSize(next) - size) > 0.5 || size <= 0) return;
    const step = (baselineOf(next) - base) / size;
    if (step > 0.8 && step < 3.5) steps.push(step);
  });
  if (steps.length < 4) return 1.2;
  steps.sort((a, b) => a - b);
  return steps[Math.floor(steps.length / 2)]!;
}

/**
 * Marks spans with a thin rule right under their baseline as underlined and returns those rules
 * (a full-width rule under a short heading is a separator, not an underline).
 */
function markUnderlines(lines: LineIR[], rules: Rect[]): Rect[] {
  const found: Rect[] = [];
  for (const line of lines) {
    const size = Math.max(...line.spans.map((sp) => sp.size));
    for (const rule of rules) {
      if (rule.y0 < line.baseline - 0.5 || rule.y0 > line.baseline + 0.4 * size) continue;
      const under = line.spans.filter((sp) => {
        const w = sp.bbox.x1 - sp.bbox.x0;
        const overlap = Math.min(rule.x1, sp.bbox.x1) - Math.max(rule.x0, sp.bbox.x0);
        return !sp.font.isMath && sp.text.trim() && w > 0 && overlap >= 0.7 * w;
      });
      if (!under.length) continue;
      const extent =
        Math.max(...under.map((sp) => sp.bbox.x1)) - Math.min(...under.map((sp) => sp.bbox.x0));
      if (rule.x1 - rule.x0 > extent + 2 * size) continue;
      for (const sp of under) sp.underline = true;
      found.push(rule);
    }
  }
  return found;
}

/**
 * Raw MuPDF page → paragraph blocks (roles, order and chains are added by later passes).
 * Inside table regions every MuPDF line is its own block (one cell), never merged.
 */
export function buildBlocks(page: RawPage, tables: TableRegion[] = []): BlockIR[] {
  const blocks: BlockIR[] = [];
  const cells = new Set<BlockIR>();
  const inTable = (r: Rect) => tables.some((t) => coverage(r, t.rect) > 0.6);
  // Filled rectangles behind text (coloured boxes, shaded cells): index of the one under a line.
  const fills = page.vectors
    .filter((v) => v.isRectangle && !v.isStroked && v.bbox.y1 - v.bbox.y0 > 4)
    .map((v) => v.bbox);
  const backgroundOf = (r: Rect) => fills.findIndex((f) => coverage(r, f) > 0.8);
  const layout = pageLayout(page);
  const rules = page.vectors
    .filter((v) => v.bbox.y1 - v.bbox.y0 < 1.5 && v.bbox.x1 - v.bbox.x0 > 3)
    .map((v) => v.bbox);
  const cuts = cutAtColumns(page, tables);
  for (const raw of rejoinSplitLines(page.blocks)) {
    const sizes = raw.lines.map(dominantSize);
    const em = sizes.length ? Math.max(...sizes) : 10;
    const cellLines = raw.lines.filter((l) => inTable(l.bbox)).flatMap((l) => cuts.get(l) ?? [l]);
    const flowLines = raw.lines.filter((l) => !inTable(l.bbox));
    const groups = [
      ...cellLines.map((l) => [l]),
      ...(flowLines.length
        ? splitParagraphs(
            mergeBaselines(dropShadowLines(flowLines), 3 * em),
            raw.bbox,
            backgroundOf,
            page.fonts,
            layout,
          )
        : []),
    ];
    const pieces: { lines: LineIR[]; dir: [number, number] }[] = [];
    for (const group of groups) {
      // A line of nothing but spaces (a stray space at a figure's edge) has no text to place, but
      // its position would become the first line's indent: the translation found no room there.
      const lines = group
        .map((l) => toLine(l.chars, page))
        .filter((l) => l.spans.some((sp) => /\S/.test(sp.text)));
      if (!lines.length) continue;
      // The tail of a display formula above (a closing delimiter, "= 1.53.", "(cf.") is not the
      // first line of the paragraph below it: lines far right of the first line that starts at
      // the paragraph's left edge, with at most two words in a text font, are split off.
      const width = unionAll(lines.map((l) => l.bbox));
      const span = width.x1 - width.x0;
      const words = (l: LineIR) =>
        l.spans
          .filter((sp) => !sp.font.isMath)
          .map((sp) => sp.text)
          .join(' ')
          .match(/\p{L}{2,}/gu)?.length ?? 0;
      const anchor = lines.findIndex((l) => l.bbox.x0 <= width.x0 + 0.25 * span && words(l) > 0);
      const k =
        anchor > 0 &&
        lines
          .slice(0, anchor)
          .every((l) => l.bbox.x0 > lines[anchor]!.bbox.x0 + 0.3 * span && words(l) <= 2)
          ? anchor
          : 0;
      if (k) pieces.push({ lines: lines.slice(0, k), dir: group[0]!.dir });
      pieces.push({ lines: lines.slice(k), dir: group[0]!.dir });
    }
    for (const { lines, dir } of pieces) {
      const bbox = unionAll(lines.map((l) => l.bbox));
      const underlines = inTable(bbox) ? [] : markUnderlines(lines, rules);
      const block: BlockIR = {
        ...(underlines.length ? { underlines } : {}),
        id: `p${page.index}-b${blocks.length}`,
        bbox,
        role: 'unknown',
        translatable: true,
        lines,
        align: alignment(lines, bbox),
        direction: dir,
        columnIndex: 0,
        readingOrder: 0,
      };
      if (inTable(bbox)) cells.add(block);
      blocks.push(block);
    }
  }
  return dropDuplicates(mergeSplitParagraphs(blocks, layout, cells));
}

/**
 * Cells set close together come out of the PDF as one line ("Malware Checks [35] setup.py
 * file"): such a line is cut before a word that starts where two other lines of the table
 * start (a column's left edge), and after a word that ends where two others end (a right-aligned
 * column's edge).
 */
function cutAtColumns(page: RawPage, tables: TableRegion[]): Map<RawLine, RawLine[]> {
  const cuts = new Map<RawLine, RawLine[]>();
  const words = (l: RawLine) => {
    const out: RawChar[][] = [];
    let cur: RawChar[] = [];
    for (const c of l.chars) {
      if (/\s/.test(c.c)) {
        if (cur.length) out.push(cur);
        cur = [];
      } else cur.push(c);
    }
    if (cur.length) out.push(cur);
    return out;
  };
  for (const t of tables) {
    const lines = page.blocks
      .flatMap((b) => b.lines)
      .filter((l) => l.dir[1] === 0 && coverage(l.bbox, t.rect) > 0.6)
      .map((l) => ({ l, words: words(l) }))
      .filter((x) => x.words.length);
    const start = (o: (typeof lines)[number]) => o.words[0]![0]!.bbox.x0;
    const end = (o: (typeof lines)[number]) => o.words.at(-1)!.at(-1)!.bbox.x1;
    const edge = (x: (typeof lines)[number], at: number, side: 'x0' | 'x1') => {
      const along = lines.filter(
        (o) => o !== x && Math.abs((side === 'x0' ? start(o) : end(o)) - at) < 1.5,
      );
      // Lines that end together but also start together ("package" under "package") are a
      // left-aligned column, no right edge.
      return (
        along.length >= 2 &&
        (side === 'x0' || Math.max(...along.map(start)) - Math.min(...along.map(start)) > 1.5)
      );
    };
    for (const x of lines) {
      const pieces: RawChar[][][] = [[x.words[0]!]];
      for (let i = 1; i < x.words.length; i++) {
        const w = x.words[i]!;
        const before = x.words[i - 1]!;
        // Cells are set apart by more than a word space (a note under the table is not cut).
        const apart = w[0]!.bbox.x0 - before.at(-1)!.bbox.x1 >= 0.45 * w[0]!.size;
        if (apart && (edge(x, w[0]!.bbox.x0, 'x0') || edge(x, before.at(-1)!.bbox.x1, 'x1')))
          pieces.push([w]);
        else pieces.at(-1)!.push(w);
      }
      if (pieces.length < 2) continue;
      cuts.set(
        x.l,
        pieces.map((ws) => {
          const first = ws[0]![0]!;
          const last = ws.at(-1)!.at(-1)!;
          const chars = x.l.chars.slice(x.l.chars.indexOf(first), x.l.chars.indexOf(last) + 1);
          return { ...x.l, bbox: unionAll(chars.map((c) => c.bbox)), chars };
        }),
      );
    }
  }
  return cuts;
}

/**
 * The same text drawn twice at the same place (a fake bold, a shadow) is one block: translated
 * once and redacted once (the redaction removes both copies).
 */
function dropDuplicates(blocks: BlockIR[]): BlockIR[] {
  const out: BlockIR[] = [];
  for (const b of blocks) {
    const text = blockText(b);
    const twin = out.find((o) => blockText(o) === text && iou(o.bbox, b.bbox) > 0.7);
    if (!twin) out.push(b);
  }
  return out.map((b, i) => ({ ...b, id: b.id.replace(/-b\d+$/, `-b${i}`) }));
}

/**
 * MuPDF sometimes ends a block in the middle of a paragraph. Adjacent blocks are merged when the
 * first ends mid-sentence, with normal line spacing and the same font size, and the second
 * either starts in lower case at the same left edge without a paragraph indent, or continues a
 * centred heading (same centre, same font: "A Machine Learning-Based Approach For Detecting
 * Malicious" + "PyPI Packages" is one title and must be translated as one).
 */
/** The span with the most characters (not a leading paragraph number or mark). */
const mainSpan = (line: LineIR) =>
  line.spans.reduce((best, sp) => (sp.text.length > best.text.length ? sp : best), line.spans[0]!);

function mergeSplitParagraphs(
  blocks: BlockIR[],
  layout: PageLayout,
  cells: Set<BlockIR>,
): BlockIR[] {
  const out: BlockIR[] = [];
  const stepOf = (x: LineIR, y: LineIR) => y.baseline - x.baseline;
  blocks.forEach((b, k) => {
    const a = out[out.length - 1];
    if (a) {
      const aLast = a.lines[a.lines.length - 1]!;
      const bFirst = b.lines[0]!;
      const size = mainSpan(bFirst).size;
      const aText = aLast.spans
        .map((s) => s.text)
        .join('')
        .trim();
      const bText = bFirst.spans
        .map((s) => s.text)
        .join('')
        .trim();
      const step = stepOf(aLast, bFirst);
      // Spacing like that of the lines around it: one paragraph, however wide the spacing.
      const nextBlock = blocks[k + 1];
      const around = [
        a.lines.length > 1 ? stepOf(a.lines[a.lines.length - 2]!, aLast) : undefined,
        b.lines.length > 1
          ? stepOf(bFirst, b.lines[1]!)
          : nextBlock
            ? stepOf(bFirst, nextBlock.lines[0]!)
            : undefined,
      ];
      const regular = around.some((g) => g !== undefined && Math.abs(g - step) < 0.15 * size);
      const centre = (r: Rect) => (r.x0 + r.x1) / 2;
      const fontA = mainSpan(aLast).font;
      const fontB = mainSpan(bFirst).font;
      // A paragraph number hanging in the margin ("6 Dit patroon …") puts the first line's start
      // left of the text: the next lines start up to a few ems further right.
      const aFirstText = a.lines[0]!.spans.map((sp) => sp.text).join('');
      const hanging = /^\s*\d{1,3}[.)]?\s+\S/u.test(aFirstText) ? 3 * size : 0;
      const leftOk =
        bFirst.bbox.x0 <= a.bbox.x0 + 2 + hanging && bFirst.bbox.x0 >= a.bbox.x0 - 3 * size;
      const continuesLeft = /^\p{Ll}/u.test(bText) && leftOk;
      // On a justified page a line that runs to the text edge does not end its paragraph, even
      // when the next line starts with a capital ("We can use Network" | "Property Chains to").
      // Not in tables: a number column may end at the text edge.
      const continuesFull =
        !cells.has(a) &&
        !cells.has(b) &&
        layout.justified &&
        // Justified lines end a few points apart (tracking, a hanging comma).
        layout.edgeFor(a.bbox) - aLast.bbox.x1 < Math.max(3, 0.6 * size) &&
        leftOk &&
        fontA.name === fontB.name;
      const continuesCentred =
        Math.abs(centre(aLast.bbox) - centre(bFirst.bbox)) < 3 &&
        // Lines of different lengths around one centre (a stacked masthead, a centred title).
        Math.max(
          Math.abs(aLast.bbox.x0 - bFirst.bbox.x0),
          Math.abs(aLast.bbox.x1 - bFirst.bbox.x1),
        ) > 3 &&
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
        (continuesLeft || continuesFull || continuesCentred) &&
        step > 0.5 * size &&
        (step < Math.max(1.6, layout.lineStepEm + 0.3) * size || (regular && step < 3 * size)) &&
        // Small caps mix sizes within a line: a relative tolerance.
        Math.abs(mainSpan(aLast).size - size) < Math.max(0.3, 0.08 * size)
      ) {
        const lines = [...a.lines, ...b.lines];
        const bbox = union(a.bbox, b.bbox);
        out[out.length - 1] = { ...a, lines, bbox, align: alignment(lines, bbox) };
        return;
      }
    }
    out.push(b);
  });
  return out.map((b, i) => ({ ...b, id: b.id.replace(/-b\d+$/, `-b${i}`) }));
}

/**
 * Plain text of a block; hyphenated line ends are joined ("ge-" + "lişme" → "gelişme"), or as
 * `hyphen` decides (the document's own spelling: "self-" + "attention").
 */
export function blockText(
  block: BlockIR,
  hyphen: (text: string, next: string) => string = (text) => text.slice(0, -1),
): string {
  let out = '';
  block.lines.forEach((line, i) => {
    const text = line.spans.map((s) => s.text).join('');
    if (i > 0) {
      // Hyphenation is dropped ("ge-" + "lişme", a soft hyphen "Defini\u00AD" + "tion"); a
      // word's own hyphen stays ("Von-Neumann").
      if (/\u00AD$/u.test(out)) out = out.slice(0, -1);
      else if (/[\p{L}]-$/u.test(out) && /^\p{Ll}/u.test(text)) out = hyphen(out, text);
      else if (!out.endsWith(' ') && !(/[\p{L}]-$/u.test(out) && /^[\p{Lu}\d]/u.test(text)))
        out += ' ';
    }
    out += text;
  });
  return out.replace(/\s+/g, ' ').trim();
}
