import { expand, iou, union, unionAll, xOverlap } from '../../core/ir/geometry';
import type { BlockIR, LineIR, Rect, SpanIR } from '../../core/ir/types';
import { coverage } from '../../core/ir/geometry';
import type { Chip, RawChar, RawFont, RawLine, RawPage, RawTextBlock } from '../extract/raw';
import { fromPicture } from '../ocr/page';
import type { TableRegion } from './tables';

/** TeX math fonts (Computer/Latin Modern, AMS, txfonts/pxfonts, newtx/newpx, MathTime) and OpenType math. */
const MATH_FONT =
  /^(CM(MI|SY|EX|BSY)|LMMath|MSAM|MSBM|Symbol|STIX.*Math|Cambria\s*Math|Euclid|rsfs|eufm|eus[mb]|stmary|bbm|dsrom|esint|mathabx|mathx|NewTXB?MI|NewPXB?MI|ntx(mi|sy|exx|sym)|r?(tx|px)(mi|sy|ex|ms)|zplm[rb]7[mty]|MT(MI|SY|EX)|.*Math)/i;
/** Mathematical Alphanumeric Symbols ("𝐻", "𝑛"): math whatever the font is called. */
const MATH_LETTER = /[\u{1d400}-\u{1d7ff}]/u;
const MONO_FONT =
  /(Mono|Courier|CMTT|LMMono|Consolas|Inconsolata|Menlo|Monaco|Typewriter|SFTT|TXTT|SourceCode|FiraCode|LucidaConsole|Cursor)/i;
const SANS_FONT =
  /(Sans|Arial|Helvetica|CMSS|LMSans|Calibri|Verdana|Segoe|Roboto|Poppins|Inter(?![a-z])|Montserrat|Lato|Ubuntu|Raleway|Nunito|Myriad|Frutiger|Futura|Gill|Tahoma|Trebuchet|Avenir|Proxima|Univers|Optima|Candara|Corbel|Franklin|Gothic|Grotesk|Grotesque|Bungee|Oswald|Rubik|Manrope|Mulish|Karla|Barlow|Josefin|Quicksand|Cabin|Titillium|Heebo|Sora|Outfit|Jakarta|Archivo|Overpass|Asap|Arimo|Carlito|Aptos|Lexend|Figtree|Geist|Impact)/i;
// Display faces are heavy whatever their name says ("Bungee-Regular").
const BOLD_FONT = /(Bold|Black|Heavy|Semibold|Demi|CMBX|-Bd|BX\d|Bungee|Impact)/i;
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
  a.chip === b.chip &&
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

/** Spacing accents a font without "ż", "č", "ą" draws over or under the bare letter. */
const COMBINING: Record<string, { mark: string; above: boolean }> = {
  '.': { mark: '\u0307', above: true },
  '˙': { mark: '\u0307', above: true },
  '´': { mark: '\u0301', above: true },
  '`': { mark: '\u0300', above: true },
  ˇ: { mark: '\u030C', above: true },
  '¨': { mark: '\u0308', above: true },
  '˚': { mark: '\u030A', above: true },
  '˝': { mark: '\u030B', above: true },
  '˛': { mark: '\u0328', above: false },
  '¸': { mark: '\u0327', above: false },
  ˆ: { mark: '\u0302', above: true },
  '˜': { mark: '\u0303', above: true },
  '¯': { mark: '\u0304', above: true },
  '˘': { mark: '\u0306', above: true },
};

/**
 * An accent drawn as a glyph of its own over a letter becomes the combining mark, composed with
 * its letter when the span's text is normalised: over the letter before it ("z" + a raised "."
 * for "ż"), or, as TeX sets it, first and on the baseline, the letter drawn under it next
 * ("Bouall`egue" → "Bouallègue", "B¨ulte" → "Bülte").
 */
export function composeAccents(chars: RawChar[]): RawChar[] {
  const out: RawChar[] = [];
  const centreIn = (c: RawChar, l: RawChar) => {
    const centre = (c.bbox.x0 + c.bbox.x1) / 2;
    return centre > l.bbox.x0 && centre < l.bbox.x1;
  };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    const accent = COMBINING[c.c];
    const prev = chars[i - 1];
    const next = chars[i + 1];
    if (
      accent &&
      prev &&
      /\p{L}/u.test(prev.c) &&
      centreIn(c, prev) &&
      (!accent.above || c.y < prev.y - 0.3 * prev.size)
    ) {
      out.push({ ...prev, c: accent.mark, bbox: prev.bbox });
      continue;
    }
    if (
      accent?.above &&
      c.c !== '.' &&
      next &&
      /\p{L}/u.test(next.c) &&
      centreIn(c, next) &&
      c.y < next.y + 0.1 * next.size
    ) {
      // A dotless "ı" under an accent is the "i" of "í", "ï".
      out.push({ ...next, c: next.c === 'ı' ? 'i' : next.c }, { ...next, c: accent.mark });
      i++;
      continue;
    }
    out.push(c);
  }
  return out;
}

function toLine(rawChars: RawChar[], page: RawPage): LineIR {
  const chars = composeAccents(collapseLetterSpacing(rawChars));
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
    if (first.chip) span.chip = first.chip;
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
  const bbox = unionAll(spans.map((s) => s.bbox));
  // A line that opens with a badge starts where the badge does, its text a padding further in.
  const opening = spans[0]?.chip?.box ? spans[0].chip.box.pad * spans[0].size : 0;
  return { bbox: { ...bbox, x0: bbox.x0 - opening }, baseline, spans };
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

/**
 * Badges inside lines (a word on a pill: "Web3 Paketi"): MuPDF cuts the line at the badge and
 * starts a new block with it, so a sentence came out as four paragraphs and its translation
 * ran over the badge. A line that starts on a badge goes after the text left of it on the same
 * line, its characters marked with the badge's colours; blocks the badges cut apart, one over
 * the other at the text's own pitch and left edge, are one block again. Returns the badges'
 * shapes, taken off with their words and drawn anew.
 */
function joinInlineChips(page: RawPage): { blocks: RawTextBlock[]; chips: Rect[] } {
  // A pill: a filled shape about a line high and a few words wide; its border is drawn apart.
  // Not white: the paper's own colour behind a few words (Word's shading) is no badge.
  const fills = page.vectors.filter(
    (v) =>
      !v.isStroked &&
      !v.color.every((c) => c > 0.95) &&
      v.bbox.y1 - v.bbox.y0 >= 6 &&
      v.bbox.y1 - v.bbox.y0 <= 24 &&
      v.bbox.x1 - v.bbox.x0 >= 8 &&
      v.bbox.x1 - v.bbox.x0 <= 220,
  );
  const blocks = page.blocks.map((b) => ({ ...b, lines: [...b.lines] }));
  const chips: Rect[] = [];
  const touched = new Set<RawTextBlock>();
  const near = (a: Rect, b: Rect) =>
    Math.abs(a.x0 - b.x0) < 1.5 &&
    Math.abs(a.y0 - b.y0) < 1.5 &&
    Math.abs(a.x1 - b.x1) < 1.5 &&
    Math.abs(a.y1 - b.y1) < 1.5;
  const borderOf = (pill: Rect) =>
    page.vectors.find((v) => v.isStroked && near(v.bbox, expand(pill, 0.5)));
  /** A badge's colours and its box round its first letter, drawn again in the same proportions. */
  const chipOf = (pill: RawPage['vectors'][number], first: RawChar): Chip => {
    const border = borderOf(pill.bbox);
    const em = Math.max(first.size, 1);
    const within = (v: number, lo: number, hi: number) =>
      Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
    return {
      fill: pill.color,
      ...(border ? { stroke: border.color } : {}),
      box: {
        pad: within((first.bbox.x0 - pill.bbox.x0) / em, 0.2, 1),
        above: within((first.y - pill.bbox.y0) / em, 0.8, 1.6),
        below: within((pill.bbox.y1 - first.y) / em, 0.2, 0.8),
      },
    };
  };
  /**
   * Badges MuPDF left in their line (at its start, or within it): marked where they stand. Only a
   * pill wrapped tightly round some of the line's words, the line going on outside it: a shaded
   * cell or a box holds all of its text.
   */
  const markInPlace = (block: RawTextBlock, line: RawLine) => {
    const lineMid = (line.bbox.y0 + line.bbox.y1) / 2;
    const lineHeight = line.bbox.y1 - line.bbox.y0;
    const isInk = (c: RawChar) => /\S/u.test(c.c);
    let chars = line.chars;
    let start: number | undefined;
    for (const pill of fills) {
      const p = pill.bbox;
      if (Math.abs((p.y0 + p.y1) / 2 - lineMid) > 0.3 * lineHeight) continue;
      if (p.y1 - p.y0 > 2 * lineHeight || p.x1 < line.bbox.x0 || p.x0 > line.bbox.x1) continue;
      const inside = chars.map((c) => {
        const x = (c.bbox.x0 + c.bbox.x1) / 2;
        return x > p.x0 && x < p.x1;
      });
      const ink = chars.flatMap((c, i) => (inside[i] && isInk(c) ? [i] : []));
      if (!ink.length || ink.every((i) => chars[i]!.chip)) continue;
      if (!chars.some((c, i) => !inside[i] && isInk(c))) continue;
      const size = chars[ink[0]!]!.size;
      const tight =
        chars[ink[0]!]!.bbox.x0 - p.x0 < 1.2 * size &&
        p.x1 - chars[ink[ink.length - 1]!]!.bbox.x1 < 1.2 * size;
      if (!tight) continue;
      const chip = chipOf(pill, chars[ink[0]!]!);
      chars = chars.map((c, i) =>
        inside[i] && i >= ink[0]! && i <= ink[ink.length - 1]! ? { ...c, chip } : c,
      );
      chips.push(union(p, borderOf(p)?.bbox ?? p));
      if (ink[0] === chars.findIndex(isInk)) start = p.x0;
    }
    if (chars === line.chars) return;
    // A line that opens with a badge starts where the badge does, its text a padding further in.
    const bbox =
      start === undefined ? line.bbox : { ...line.bbox, x0: Math.min(line.bbox.x0, start) };
    block.lines[block.lines.indexOf(line)] = { ...line, bbox, chars };
    if (start !== undefined) touched.add(block);
  };
  for (const block of blocks) {
    for (const line of [...block.lines]) {
      if (line.dir[1] !== 0) continue;
      const first = line.chars.find((c) => /\S/u.test(c.c));
      if (!first) continue;
      const cx = (first.bbox.x0 + first.bbox.x1) / 2;
      const cy = (first.bbox.y0 + first.bbox.y1) / 2;
      const pill = fills.find(
        (v) => cx > v.bbox.x0 && cx < v.bbox.x1 && cy > v.bbox.y0 && cy < v.bbox.y1,
      );
      // The text it goes on: left of the badge on the same line, a word gap away.
      const host =
        pill &&
        blocks
          .flatMap((b) => b.lines.map((l) => ({ b, l })))
          .find(
            ({ l }) =>
              l !== line &&
              l.dir[1] === 0 &&
              l.bbox.x1 <= pill.bbox.x0 + 1 &&
              pill.bbox.x0 - l.bbox.x1 < 12 &&
              Math.abs((l.bbox.y0 + l.bbox.y1) / 2 - (pill.bbox.y0 + pill.bbox.y1) / 2) <
                0.5 * (l.bbox.y1 - l.bbox.y0),
          );
      if (!pill || !host) {
        markInPlace(block, line);
        continue;
      }
      const border = borderOf(pill.bbox);
      // The badge's words and the spaces between them; not a space at its edges.
      const inside = line.chars.map((c) => {
        const x = (c.bbox.x0 + c.bbox.x1) / 2;
        return x > pill.bbox.x0 && x < pill.bbox.x1;
      });
      const ink = line.chars.flatMap((c, i) => (inside[i] && /\S/u.test(c.c) ? [i] : []));
      const chip = chipOf(pill, line.chars[ink[0]!]!);
      const marked = line.chars.map((c, i) =>
        inside[i] && i >= ink[0]! && i <= ink[ink.length - 1]! ? { ...c, chip } : c,
      );
      const anchor = host.l.chars[host.l.chars.length - 1]!;
      const space: RawChar = { ...anchor, c: ' ', chip: undefined };
      delete space.chip;
      const merged = /\s$/u.test(anchor.c) ? marked : [space, ...marked];
      const at = host.b.lines.indexOf(host.l);
      host.b.lines[at] = {
        ...host.l,
        bbox: union(host.l.bbox, line.bbox),
        chars: [...host.l.chars, ...merged],
      };
      block.lines.splice(block.lines.indexOf(line), 1);
      chips.push(union(pill.bbox, border?.bbox ?? pill.bbox));
      touched.add(host.b);
    }
  }
  // Blocks the badges cut apart: one over the next at the text's pitch, from one left edge — not
  // the next item of a list (a mark left of its first line).
  // A list's mark: a bullet set as text, or drawn (a small dot or square, as a web page does).
  const marks = [
    ...page.blocks
      .flatMap((b) => b.lines)
      .filter((l) =>
        /^[•◦▪▫‣●○■□➢✓–-]$/u.test(
          l.chars
            .map((c) => c.c)
            .join('')
            .trim(),
        ),
      ),
    ...page.vectors
      .filter((v) => v.bbox.x1 - v.bbox.x0 <= 6 && v.bbox.y1 - v.bbox.y0 <= 6)
      .map((v) => ({ bbox: v.bbox })),
  ];
  const item = (l: RawLine) =>
    marks.some(
      (m) =>
        m.bbox.x1 <= l.bbox.x0 + 1 &&
        l.bbox.x0 - m.bbox.x1 < 20 &&
        Math.abs((m.bbox.y0 + m.bbox.y1) / 2 - (l.bbox.y0 + l.bbox.y1) / 2) <
          0.6 * (l.bbox.y1 - l.bbox.y0),
    );
  const out: RawTextBlock[] = [];
  for (const b of blocks.filter((x) => x.lines.length)) {
    const prev = out[out.length - 1];
    const last = prev?.lines[prev.lines.length - 1];
    const next = b.lines[0]!;
    const size = Math.max(...next.chars.map((c) => c.size), 1);
    if (
      prev &&
      last &&
      (touched.has(prev) || touched.has(b)) &&
      !item(next) &&
      Math.abs(next.bbox.x0 - prev.lines[0]!.bbox.x0) < 2 &&
      next.bbox.y0 - last.bbox.y1 < 0.8 * size &&
      next.bbox.y0 > last.bbox.y0
    ) {
      prev.lines.push(...b.lines);
      prev.bbox = union(prev.bbox, b.bbox);
      if (touched.has(b)) touched.add(prev);
      continue;
    }
    const copy = { ...b, bbox: unionAll(b.lines.map((l) => l.bbox)) };
    if (touched.has(b)) touched.add(copy);
    out.push(copy);
  }
  return { blocks: out, chips };
}

/** An equation's number beside it ("(3)", "(12a)"): kept with the formula. */
const EQUATION_TAG = /^\(\s*[\p{N}\p{L}.]{1,5}\s*\)$/u;

/**
 * Text read off a picture keeps the lines a table's cells give it, but a row comes as one block:
 * lines left side by side on one baseline after `mergeBaselines`, apart by more than a word gap.
 * Each run of lines that overlap horizontally is a paragraph group of its own; a block of stacked
 * lines comes back whole, and so does a formula with its number.
 */
function sideBySide(lines: RawLine[], fonts: RawPage['fonts']): RawLine[][] {
  const text = (l: RawLine) =>
    l.chars
      .map((c) => c.c)
      .join('')
      .trim();
  const level = lines.filter((l) => l.dir[1] === 0);
  const paired = level.some((a, i) =>
    level.some((b, j) => j > i && Math.abs(baselineOf(a) - baselineOf(b)) < 1),
  );
  if (
    !paired ||
    !lines.every((l) => l.chars.every((c) => fromPicture(c.font))) ||
    lines.some((l) => EQUATION_TAG.test(text(l))) ||
    lines.some((l) => l.chars.some((c) => fontInfo(c.font, fonts[c.font]).isMath))
  )
    return [lines];
  const groups: RawLine[][] = [];
  const boxes: Rect[] = [];
  for (const line of lines) {
    const hit = boxes.findIndex((b) => line.bbox.x0 < b.x1 && line.bbox.x1 > b.x0);
    if (hit < 0) {
      groups.push([line]);
      boxes.push({ ...line.bbox });
      continue;
    }
    groups[hit]!.push(line);
    boxes[hit] = union(boxes[hit]!, line.bbox);
  }
  return groups;
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
      // Sizes read off a picture are measured, a point either way within one paragraph.
      const pictured = [line, prev].every((l) => l.chars.every((c) => fromPicture(c.font)));
      const sizeChange =
        Math.abs(size - prevSize) > (pictured ? 0.15 * Math.max(size, prevSize) : 0.5) &&
        !prevIsMark;
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

function alignment(lines: LineIR[], box: Rect, layout?: PageLayout): BlockIR['align'] {
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
  // Of two lines the first sets the box's width itself: justified only when it ends at one of
  // the page's text edges (a two-line reference on a ragged page does not).
  const twoJustified = !layout || layout.edges.some((e) => Math.abs(e - body[0]!.bbox.x1) < tol);
  if (fullRight > 0.8 && fullLeft > 0.6)
    return body.length > 1 || twoJustified ? 'justify' : 'left';
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
  /** Where many long lines end together: the page's right text edges. */
  edges: number[];
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
  // An edge is where many lines end together, within a few points. Ragged lines ending a point or
  // two apart all across a column chain into one group, yet few of them meet in any one place.
  const need = Math.max(3, 0.15 * ends.length);
  const meet = (g: number[]) =>
    Math.max(...g.map((x) => g.filter((y) => y <= x && x - y <= 3).length)) >= need;
  const edgeGroups = groups.filter(meet);
  const edges = edgeGroups.map((g) => Math.max(...g));
  const onEdge = edgeGroups.flat().length;
  return {
    justified: ends.length >= 6 && onEdge >= 0.5 * ends.length,
    edges,
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
  const { blocks: joined, chips } = joinInlineChips(page);
  for (const raw of rejoinSplitLines(joined)) {
    const sizes = raw.lines.map(dominantSize);
    const em = sizes.length ? Math.max(...sizes) : 10;
    // A picture's text layer keeps a line's words together: lines it sets apart are cells.
    const gap = raw.lines.every((l) => l.chars.every((c) => fromPicture(c.font))) ? 1.2 : 3;
    const cellLines = raw.lines.filter((l) => inTable(l.bbox)).flatMap((l) => cuts.get(l) ?? [l]);
    const flowLines = raw.lines.filter((l) => !inTable(l.bbox));
    const groups = [
      ...cellLines.map((l) => [l]),
      ...(flowLines.length
        ? sideBySide(mergeBaselines(dropShadowLines(flowLines), gap * em), page.fonts).flatMap(
            (side, _, all) =>
              splitParagraphs(
                side,
                all.length > 1 ? unionAll(side.map((l) => l.bbox)) : raw.bbox,
                backgroundOf,
                page.fonts,
                layout,
              ),
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
      const onChips = lines.some((l) => l.spans.some((sp) => sp.chip))
        ? chips.filter((c) => coverage(c, expand(bbox, 2)) > 0.8)
        : [];
      const block: BlockIR = {
        ...(underlines.length ? { underlines } : {}),
        ...(onChips.length ? { chips: onChips } : {}),
        id: `p${page.index}-b${blocks.length}`,
        bbox,
        role: 'unknown',
        translatable: true,
        lines,
        align: alignment(lines, bbox, layout),
        direction: dir,
        columnIndex: 0,
        readingOrder: 0,
      };
      if (inTable(bbox)) cells.add(block);
      blocks.push(block);
    }
  }
  // Two lines between the same two rules of a ruled table, one over the other: one cell.
  const ruledRow = (r: Rect) => {
    const t = tables.find((x) => x.rows.length > 1 && coverage(r, x.rect) > 0.6);
    if (!t) return null;
    const mid = (r.y0 + r.y1) / 2;
    const k = t.rows.findIndex((y) => y > mid);
    return k > 0 ? `${t.id}:${k}` : null;
  };
  const sameCell = (a: Rect, b: Rect) => {
    const row = ruledRow(a);
    return row !== null && row === ruledRow(b) && xOverlap(a, b) > 0;
  };
  return dropDuplicates(mergeSplitParagraphs(blocks, layout, cells, sameCell));
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
/** The first and the last span with letters in it: the words either side of a line break. */
const opener = (line: LineIR) => line.spans.find((sp) => sp.text.trim()) ?? line.spans[0]!;
const closer = (line: LineIR) =>
  [...line.spans].reverse().find((sp) => sp.text.trim()) ?? line.spans[line.spans.length - 1]!;

/** A line ending in a sentence end, not in an abbreviation of a citation ("Lang et al."). */
const endsSentence = (text: string) =>
  /[.!?…:]["”»’)\]]*$/u.test(text) &&
  !/(?<!\p{L})(?:et al|e\.\s?g|i\.\s?e|cf|vs|vgl|bzw|z\.\s?B|d\.\s?h|bkz|vd)\.$/u.test(text);

function mergeSplitParagraphs(
  blocks: BlockIR[],
  layout: PageLayout,
  cells: Set<BlockIR>,
  sameCell: (a: Rect, b: Rect) => boolean = () => false,
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
      // In a ruled table's cell the next line goes on whatever its first letter, and so does one
      // after a separator ("Sigstore (sigstore.dev) ·" | "Open Policy Agent …"), inside an open
      // bracket ("… İLK KULLANICI (≈ 60" | "SA)") or before one ("… deneme" | "(DDO görevi
      // kapsamında)"), not an item's mark ("(b) …").
      const oneCell = cells.has(a) && cells.has(b) && sameCell(a.bbox, b.bbox);
      // A cell with another beside it (a label and its value): its sentences are one cell's
      // text. Not the notes under a table, one per line across its width.
      const besideOther =
        oneCell &&
        blocks.some(
          (o) =>
            o !== a &&
            o !== b &&
            cells.has(o) &&
            xOverlap(o.bbox, a.bbox) <= 0 &&
            Math.min(o.bbox.y1, a.bbox.y1) - Math.max(o.bbox.y0, a.bbox.y0) > 0,
        );
      const aAll = a.lines.flatMap((l) => l.spans.map((sp) => sp.text)).join('');
      const openBracket = (aAll.match(/\(/gu)?.length ?? 0) > (aAll.match(/\)/gu)?.length ?? 0);
      const bracketed = /^\(/u.test(bText) && !/^\(\w{1,4}\)\s/u.test(bText);
      const continuesLeft =
        (/^\p{Ll}/u.test(bText) ||
          /[·•–—→]$/u.test(aText) ||
          openBracket ||
          bracketed ||
          oneCell) &&
        leftOk;
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
      // A list item's next lines hang under its text, right of its number or bullet ("4. Models:
      // … + SHAP." | "Class imbalance …"): they go on whatever the line before ends with. A line
      // may open with a badge not taken for one, its text a padding further right.
      const under = (l: LineIR) =>
        Math.abs(l.bbox.x0 - bFirst.bbox.x0) < Math.max(1.5, 0.45 * size);
      const hangsUnder =
        !cells.has(a) &&
        !cells.has(b) &&
        BULLET.test(aFirstText.trimStart()) &&
        !BULLET.test(bText) &&
        bFirst.bbox.x0 - a.lines[0]!.bbox.x0 > 0.5 * size &&
        bFirst.bbox.x0 - a.lines[0]!.bbox.x0 < 3 * size &&
        [...a.lines.slice(1), ...b.lines].every(under) &&
        // Not a bold numbered heading over its text; a title in italics goes on.
        opener(a.lines[0]!).font.bold === opener(bFirst).font.bold;
      // A block that opens with a superscript mark is a new item (the next affiliation).
      const lead = bFirst.spans[0]!;
      const opensWithMark =
        MARK_ONLY.test(lead.text.trim()) &&
        lead.size < 0.8 * Math.max(...bFirst.spans.map((x) => x.size));
      // Small caps mix sizes within a line: a relative tolerance. A line going on at the left may
      // be mostly smaller type (a web address in code), the words either side of the break the
      // same size; not a centred line under another (an ORCID line under an affiliation).
      const close = (x: number, y: number) =>
        Math.abs(x - y) < Math.max(0.3, 0.08 * Math.max(x, y));
      const sameSize = close(mainSpan(aLast).size, size);
      const sameAtBreak =
        (continuesLeft || hangsUnder) && close(closer(aLast).size, opener(bFirst).size);
      const em = sameSize ? size : opener(bFirst).size;
      if (
        (!endsSentence(aText) || hangsUnder || besideOther) &&
        !opensWithMark &&
        (continuesLeft || continuesFull || continuesCentred || hangsUnder) &&
        step > 0.5 * em &&
        (step < Math.max(1.6, layout.lineStepEm + 0.3) * em || (regular && step < 3 * em)) &&
        (sameSize || sameAtBreak)
      ) {
        const lines = [...a.lines, ...b.lines];
        const bbox = union(a.bbox, b.bbox);
        const chips = [...(a.chips ?? []), ...(b.chips ?? [])];
        out[out.length - 1] = {
          ...a,
          lines,
          bbox,
          align: alignment(lines, bbox, layout),
          ...(chips.length ? { chips } : {}),
        };
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
      else if (
        !out.endsWith(' ') &&
        !(/[\p{L}]-$/u.test(out) && /^[\p{Lu}\d]/u.test(text)) &&
        // A range of numbers broken at its dash ("2020-" | "21").
        !(/\d[-–]$/u.test(out) && /^\d/u.test(text))
      )
        out += ' ';
    }
    out += text;
  });
  return out.replace(/\s+/g, ' ').trim();
}
