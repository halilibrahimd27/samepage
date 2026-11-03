import type { Element as XElement, Node as XNode } from '@xmldom/xmldom';
import { parseXml } from '../../docx/xml';
import type { LangPair } from '../../engines/types';
import { TMX_LIMITS } from '../../security/limits';
import { tokenize } from '../segment/codec';
import type { PlaceholderKind } from '../segment/types';
import { byPairAndSource, fitsSource, type MemoryEntry } from './memory';

/**
 * TMX 1.4b, the exchange format of translation memories (OmegaT, Trados, memoQ). Inline codes
 * travel as TMX's own: a tag pair as `<bpt>`/`<ept>`, a placeholder as `<ph>`, each holding
 * samepage's code ("<t1>", "⟦F1⟧") so that other tools keep it and samepage reads it back.
 */

/** TMX types of the placeholders, so other tools show what each one stands for. */
const PH_TYPE: Record<PlaceholderKind, string> = {
  F: 'x-formula',
  N: 'fnote',
  U: 'x-link',
  C: 'x-code',
  I: 'image',
  T: 'x-tab',
  B: 'lb',
  R: 'x-field',
  L: 'x-literal',
  G: 'x-term',
};
/** Another tool's `<ph>` of these types is read as that placeholder. */
const KIND_OF_TYPE: Record<string, PlaceholderKind> = {
  ...Object.fromEntries(Object.entries(PH_TYPE).map(([k, v]) => [v, k as PlaceholderKind])),
  enote: 'N',
};
/** A character XML cannot hold, written as its code point ("U+000B"). */
const CHAR_TYPE = 'x-samepage-char';
const ORIGIN_PROP = 'x-samepage-origin';

/** Control characters XML 1.0 cannot hold even as references, and lone surrogates. */
// eslint-disable-next-line no-control-regex
const UNWRITABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/gu;
const UNWRITABLE_CHAR = new RegExp(`^${UNWRITABLE.source}$`, 'u');

/** Carriage returns as references: a parser would read a raw one as a line feed. */
const escapeText = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
const escapeAttr = (t: string) => escapeText(t).replace(/"/g, '&quot;');

function textXml(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(UNWRITABLE)) {
    const code = m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
    out += `${escapeText(text.slice(last, m.index))}<ph type="${CHAR_TYPE}">U+${code}</ph>`;
    last = m.index + m[0].length;
  }
  return out + escapeText(text.slice(last));
}

/** A tagged text as a `<seg>`'s content; `x` numbers each code the same in both languages. */
function segXml(tagged: string, x: Map<string, number>): string {
  const xOf = (id: string) => {
    if (!x.has(id)) x.set(id, x.size + 1);
    return x.get(id)!;
  };
  let out = '';
  let pairs = 0;
  const open: number[] = [];
  for (const t of tokenize(tagged)) {
    if (t.type === 'text') out += textXml(t.text);
    else if (t.type === 'open') {
      open.push(++pairs);
      out += `<bpt i="${pairs}" x="${xOf(t.id)}">&lt;${t.id}&gt;</bpt>`;
    } else if (t.type === 'close')
      out += `<ept i="${open.pop() ?? ++pairs}">&lt;/${t.id}&gt;</ept>`;
    else {
      const type = PH_TYPE[t.id[0] as PlaceholderKind] ?? 'x-placeholder';
      out += `<ph x="${xOf(t.id)}" type="${type}">⟦${t.id}⟧</ph>`;
    }
  }
  return out;
}

/** "20261103T091500Z" (TMX's ISO 8601 form, always UTC). */
function tmxDate(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : 0).toISOString().replace(/[-:]|\.\d{3}/g, '');
}

function tmxTime(value: string | null): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value?.trim() ?? '');
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const time = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The entries as a TMX 1.4b file, in a fixed order (language pair, then source): the same
 * memory always gives the same file.
 */
export function writeTmx(entries: MemoryEntry[], toolVersion: string): string {
  const sorted = [...entries].sort(byPairAndSource);
  const sources = new Set(sorted.map((e) => e.pair.source));
  const srclang = sources.size === 1 ? [...sources][0]! : '*all*';
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<tmx version="1.4">',
    `  <header creationtool="samepage" creationtoolversion="${escapeAttr(toolVersion)}" segtype="paragraph" o-tmf="samepage" adminlang="en" srclang="${escapeAttr(srclang)}" datatype="unknown"/>`,
    '  <body>',
  ];
  for (const e of sorted) {
    const x = new Map<string, number>();
    const date = tmxDate(e.updated);
    const [from, to] = [escapeAttr(e.pair.source), escapeAttr(e.pair.target)];
    lines.push(
      `    <tu srclang="${from}" creationdate="${date}" changedate="${date}">`,
      `      <prop type="${ORIGIN_PROP}">${e.origin}</prop>`,
      `      <tuv xml:lang="${from}"><seg>${segXml(e.source, x)}</seg></tuv>`,
      `      <tuv xml:lang="${to}"><seg>${segXml(e.target, x)}</seg></tuv>`,
      '    </tu>',
    );
  }
  lines.push('  </body>', '</tmx>', '');
  return lines.join('\n');
}

/** "en-US", "EN_gb", "tr" → the language ("en", "tr"); null for no language code ("*all*"). */
export function baseLanguage(code: string | null | undefined): string | null {
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/i.exec(code?.trim() ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * The text of a TMX file: UTF-16 when its byte-order mark says so (older Trados exports), the
 * encoding its declaration names, else UTF-8.
 */
export function tmxText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const declared = /<\?xml[^>]*\bencoding=["']([\w.:-]+)["']/u.exec(
    new TextDecoder('latin1').decode(bytes.subarray(0, 200)),
  )?.[1];
  try {
    return new TextDecoder(declared && !/^utf-?16/i.test(declared) ? declared : 'utf-8').decode(
      bytes,
    );
  } catch {
    // An encoding the browser does not know.
    return new TextDecoder().decode(bytes);
  }
}

/** One translation unit read from a TMX file. */
export interface TmxUnit {
  pair: LangPair;
  source: string;
  target: string;
  /** The unit's change (or creation) date; undefined when it has none. */
  updated?: number;
}

export interface TmxRead {
  units: TmxUnit[];
  /** `<tu>`s that gave nothing: no second language, codes that cannot be mapped, over the limit… */
  skipped: number;
}

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;

const childElements = (el: XNode, name: string): XElement[] =>
  Array.from(el.childNodes).filter(
    (n): n is XElement => n.nodeType === ELEMENT && (n as XElement).localName === name,
  );

/**
 * The inline codes of one unit, the same in each of its languages: samepage's own ("<t1>",
 * "⟦F1⟧"), or another tool's, numbered in the order the source shows them and matched across
 * the languages by their `x` attribute (a tag pair's `i` when it has none).
 */
class Codes {
  private readonly byKey = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  own = false;
  foreign = false;

  id(key: string, prefix: string, assign: boolean): string | null {
    const known = this.byKey.get(key);
    if (known || !assign) return known ?? null;
    const n = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, n);
    this.byKey.set(key, `${prefix}${n}`);
    return `${prefix}${n}`;
  }
}

/** A `<seg>` as tagged text; null when it holds something samepage cannot represent. */
function readSeg(seg: XElement | undefined, codes: Codes, assign: boolean): string | null {
  if (!seg) return null;
  let out = '';
  /** Tag pairs opened in this segment: their `i` → tag id. */
  const opened = new Map<string, string>();
  const visit = (node: XNode): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT || child.nodeType === CDATA) {
        const text = child.nodeValue ?? '';
        // Text that reads as samepage's own codes could not be told from them.
        if (/[⟦⟧]|<\/?t\d+>/u.test(text)) return false;
        out += text;
        continue;
      }
      // Comments and processing instructions are no content.
      if (child.nodeType !== ELEMENT) continue;
      const el = child as XElement;
      const code = el.textContent ?? '';
      const i = el.getAttribute('i') || '';
      const x = el.getAttribute('x') || '';
      if (el.localName === 'hi') {
        // Highlighted text: its words, inline codes included.
        if (!visit(el)) return false;
      } else if (el.localName === 'bpt') {
        const own = /^<(t\d+)>$/u.exec(code)?.[1];
        const id = own ?? codes.id(`tag:${x || `i${i}`}`, 't', assign);
        if (!id) return false;
        if (own) codes.own = true;
        else codes.foreign = true;
        opened.set(i, id);
        out += `<${id}>`;
      } else if (el.localName === 'ept') {
        const id = /^<\/(t\d+)>$/u.exec(code)?.[1] ?? opened.get(i);
        if (!id) return false;
        out += `</${id}>`;
      } else if (el.localName === 'ph') {
        const type = el.getAttribute('type') || '';
        if (type === CHAR_TYPE) {
          const point = parseInt(/^U\+([0-9A-F]{4,6})$/iu.exec(code.trim())?.[1] ?? '', 16);
          const char = point <= 0x10ffff ? String.fromCodePoint(point) : '';
          // Only a character the export had to write so (never "<", "⟦" or a letter).
          if (!UNWRITABLE_CHAR.test(char)) return false;
          out += char;
          continue;
        }
        const own = /^⟦([A-Z]\d+)⟧$/u.exec(code)?.[1];
        const kind = Object.hasOwn(KIND_OF_TYPE, type) ? KIND_OF_TYPE[type] : undefined;
        const id = own ?? (kind && x ? codes.id(`ph:${x}`, kind, assign) : null);
        if (!id) return false;
        if (own) codes.own = true;
        else codes.foreign = true;
        out += `⟦${id}⟧`;
      } else return false; // <it>, <ut>, a stray <sub>: no samepage code stands for them
    }
    return true;
  };
  // Codes of samepage and of another tool in one unit could share an id.
  return visit(seg) && !(codes.own && codes.foreign) ? out : null;
}

function readUnit(tu: XElement, headerLang: string | null, maxChars: number): TmxUnit[] {
  const tuvs = childElements(tu, 'tuv').flatMap((tuv) => {
    const lang = baseLanguage(tuv.getAttribute('xml:lang') || tuv.getAttribute('lang'));
    return lang ? [{ lang, seg: childElements(tuv, 'seg')[0] }] : [];
  });
  const srcLang = baseLanguage(tu.getAttribute('srclang')) ?? headerLang;
  const src = tuvs.find((t) => t.lang === srcLang) ?? tuvs[0];
  if (!src || tuvs.length < 2) return [];
  const codes = new Codes();
  const source = readSeg(src.seg, codes, true);
  if (source === null || source.length > maxChars || !fitsSource(source, source)) return [];
  const updated =
    tmxTime(tu.getAttribute('changedate')) ?? tmxTime(tu.getAttribute('creationdate'));
  const out: TmxUnit[] = [];
  for (const t of tuvs) {
    // One translation per language (en-US and en-GB are both English: the first is taken).
    if (t.lang === src.lang || out.some((u) => u.pair.target === t.lang)) continue;
    const target = readSeg(t.seg, codes, false);
    if (target === null || target.length > maxChars || !fitsSource(source, target)) continue;
    out.push({
      pair: { source: src.lang, target: t.lang },
      source,
      target,
      ...(updated !== undefined ? { updated } : {}),
    });
  }
  return out;
}

/**
 * Reads an untrusted TMX file: null when it is none (or holds entity declarations, which a
 * translation memory never needs). Units are read up to the limit; those that give nothing are
 * counted, never guessed at.
 */
export function readTmx(
  text: string,
  limits: { maxBytes: number; maxUnits: number; maxSegmentChars: number } = TMX_LIMITS,
): TmxRead | null {
  if (text.length > limits.maxBytes || !/<tmx[\s>]/.test(text.slice(0, 8000))) return null;
  if (/<!ENTITY/i.test(text)) return null;
  let root: XElement | null;
  try {
    // DOCTYPEs are stripped: no entity is resolved, no DTD fetched.
    root = parseXml(text).documentElement;
  } catch {
    return null;
  }
  const body = root?.localName === 'tmx' ? childElements(root, 'body')[0] : undefined;
  if (!root || !body) return null;
  const headerLang = baseLanguage(childElements(root, 'header')[0]?.getAttribute('srclang'));
  const tus = childElements(body, 'tu');
  const units: TmxUnit[] = [];
  let skipped = Math.max(0, tus.length - limits.maxUnits);
  for (const tu of tus.slice(0, limits.maxUnits)) {
    const read = readUnit(tu, headerLang, limits.maxSegmentChars);
    if (read.length) units.push(...read);
    else skipped++;
  }
  return { units, skipped };
}
