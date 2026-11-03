import { localeFor } from '../core/languages';
import type { Element as XElement, Node as XNode } from '@xmldom/xmldom';
import type { Role } from '../core/ir/types';
import { encode, type DecodedRun, type Encoded, type InlineRun } from '../core/segment/codec';
import type { PlaceholderKind } from '../core/segment/types';
import { commentInWords, monoProse } from '../core/segment/code';
import { NS } from './xml';

/**
 * Paragraph model shared by WordprocessingML (w:p) and DrawingML (a:p) text.
 * Extraction turns a paragraph into codec runs; rebuild writes a translation back, moving the
 * original atom nodes (tabs, drawings, footnote marks, formulas, fields…) into place.
 */
export type Dialect = 'w' | 'a';

export interface RunStyle {
  key: string;
  rPr: XElement | null;
  /** Innermost wrapper chain (hyperlink, w:ins, sdtContent…) from outermost to innermost. */
  wrappers: XElement[];
}

interface AtomPayload {
  /** Node moved back into the paragraph on rebuild. */
  node: XNode;
  /** Wrapper chain the node lived in (hyperlink, w:ins…). */
  wrappers: XElement[];
  /** Set when the atom was a child of a run (tab, break…): a new run with these properties hosts it. */
  rPr?: XElement | null;
}

export interface ExtractedParagraph {
  para: XElement;
  dialect: Dialect;
  role: Role;
  encoded: Encoded<RunStyle>;
  atoms: AtomPayload[];
  /** Paragraph-level markers kept at the start / end (bookmarks, comment ranges…). */
  head: XNode[];
  tail: XNode[];
  plain: string;
}

const W = NS.w;
const A = NS.a;

const elementChildren = (el: XElement): XElement[] => {
  const out: XElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as XElement);
  return out;
};
const is = (el: XElement, ns: string, local: string) =>
  el.namespaceURI === ns && el.localName === local;

/**
 * rPr children ignored when comparing styles: no visible effect, or per-run justification
 * tweaks (character spacing, kerning, width scale) that PDF converters put on every word and
 * space — they carry no meaning once the text is translated and would shred each sentence
 * into dozens of tags. Merged runs keep the properties of their first run.
 */
const IGNORED_RPR = new Set([
  'lang',
  'noProof',
  'rPrChange',
  'webHidden',
  'specVanish',
  'spacing',
  'kern',
  'w',
]);

/**
 * DrawingML (text boxes, charts, slides) keeps bold, italic, underline, size … as attributes of
 * a:rPr, where WordprocessingML has child elements; without them every run of a slide looked
 * alike and its formatting was merged away.
 */
const A_RPR_ATTRS = new Set(['b', 'i', 'u', 'strike', 'baseline', 'cap', 'sz']);

/**
 * Text Word sets in the complex-script or East Asian font. Other text shows none of those
 * properties: runs of Hungarian that differ only in their w:cs font ("képerny" | "alapú") are
 * one style.
 */
const COMPLEX_OR_ASIAN =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u;
/** Properties of complex-script and East Asian text only. */
const COMPLEX_RPR = new Set(['bCs', 'iCs', 'szCs', 'ea', 'cs']);
const LATIN_FONT_ATTRS = new Set(['ascii', 'hAnsi', 'asciiTheme', 'hAnsiTheme']);
const FONT_RPR = new Set(['rFonts', 'latin', 'ea', 'cs', 'sym']);

/**
 * Style key of run properties. `latin`: the run's text is neither complex-script nor East Asian.
 * `fontless`: fonts left out, for a word split where a font lacks a letter.
 */
function rPrKey(rPr: XElement | null, opts: { latin?: boolean; fontless?: boolean } = {}): string {
  if (!rPr) return '';
  const own: string[] = [];
  if (rPr.namespaceURI === A) {
    for (let i = 0; i < rPr.attributes.length; i++) {
      const a = rPr.attributes.item(i)!;
      if (A_RPR_ATTRS.has(a.localName ?? '')) own.push(`@${a.localName}=${a.value}`);
    }
  }
  const dialectA = rPr.namespaceURI === A;
  return [
    ...own.sort(),
    ...elementChildren(rPr)
      .filter((c) => {
        const name = c.localName ?? '';
        if (IGNORED_RPR.has(name)) return false;
        if (opts.fontless && FONT_RPR.has(name)) return false;
        // w:cs is the complex-script switch itself; a:cs is a font.
        if (opts.latin && COMPLEX_RPR.has(name) && (dialectA || name !== 'cs')) return false;
        return true;
      })
      .map((c) => {
        const attrs: string[] = [];
        for (let i = 0; i < c.attributes.length; i++) {
          const a = c.attributes.item(i)!;
          if (opts.latin && c.localName === 'rFonts' && !LATIN_FONT_ATTRS.has(a.localName ?? ''))
            continue;
          attrs.push(`${a.localName}=${a.value}`);
        }
        return `${c.localName}[${attrs.sort().join(',')}]`;
      })
      .sort(),
  ].join(';');
}

function wrapperKey(w: XElement): string {
  const id =
    w.getAttributeNS(NS.r, 'id') ||
    w.getAttributeNS(W, 'id') ||
    w.getAttributeNS(W, 'anchor') ||
    '';
  return `${w.localName}:${id}`;
}

function styleOf(rPr: XElement | null, wrappers: XElement[]): RunStyle {
  return { key: `${wrappers.map(wrapperKey).join('>')}|${rPrKey(rPr)}`, rPr, wrappers };
}

/** Symbol fonts draw letters as other signs ("a" in Symbol is α): never merged into text. */
const SYMBOL_FONT = /symbol|wingdings|webdings|dingbat|marlett|mt extra/i;

const fontOf = (rPr: XElement | null) =>
  rPr?.getElementsByTagNameNS(W, 'rFonts')[0]?.getAttributeNS(W, 'ascii') ||
  rPr?.getElementsByTagNameNS(A, 'latin')[0]?.getAttribute('typeface') ||
  '';

/**
 * Neighbouring runs that look alike become one style before encoding, so no tag splits them:
 * text that is neither complex-script nor East Asian and differs only in properties of those
 * scripts (the w:cs font of "képerny" and "alapú"), and a word split over runs that differ only
 * in font, in the style of its longer part — Word sets a letter the font lacks in another one
 * ("MUNKAID" + "Ő" in Times New Roman + " ÖSSZEHASONLÍTÁS"). As a tag inside the word, Google
 * translated the pieces apart ("<t1>ESERLERİN</t1> KARŞILAŞTIRILMASI").
 */
function mendLookalikes(runs: InlineRun<RunStyle>[]) {
  const keyOf = (s: RunStyle, opts: { latin?: boolean; fontless?: boolean }) =>
    `${s.wrappers.map(wrapperKey).join('>')}|${rPrKey(s.rPr, opts)}`;
  for (let changed = true, rounds = 0; changed && rounds < 4; rounds++) {
    changed = false;
    for (let i = 1; i < runs.length; i++) {
      const [a, b] = [runs[i - 1]!, runs[i]!];
      if (a.type !== 'text' || b.type !== 'text' || a.style.key === b.style.key) continue;
      if (COMPLEX_OR_ASIAN.test(a.text + b.text)) continue;
      let style: RunStyle | null = null;
      if (keyOf(a.style, { latin: true }) === keyOf(b.style, { latin: true })) style = a.style;
      else if (
        /\p{L}\p{M}*$/u.test(a.text) &&
        /^\p{L}/u.test(b.text) &&
        ![a, b].some((r) => SYMBOL_FONT.test(fontOf(r.style.rPr))) &&
        keyOf(a.style, { latin: true, fontless: true }) ===
          keyOf(b.style, { latin: true, fontless: true })
      )
        style = a.text.length >= b.text.length ? a.style : b.style;
      if (!style) continue;
      runs[i - 1] = { ...a, style };
      runs[i] = { ...b, style };
      changed = true;
    }
  }
}

/** Run-level children that become atoms, with their placeholder kind. */
const W_RUN_ATOMS: Record<string, PlaceholderKind> = {
  tab: 'T',
  ptab: 'T',
  br: 'B',
  cr: 'B',
  sym: 'I',
  drawing: 'I',
  pict: 'I',
  object: 'I',
  footnoteReference: 'N',
  endnoteReference: 'N',
  commentReference: 'N',
  annotationRef: 'N',
  footnoteRef: 'N',
  endnoteRef: 'N',
  separator: 'I',
  continuationSeparator: 'I',
  pgNum: 'R',
  ruby: 'I',
};
/** Paragraph-level markers moved to the start or the end of the rebuilt paragraph. */
const W_HEAD = new Set([
  'bookmarkStart',
  'commentRangeStart',
  'permStart',
  'moveFromRangeStart',
  'moveToRangeStart',
]);
const W_TAIL = new Set([
  'bookmarkEnd',
  'commentRangeEnd',
  'permEnd',
  'moveFromRangeEnd',
  'moveToRangeEnd',
]);
/** Inline containers whose children are walked, recorded as wrappers. */
const W_WRAPPERS = new Set([
  'hyperlink',
  'ins',
  'smartTag',
  'customXml',
  'sdtContent',
  'dir',
  'bdo',
]);

function fieldCharType(run: XElement): string | null {
  for (const c of elementChildren(run))
    if (is(c, W, 'fldChar')) return c.getAttributeNS(W, 'fldCharType');
  return null;
}

interface Flat {
  kind: 'run' | 'atom' | 'head' | 'tail' | 'skip';
  node: XElement;
  wrappers: XElement[];
  atomKind?: PlaceholderKind;
}

function flattenW(container: XElement, wrappers: XElement[], out: Flat[]) {
  for (const el of elementChildren(container)) {
    const name = el.localName ?? '';
    if (el.namespaceURI === W) {
      if (name === 'pPr' || name === 'proofErr' || name === 'lastRenderedPageBreak')
        out.push({ kind: 'skip', node: el, wrappers });
      else if (name === 'r') out.push({ kind: 'run', node: el, wrappers });
      else if (W_HEAD.has(name)) out.push({ kind: 'head', node: el, wrappers });
      else if (W_TAIL.has(name)) out.push({ kind: 'tail', node: el, wrappers });
      else if (W_WRAPPERS.has(name)) flattenW(el, [...wrappers, el], out);
      else if (name === 'sdt') {
        const content = elementChildren(el).find((c) => is(c, W, 'sdtContent'));
        if (content) flattenW(content, [...wrappers, el, content], out);
      } else if (name === 'del' || name === 'moveFrom')
        out.push({ kind: 'atom', node: el, wrappers, atomKind: 'R' });
      else if (name === 'fldSimple') out.push({ kind: 'atom', node: el, wrappers, atomKind: 'R' });
      else out.push({ kind: 'atom', node: el, wrappers, atomKind: 'I' });
    } else if (el.namespaceURI === NS.m) {
      out.push({ kind: 'atom', node: el, wrappers, atomKind: 'F' });
    } else {
      // mc:AlternateContent and unknown extensions stay as opaque atoms.
      out.push({ kind: 'atom', node: el, wrappers, atomKind: 'I' });
    }
  }
}

function textOfAtom(node: XNode): string {
  return (node.textContent ?? '').slice(0, 200);
}

/** Extracts a WordprocessingML paragraph. */
const MONO_FONT =
  /mono|courier|consolas|menlo|monaco|inconsolata|source code|fira code|lucida console/i;

/** A run set in a code font, directly or through a character style ("HTML Code", "Verbatim"). */
export function isMono(rPr: XElement | null): boolean {
  if (!rPr) return false;
  const font =
    rPr.getElementsByTagNameNS(NS.w, 'rFonts')[0]?.getAttributeNS(NS.w, 'ascii') ??
    rPr.getElementsByTagNameNS(NS.a, 'latin')[0]?.getAttribute('typeface') ??
    '';
  const style = rPr.getElementsByTagNameNS(NS.w, 'rStyle')[0]?.getAttributeNS(NS.w, 'val') ?? '';
  return MONO_FONT.test(font) || /code|verbatim|monospace/i.test(style);
}

const runText = (run: XElement) =>
  Array.from(run.getElementsByTagNameNS(W, 't'))
    .map((t) => t.textContent ?? '')
    .join('');

/**
 * Extracts a Word paragraph. With `code`, runs in a code font are code ("python3 --version",
 * "bolum_x()", a listing's lines): each travels as itself, its style kept, and a paragraph of
 * code alone is not translated — unless it reads as language (a label in a typewriter font, a
 * comment in words).
 */
export function extractW(
  para: XElement,
  role: Role,
  opts: { code?: boolean } = {},
): ExtractedParagraph {
  const flat: Flat[] = [];
  flattenW(para, [], flat);
  const textRuns = flat.filter((f) => f.kind === 'run' && /\S/u.test(runText(f.node)));
  const monoOf = (run: XElement) =>
    isMono(elementChildren(run).find((c) => is(c, W, 'rPr')) ?? null);
  const allMono = textRuns.length > 0 && textRuns.every((f) => monoOf(f.node));
  const whole = textRuns.map((f) => runText(f.node)).join('');
  const codeRuns = !!opts.code && !(allMono && (monoProse(whole) || commentInWords(whole)));
  const runs: InlineRun<RunStyle>[] = [];
  const atoms: AtomPayload[] = [];
  const head: XNode[] = [];
  const tail: XNode[] = [];
  const pushAtom = (
    kind: PlaceholderKind,
    node: XNode,
    wrappers: XElement[],
    runStyle?: RunStyle,
  ) => {
    atoms.push(
      runStyle ? { node, wrappers: runStyle.wrappers, rPr: runStyle.rPr } : { node, wrappers },
    );
    runs.push({
      type: 'atom',
      kind: kind as Exclude<PlaceholderKind, 'L' | 'U'>,
      text: textOfAtom(node),
      ref: String(atoms.length - 1),
    });
  };

  // Complex fields: a field fully inside the paragraph becomes one atom; for fields that span
  // paragraphs (e.g. TOC) only the instruction part is atomised and the result is translated.
  const runIdx = flat.map((f, i) => (f.kind === 'run' ? i : -1)).filter((i) => i >= 0);
  const fieldEnd = new Map<number, number>();
  const stack: number[] = [];
  for (const i of runIdx) {
    const t = fieldCharType(flat[i]!.node);
    if (t === 'begin') stack.push(i);
    else if (t === 'end' && stack.length) fieldEnd.set(stack.pop()!, i);
  }

  let inFieldUntil = -1;
  let inInstruction = false;
  for (let i = 0; i < flat.length; i++) {
    const f = flat[i]!;
    if (f.kind === 'skip') continue;
    if (f.kind === 'head') {
      head.push(f.node);
      continue;
    }
    if (f.kind === 'tail') {
      tail.push(f.node);
      continue;
    }
    if (f.kind === 'atom') {
      pushAtom(f.atomKind!, f.node, f.wrappers);
      continue;
    }
    const run = f.node;
    const rPr = elementChildren(run).find((c) => is(c, W, 'rPr')) ?? null;
    const style = styleOf(rPr, f.wrappers);
    const fc = fieldCharType(run);

    if (i <= inFieldUntil) {
      pushAtom('R', run, f.wrappers);
      continue;
    }
    if (fc === 'begin') {
      const end = fieldEnd.get(i);
      if (end !== undefined) {
        inFieldUntil = end;
        pushAtom('R', run, f.wrappers);
        continue;
      }
      inInstruction = true;
    }
    if (inInstruction) {
      pushAtom('R', run, f.wrappers);
      if (fc === 'separate') inInstruction = false;
      continue;
    }
    if (fc) {
      pushAtom('R', run, f.wrappers);
      continue;
    }
    if (codeRuns && monoOf(run) && /\S/u.test(runText(run))) {
      pushAtom('C', run, f.wrappers);
      continue;
    }

    for (const c of elementChildren(run)) {
      const name = c.localName ?? '';
      if (c.namespaceURI !== W) {
        pushAtom('I', c, f.wrappers, style);
      } else if (name === 'rPr') {
        continue;
      } else if (name === 't') {
        runs.push({ type: 'text', text: c.textContent ?? '', style });
      } else if (name === 'noBreakHyphen') {
        runs.push({ type: 'text', text: '‑', style });
      } else if (name === 'softHyphen') {
        runs.push({ type: 'text', text: '­', style });
      } else if (name === 'instrText' || name === 'delText') {
        pushAtom('R', c, f.wrappers, style);
      } else if (name === 'lastRenderedPageBreak') {
        continue;
      } else {
        pushAtom(W_RUN_ATOMS[name] ?? 'I', c, f.wrappers, style);
      }
    }
  }
  mendLookalikes(runs);
  const encoded = encode(runs, (s) => s.key);
  const plain = runs
    .filter((r) => r.type === 'text')
    .map((r) => r.text)
    .join('');
  return { para, dialect: 'w', role, encoded, atoms, head, tail, plain };
}

/** Extracts a DrawingML paragraph (charts, SmartArt, shapes). */
/**
 * Extracts a DrawingML paragraph (a slide, a text box, a chart label). With `code`, runs in a code
 * font travel as themselves, as in extractW.
 */
export function extractA(
  para: XElement,
  role: Role,
  opts: { code?: boolean } = {},
): ExtractedParagraph {
  const runs: InlineRun<RunStyle>[] = [];
  const atoms: AtomPayload[] = [];
  const tail: XNode[] = [];
  const textOf = (r: XElement) => elementChildren(r).find((c) => is(c, A, 't'))?.textContent ?? '';
  const rPrOf = (r: XElement) => elementChildren(r).find((c) => is(c, A, 'rPr')) ?? null;
  const textRuns = elementChildren(para).filter((c) => is(c, A, 'r') && /\S/u.test(textOf(c)));
  const allMono = textRuns.length > 0 && textRuns.every((r) => isMono(rPrOf(r)));
  const whole = textRuns.map(textOf).join('');
  const codeRuns = !!opts.code && !(allMono && (monoProse(whole) || commentInWords(whole)));
  for (const el of elementChildren(para)) {
    const name = el.localName ?? '';
    if (el.namespaceURI === A && name === 'pPr') continue;
    if (el.namespaceURI === A && name === 'endParaRPr') {
      tail.push(el);
    } else if (el.namespaceURI === A && name === 'r') {
      const rPr = rPrOf(el);
      const text = textOf(el);
      if (codeRuns && isMono(rPr) && /\S/u.test(text)) {
        atoms.push({ node: el, wrappers: [] });
        runs.push({ type: 'atom', kind: 'C', text, ref: String(atoms.length - 1) });
        continue;
      }
      runs.push({ type: 'text', text, style: styleOf(rPr, []) });
    } else {
      atoms.push({ node: el, wrappers: [] });
      runs.push({
        type: 'atom',
        kind: name === 'br' ? 'B' : name === 'fld' ? 'R' : 'I',
        text: textOfAtom(el),
        ref: String(atoms.length - 1),
      });
    }
  }
  mendLookalikes(runs);
  const encoded = encode(runs, (s) => s.key);
  const plain = runs
    .filter((r) => r.type === 'text')
    .map((r) => r.text)
    .join('');
  return { para, dialect: 'a', role, encoded, atoms, head: [], tail, plain };
}

/** Addresses a reader copies: a hidden character inside one breaks it. Word wraps them anyway. */
const ADDRESS = /^\W*(?:[a-z][\w+.-]*:\/\/|www\.|doi:|10\.\d{4,}\/|[\w.+-]+@[\w-]+\.)/i;

/** Zero-width space after path separators in long tokens (D4_LONG_TOKEN); addresses are kept. */
export function breakLongTokens(text: string, minLength = 25): { text: string; changed: boolean } {
  let changed = false;
  const out = text.replace(new RegExp(`\\S{${minLength},}`, 'g'), (token) => {
    if (ADDRESS.test(token)) return token;
    const broken = token.replace(/([/\-_.])(?=\S)/g, `$1${String.fromCharCode(0x200b)}`);
    if (broken !== token) changed = true;
    return broken;
  });
  return { text: out, changed };
}

/** Schema order of paragraph and run properties: Word rejects a property out of its place. */
const PPR_ORDER = `pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr
  suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct
  autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents
  suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr
  sectPr pPrChange`.split(/\s+/u);
const RPR_ORDER = `rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss
  imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u
  effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath
  rPrChange`.split(/\s+/u);

/** Sets a property (its w:val, or none), placed where the schema orders it. */
function setProperty(props: XElement, order: string[], local: string, val: string | null) {
  let el = elementChildren(props).find((c) => is(c, W, local));
  if (!el) {
    el = props.ownerDocument!.createElementNS(W, `w:${local}`);
    const rank = order.indexOf(local);
    const next = elementChildren(props).find(
      (c) => c.namespaceURI === W && order.indexOf(c.localName ?? '') > rank,
    );
    props.insertBefore(el, next ?? null);
  }
  if (val === null) el.removeAttributeNS(W, 'val');
  else el.setAttributeNS(W, 'w:val', val);
}

const on = (el: XElement | undefined) =>
  !!el && !/^(?:0|false|off)$/u.test(el.getAttributeNS(W, 'val') ?? '');

/** Share of the letters that are Arabic or Hebrew (0 without letters). */
export function rightToLeftShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters
    ? (text.match(/[\p{Script=Arabic}\p{Script=Hebrew}]/gu)?.length ?? 0) / letters
    : 0;
}
/** Most letters Arabic or Hebrew. */
const rightToLeft = (text: string) => rightToLeftShare(text) >= 0.5;

/** Fonts made for Arabic, Persian, Urdu or Hebrew: their Latin letters, if any, are an afterthought. */
const RIGHT_TO_LEFT_FONT =
  /arab|naskh|kufi|majalla|typesetting|lotus|nazanin|mitra|\bzar\b|yagut|titr|traffic|\bbadr\b|mohanad|andalus|aldhabi|urdu|nastal|jameel|scheherazade|amiri|uthman|kfgqpc|quran|david|miriam|narkisim|frank ?ruehl|levenim|gisha|aharoni|hebrew/i;

/**
 * A run of Arabic or Hebrew now in a left-to-right language: not right to left any more, and
 * bold or italic as Word showed it as complex script. Its size stays the document's for Latin
 * text where it has one: Arabic is set larger (16 pt beside 12) for its smaller letters. A size
 * the same for both was chosen for the Arabic (14 pt of Sakkal Majalla): Latin takes 6/7 of it.
 * A Latin font made for Arabic becomes Times New Roman (missing on most machines, Sakkal Majalla
 * came out in a wide sans; nor has it "ş", "ğ", "ı").
 */
function turnLeftToRight(rPr: XElement, inherited: InheritedSize = {}) {
  const kids = elementChildren(rPr);
  const find = (local: string) => kids.find((c) => is(c, W, local));
  if (find('rtl')) setProperty(rPr, RPR_ORDER, 'rtl', '0');
  if (on(find('bCs')) && !find('b')) setProperty(rPr, RPR_ORDER, 'b', null);
  if (on(find('iCs')) && !find('i')) setProperty(rPr, RPR_ORDER, 'i', null);
  const fonts = find('rFonts');
  for (const attr of ['ascii', 'hAnsi'])
    if (RIGHT_TO_LEFT_FONT.test(fonts?.getAttributeNS(W, attr) ?? ''))
      fonts!.setAttributeNS(W, `w:${attr}`, 'Times New Roman');
  // Its own size, or its styles' ("Normal (Web)": 14 pt for both).
  const sz = find('sz')?.getAttributeNS(W, 'val') || inherited.sz;
  const szCs = find('szCs')?.getAttributeNS(W, 'val') || inherited.szCs;
  if (sz && sz === szCs)
    setProperty(rPr, RPR_ORDER, 'sz', String(Math.round((Number(sz) * 6) / 7)));
}

/** Type sizes (half-points) a run takes from its styles and the document's defaults. */
export interface InheritedSize {
  sz?: string;
  szCs?: string;
}

export interface RebuildOptions {
  targetLang: string;
  breakLongTokens: boolean;
  /** Sizes from the paragraph's and run's styles, by style ids. */
  styleSize?: (paragraphStyle: string | null, runStyle: string | null) => InheritedSize;
}

/**
 * Replaces the paragraph's inline content with the decoded translation. Returns true when
 * long-token breaking changed something (reported as D4).
 */
export function rebuild(
  p: ExtractedParagraph,
  decoded: DecodedRun<RunStyle>[],
  opts: RebuildOptions,
): boolean {
  const doc = p.para.ownerDocument!;
  const ns = p.dialect === 'w' ? W : A;
  const prefix = p.dialect === 'w' ? 'w' : 'a';
  const locale = localeFor(opts.targetLang);
  let d4 = false;

  // Detach everything except paragraph properties.
  const pPr = elementChildren(p.para).find((c) => c.namespaceURI === ns && c.localName === 'pPr');
  // Arabic or Hebrew translated into a left-to-right language reads left to right.
  const turned =
    rightToLeft(p.plain) &&
    !rightToLeft(decoded.map((r) => (r.type === 'text' ? r.text : '')).join(''));
  const turn = turned && p.dialect === 'w';
  if (turn && pPr) {
    setProperty(pPr, PPR_ORDER, 'bidi', '0');
    const mark = elementChildren(pPr).find((c) => is(c, W, 'rPr'));
    if (mark) turnLeftToRight(mark);
  }
  // On a slide the paragraph says it: rtl="1".
  if (turned && p.dialect === 'a' && pPr?.getAttribute('rtl') === '1') pPr.setAttribute('rtl', '0');
  while (p.para.firstChild) p.para.removeChild(p.para.firstChild);
  if (pPr) p.para.appendChild(pPr);
  for (const h of p.head) p.para.appendChild(h);

  // Wrapper elements are recreated as shallow clones; consecutive runs share one clone.
  let openChain: { src: XElement; clone: XElement }[] = [];
  const containerFor = (wrappers: XElement[]): XElement => {
    let i = 0;
    while (i < openChain.length && i < wrappers.length && openChain[i]!.src === wrappers[i]) i++;
    openChain = openChain.slice(0, i);
    let parent: XElement = openChain.length ? openChain[openChain.length - 1]!.clone : p.para;
    for (; i < wrappers.length; i++) {
      const src = wrappers[i]!;
      const clone = src.cloneNode(false) as XElement;
      if (src.localName === 'sdt') {
        const sdtPr = elementChildren(src).find((c) => is(c, W, 'sdtPr'));
        if (sdtPr) clone.appendChild(sdtPr.cloneNode(true));
      }
      parent.appendChild(clone);
      openChain.push({ src, clone });
      parent = clone;
    }
    return parent;
  };

  const styleOfPara =
    (pPr &&
      elementChildren(pPr)
        .find((c) => is(c, W, 'pStyle'))
        ?.getAttributeNS(W, 'val')) ||
    null;
  const cloneRPr = (rPr: XElement | null): XElement | null => {
    // A turned run without properties still takes a Latin size for its styles' Arabic one.
    if (!rPr && !(turn && opts.styleSize)) return null;
    const c = rPr
      ? (rPr.cloneNode(true) as XElement)
      : p.para.ownerDocument!.createElementNS(W, 'w:rPr');
    if (p.dialect === 'w') {
      for (const lang of elementChildren(c).filter((x) => is(x, W, 'lang')))
        lang.setAttributeNS(W, 'w:val', locale);
      if (turn) {
        const runStyle =
          elementChildren(c)
            .find((x) => is(x, W, 'rStyle'))
            ?.getAttributeNS(W, 'val') || null;
        turnLeftToRight(c, opts.styleSize?.(styleOfPara, runStyle));
      }
      if (!rPr && !c.firstChild) return null;
    } else if (c.hasAttribute('lang')) {
      c.setAttribute('lang', locale);
    }
    return c;
  };

  for (const run of decoded) {
    if (run.type === 'text') {
      const style = run.style!;
      let text = run.text.replace(/[\r\n]+/g, ' ');
      if (opts.breakLongTokens) {
        const b = breakLongTokens(text);
        text = b.text;
        d4 ||= b.changed;
      }
      if (!text) continue;
      const parent = containerFor(style.wrappers);
      const r = doc.createElementNS(ns, `${prefix}:r`);
      const rPr = cloneRPr(style.rPr);
      if (rPr) r.appendChild(rPr);
      const t = doc.createElementNS(ns, `${prefix}:t`);
      if (p.dialect === 'w') t.setAttributeNS(NS.xml, 'xml:space', 'preserve');
      t.appendChild(doc.createTextNode(text));
      r.appendChild(t);
      parent.appendChild(r);
    } else {
      const payload = p.atoms[Number(run.placeholder!.ref)]!;
      const parent = containerFor(payload.wrappers);
      if (payload.rPr !== undefined) {
        const r = doc.createElementNS(ns, `${prefix}:r`);
        const rPr = cloneRPr(payload.rPr);
        if (rPr) r.appendChild(rPr);
        r.appendChild(payload.node);
        parent.appendChild(r);
      } else {
        parent.appendChild(payload.node);
      }
    }
  }
  openChain = [];
  for (const t of p.tail) p.para.appendChild(t);
  return d4;
}
