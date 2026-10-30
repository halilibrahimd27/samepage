import { DISPLAY_FORMULA, encode, type Encoded, type InlineRun } from '../../core/segment/codec';
import type { BlockIR, PageIR, Role, SpanIR } from '../../core/ir/types';
import type { Family } from './types';

/** One glyph run of an inline formula: text, size relative to the line, baseline shift (em, up). */
export interface MathPart {
  t: string;
  r: number;
  d: number;
}

export interface PdfStyle {
  family: Family;
  bold: boolean;
  italic: boolean;
  color: [number, number, number];
  size: number;
  /** Original font name (size compensation is computed per source font). */
  fontName: string;
  linkUri?: string;
  underline?: boolean;
}

/** One translation unit: a paragraph chain (or a single block) and its tagged text. */
export interface PdfUnit {
  id: string;
  role: Role;
  blocks: BlockIR[];
  encoded: Encoded<PdfStyle>;
}

const styleKey = (s: PdfStyle) =>
  `${s.family}|${s.bold ? 'b' : ''}${s.italic ? 'i' : ''}${s.underline ? 'u' : ''}|${s.color.map((c) => Math.round(c * 50)).join(',')}|${Math.round(s.size * 2)}|${s.linkUri ?? ''}`;

function styleOf(span: SpanIR): PdfStyle {
  const style: PdfStyle = {
    family: span.font.family,
    bold: span.font.bold,
    italic: span.font.italic,
    color: span.color,
    size: span.size,
    fontName: span.font.name,
  };
  if (span.linkUri) style.linkUri = span.linkUri;
  if (span.underline) style.underline = true;
  return style;
}

/**
 * How the document itself writes its words: compounds with a hyphen inside a line ("self-attention")
 * and words without one ("pretraining"), lower-cased, with their counts.
 */
export interface HyphenEvidence {
  hyphenated: Map<string, number>;
  plain: Map<string, number>;
}

/** Reads the document's words inside its lines (a hyphen at a line end is not evidence). */
export function hyphenEvidence(pages: PageIR[]): HyphenEvidence {
  const hyphenated = new Map<string, number>();
  const plain = new Map<string, number>();
  for (const page of pages)
    for (const block of page.blocks)
      for (const line of block.lines) {
        const text = line.spans
          .filter((s) => !s.font.isMath)
          .map((s) => s.text)
          .join('')
          .toLowerCase();
        for (const m of text.matchAll(/\p{L}+(?:[-\u2010]\p{L}+)+|\p{L}+/gu)) {
          const word = m[0].replace(/\u2010/g, '-');
          const map = word.includes('-') ? hyphenated : plain;
          map.set(word, (map.get(word) ?? 0) + 1);
        }
      }
  return { hyphenated, plain };
}

/**
 * A line ending in a hyphen, joined with the next line's start: hyphenation is dropped before a
 * lower-case letter ("ge-" + "lişme"); a word's own hyphen stays, without a space ("Von-Neumann",
 * "COVID-19"). Before a lower-case letter the document decides when it knows the word: "self-" +
 * "attention" keeps its hyphen when "self-attention" is written inside a line elsewhere.
 */
export function joinHyphen(text: string, next: string, evidence?: HyphenEvidence): string {
  if (/^\p{Ll}/u.test(next)) {
    const left = /(\p{L}+)-$/u.exec(text)?.[1]?.toLowerCase();
    const right = /^\p{L}+/u.exec(next)?.[0].toLowerCase();
    if (evidence && left && right) {
      const kept = evidence.hyphenated.get(`${left}-${right}`) ?? 0;
      const joined = evidence.plain.get(left + right) ?? 0;
      if (kept > 0 && kept >= joined) return text;
    }
    return text.slice(0, -1);
  }
  return /^\s/u.test(next) ? `${text} ` : text;
}

/** A unit symbol at the end of the text ("кг/м", "10 cm", "Вт/(м"). */
const UNIT_END = /(?:^|[\s/·⋅(×*])(?:[kcmdμn]?m|[кмсдн]?м|s|с|mol|моль|L|л)$/u;
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
  '−': '⁻',
};

/**
 * Superscript marks (footnote numbers, ordinals): small and raised above the line's baseline.
 * ACM's Libertine sets them at 7.3 pt in 9 pt text.
 */
function isSuperscript(span: SpanIR, lineSize: number, baseline: number): boolean {
  const spanBaseline = span.baseline ?? span.bbox.y1 - span.size * 0.2;
  return (
    span.size < lineSize * 0.86 &&
    baseline - spanBaseline > lineSize * 0.2 &&
    /^[\d*†‡§,–-]+$/.test(span.text.trim())
  );
}

function blockRuns(
  block: BlockIR,
  runs: InlineRun<PdfStyle>[],
  evidence?: HyphenEvidence,
): void {
  // Spaces at the edges of a formula belong to the text around it ("katsayısı ⟦F1⟧ = 0,81"):
  // a formula that carries them reads as glued to its neighbours, and cannot travel as text.
  const spaceBefore = (space: string, span: SpanIR) => {
    const last = runs[runs.length - 1];
    if (last?.type === 'text') last.text += space;
    else runs.push({ type: 'text', text: space, style: styleOf(span) });
  };
  const atomTail = (): string => {
    const last = runs[runs.length - 1];
    if (last?.type !== 'atom' || last.kind !== 'F' || !last.ref) return '';
    const tail = /\s+$/u.exec(last.text)?.[0] ?? '';
    if (!tail) return '';
    const parts = JSON.parse(last.ref) as MathPart[];
    while (parts.length && /\s$/u.test(parts[parts.length - 1]!.t)) {
      const p = parts[parts.length - 1]!;
      p.t = p.t.trimEnd();
      if (p.t) break;
      parts.pop();
    }
    runs[runs.length - 1] = { ...last, text: last.text.trimEnd(), ref: JSON.stringify(parts) };
    return tail;
  };
  block.lines.forEach((line, li) => {
    const lineSize =
      Math.max(...line.spans.filter((s) => !s.font.isMath).map((s) => s.size), 0) ||
      line.spans[0]!.size;
    line.spans.forEach((span, si) => {
      let text = span.text;
      const isLastSpan = si === line.spans.length - 1;
      const nextLine = block.lines[li + 1];
      // Join hyphenated line ends: "ge-" + "lişme" → "gelişme"; a hyphen before a capital or a
      // digit belongs to the word ("Von-" + "Neumann", "COVID-" + "19").
      if (isLastSpan && nextLine && /\p{L}-$/u.test(text))
        text = joinHyphen(text, nextLine.spans[0]?.text ?? '', evidence);
      else if (isLastSpan && li < block.lines.length - 1 && !text.endsWith(' ')) text += ' ';
      const before = runs[runs.length - 1];
      if (
        span.font.isMath &&
        /^[.,]$/.test(text) &&
        before?.type === 'text' &&
        /\d$/.test(before.text) &&
        /^\d/.test(line.spans[si + 1]?.text ?? '')
      ) {
        // A decimal separator set in a math font ("0{,}81") belongs to its number: as a formula
        // piece it would split "0,81" in two, and an engine may tear the halves apart.
        before.text += text;
        return;
      }
      if (span.font.isMath) {
        // Adjacent math spans form one formula atom; each part keeps its relative size and
        // baseline shift so sub/superscripts are re-set correctly.
        const prev = runs[runs.length - 1];
        const continues = prev?.type === 'atom' && prev.kind === 'F' && !!prev.ref;
        let t = text;
        const lead = continues ? '' : (/^\s+/u.exec(t)?.[0] ?? '');
        if (lead) {
          spaceBefore(lead, span);
          t = t.slice(lead.length);
        }
        if (!t) return;
        const part: MathPart = {
          t,
          r: Math.round((span.size / lineSize) * 100) / 100,
          d:
            Math.round(((line.baseline - (span.baseline ?? line.baseline)) / lineSize) * 100) / 100,
        };
        if (continues && prev.type === 'atom' && prev.ref) {
          const parts = JSON.parse(prev.ref) as MathPart[];
          parts.push(part);
          runs[runs.length - 1] = { ...prev, text: prev.text + t, ref: JSON.stringify(parts) };
        } else {
          runs.push({ type: 'atom', kind: 'F', text: t, ref: JSON.stringify([part]) });
        }
      } else if (isSuperscript(span, lineSize, line.baseline)) {
        // A unit's exponent ("кг/м³", "s⁻¹") is part of the text, not a footnote mark: as a mark
        // engines write it as a plain digit ("kg/m3") and the number check fails.
        // A line end after it keeps its space either way.
        const after = /\s+$/u.exec(text)?.[0] ?? '';
        if (before?.type === 'text' && UNIT_END.test(before.text) && /^[\d−-]+$/.test(text.trim()))
          before.text += [...text.trim()].map((c) => SUPERSCRIPT[c] ?? c).join('') + after;
        else {
          const tail = atomTail();
          if (tail) spaceBefore(tail, span);
          runs.push({ type: 'atom', kind: 'N', text: span.text.trim() });
          if (after) spaceBefore(after, span);
        }
      } else runs.push({ type: 'text', text: atomTail() + text, style: styleOf(span) });
    });
  });
  atomTail();
}

/** Builds translation units from analysed pages: one per chain (head first) or translatable block. */
export function buildPdfUnits(pages: PageIR[]): PdfUnit[] {
  const byId = new Map(pages.flatMap((p) => p.blocks).map((b) => [b.id, b]));
  const units: PdfUnit[] = [];
  const evidence = hyphenEvidence(pages);
  for (const page of pages) {
    for (const block of [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder)) {
      if (!block.translatable || (block.chain && block.chain.index > 0)) continue;
      const blocks = [block];
      let next = block.chain?.next;
      while (next) {
        const b = byId.get(next);
        if (!b) break;
        blocks.push(b);
        next = b.chain?.next;
      }
      const runs: InlineRun<PdfStyle>[] = [];
      blocks.forEach((b, i) => {
        blockRuns(b, runs, evidence);
        const last = runs[runs.length - 1];
        const next = blocks[i + 1]?.lines[0]?.spans[0];
        if (next && last?.type === 'text' && !last.text.endsWith(' ')) {
          // A chain continues in the next box: hyphenated words are joined, otherwise a space.
          if (/\p{L}-$/u.test(last.text)) last.text = joinHyphen(last.text, next.text, evidence);
          else last.text += ' ';
        } else if (next && last && last.type !== 'text') {
          // After a formula or a mark at the end of the box ("… vn" | "= rkeinθ …").
          runs.push({ type: 'text', text: ' ', style: styleOf(next) });
        }
        if (next && blocks[i + 1]!.chain?.afterFormula) {
          // The display formula between the two boxes, as a marker the engine reads in place.
          runs.push({ type: 'atom', kind: 'I', text: '', ref: DISPLAY_FORMULA });
          runs.push({ type: 'text', text: ' ', style: styleOf(next) });
        }
      });
      const last = runs[runs.length - 1];
      if (last?.type === 'text') last.text = last.text.trimEnd();
      // Units without letters (numbers, symbols, pure formulas) are left untouched.
      if (!runs.some((r) => r.type === 'text' && /\p{L}/u.test(r.text))) continue;
      units.push({
        id: block.chain?.paragraphId ?? block.id,
        role: block.role,
        blocks,
        encoded: encode(runs, styleKey),
      });
    }
  }
  return units;
}
