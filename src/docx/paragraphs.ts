import type { Element as XElement, Node as XNode } from '@xmldom/xmldom';
import type { Role } from '../core/ir/types';
import { encode, type DecodedRun, type Encoded, type InlineRun } from '../core/segment/codec';
import type { PlaceholderKind } from '../core/segment/types';
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

/** rPr children that do not change appearance (ignored when comparing styles). */
const IGNORED_RPR = new Set(['lang', 'noProof', 'rPrChange', 'webHidden', 'specVanish']);

function rPrKey(rPr: XElement | null): string {
  if (!rPr) return '';
  return elementChildren(rPr)
    .filter((c) => !IGNORED_RPR.has(c.localName ?? ''))
    .map((c) => {
      const attrs: string[] = [];
      for (let i = 0; i < c.attributes.length; i++) {
        const a = c.attributes.item(i)!;
        attrs.push(`${a.localName}=${a.value}`);
      }
      return `${c.localName}[${attrs.sort().join(',')}]`;
    })
    .sort()
    .join(';');
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
export function extractW(para: XElement, role: Role): ExtractedParagraph {
  const flat: Flat[] = [];
  flattenW(para, [], flat);
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
  const encoded = encode(runs, (s) => s.key);
  const plain = runs
    .filter((r) => r.type === 'text')
    .map((r) => r.text)
    .join('');
  return { para, dialect: 'w', role, encoded, atoms, head, tail, plain };
}

/** Extracts a DrawingML paragraph (charts, SmartArt, shapes). */
export function extractA(para: XElement, role: Role): ExtractedParagraph {
  const runs: InlineRun<RunStyle>[] = [];
  const atoms: AtomPayload[] = [];
  const tail: XNode[] = [];
  for (const el of elementChildren(para)) {
    const name = el.localName ?? '';
    if (el.namespaceURI === A && name === 'pPr') continue;
    if (el.namespaceURI === A && name === 'endParaRPr') {
      tail.push(el);
    } else if (el.namespaceURI === A && name === 'r') {
      const rPr = elementChildren(el).find((c) => is(c, A, 'rPr')) ?? null;
      const t = elementChildren(el).find((c) => is(c, A, 't'));
      runs.push({ type: 'text', text: t?.textContent ?? '', style: styleOf(rPr, []) });
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
  const encoded = encode(runs, (s) => s.key);
  const plain = runs
    .filter((r) => r.type === 'text')
    .map((r) => r.text)
    .join('');
  return { para, dialect: 'a', role, encoded, atoms, head: [], tail, plain };
}

/** w:lang values for target languages. */
const LOCALES: Record<string, string> = {
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-PT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  cs: 'cs-CZ',
  ro: 'ro-RO',
  hu: 'hu-HU',
  sv: 'sv-SE',
  ru: 'ru-RU',
  uk: 'uk-UA',
  bg: 'bg-BG',
  el: 'el-GR',
  tr: 'tr-TR',
};
export const localeFor = (lang: string) => LOCALES[lang] ?? lang;

/** Zero-width space after URL/path separators in long tokens (D4_LONG_TOKEN). */
export function breakLongTokens(text: string, minLength = 25): { text: string; changed: boolean } {
  let changed = false;
  const out = text.replace(new RegExp(`\\S{${minLength},}`, 'g'), (token) => {
    const broken = token.replace(/([/\-_.])(?=\S)/g, `$1${String.fromCharCode(0x200b)}`);
    if (broken !== token) changed = true;
    return broken;
  });
  return { text: out, changed };
}

export interface RebuildOptions {
  targetLang: string;
  breakLongTokens: boolean;
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

  const cloneRPr = (rPr: XElement | null): XElement | null => {
    if (!rPr) return null;
    const c = rPr.cloneNode(true) as XElement;
    if (p.dialect === 'w') {
      for (const lang of elementChildren(c).filter((x) => is(x, W, 'lang')))
        lang.setAttributeNS(W, 'w:val', locale);
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
