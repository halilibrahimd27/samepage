import { REFERENCES_HEADING } from '../core/references';
import type { Document as XDocument, Element as XElement } from '@xmldom/xmldom';
import type { TranslationCache } from '../core/cache/cache';
import type { TermText } from '../core/glossary/detect';
import type { Role } from '../core/ir/types';
import { translateSegments, type ProgressPhase } from '../core/pipeline/translate';
import { decode, plainText, readableText, verbatimOf } from '../core/segment/codec';
import {
  validateTranslation,
  type GlossaryEntry,
  type ValidationIssue,
} from '../core/validate/validate';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { extractA, extractW, localeFor, rebuild, type ExtractedParagraph } from './paragraphs';
import { inFixedTableCell, repairContainers, type DocxRepair } from './repair';
import { fitSlideText, slideRole, textBodyOf } from './pptx';
import { officeKind, openDocx, type OfficeKind } from './unzip';
import { NS, parseXml, serializeXml } from './xml';

export interface DocxOptions {
  engine: TranslationEngine;
  pair: LangPair;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  /** "et al." in citations the target language's way. */
  localCitations?: boolean;
  translateComments: boolean;
  translateReferences: boolean;
  translateMetadata: boolean;
  cache?: TranslationCache;
  signal: AbortSignal;
  onProgress?: (done: number, total: number, phase?: ProgressPhase) => void;
  /** Manual corrections from the review step: tagged source → tagged target (reported as manual). */
  overrides?: Record<string, string>;
}

export interface DocxSegmentReport {
  id: string;
  part: string;
  role: Role;
  source: string;
  target: string;
  status: 'translated' | 'warning' | 'untranslated' | 'skipped';
  cached: boolean;
  /** Edited by the user in the review step. */
  manual: boolean;
  issues: ValidationIssue[];
  /** Tagged text, for the review editor. */
  sourceTagged: string;
  targetTagged: string;
  /** The translation translated back (meaning check), for the side-by-side review. */
  back?: string;
}

export interface DocxReport {
  summary: {
    segments: number;
    translated: number;
    warnings: number;
    untranslated: number;
    skipped: number;
    cached: number;
    manual: number;
    repairs: Partial<Record<DocxRepair['code'], number>>;
  };
  segments: DocxSegmentReport[];
  repairs: DocxRepair[];
}

/** Parts that carry translatable text (ARCHITECTURE.md §4.2). */
type PartKind = 'w' | 'chart' | 'diagram' | 'core' | 'slide' | 'notes';

/** "slide10.xml" after "slide9.xml". */
const naturalKey = (path: string) => path.replace(/\d+/g, (d) => d.padStart(6, '0'));

function discoverParts(
  paths: string[],
  opts: DocxOptions,
  format: OfficeKind,
): { path: string; kind: PartKind }[] {
  const out: { path: string; kind: PartKind }[] = [];
  const sorted = [...paths].sort((a, b) => naturalKey(a).localeCompare(naturalKey(b)));
  if (format === 'pptx') {
    for (const path of sorted) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) out.push({ path, kind: 'slide' });
      else if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path))
        out.push({ path, kind: 'notes' });
      else if (/^ppt\/charts\/chart\d+\.xml$/.test(path)) out.push({ path, kind: 'chart' });
      else if (/^ppt\/diagrams\/(data|drawing)\d+\.xml$/.test(path))
        out.push({ path, kind: 'diagram' });
      else if (path === 'docProps/core.xml' && opts.translateMetadata)
        out.push({ path, kind: 'core' });
    }
    return out;
  }
  for (const path of sorted) {
    if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(path))
      out.push({ path, kind: 'w' });
    else if (path === 'word/comments.xml' && opts.translateComments) out.push({ path, kind: 'w' });
    else if (/^word\/charts\/chart\d+\.xml$/.test(path)) out.push({ path, kind: 'chart' });
    else if (/^word\/diagrams\/(data|drawing)\d+\.xml$/.test(path))
      out.push({ path, kind: 'diagram' });
    else if (path === 'docProps/core.xml' && opts.translateMetadata)
      out.push({ path, kind: 'core' });
  }
  return out;
}

function wRole(para: XElement, part: string): Role {
  if (/header/.test(part)) return 'header';
  if (/footer/.test(part)) return 'footer';
  if (/footnotes|endnotes/.test(part)) return 'footnote';
  const pPr = para.getElementsByTagNameNS(NS.w, 'pPr')[0];
  const style = pPr?.getElementsByTagNameNS(NS.w, 'pStyle')[0]?.getAttributeNS(NS.w, 'val') ?? '';
  if (
    /heading|başlık|title|titel|überschrift|заголовок/i.test(style) ||
    pPr?.getElementsByTagNameNS(NS.w, 'outlineLvl').length
  ) {
    return 'heading';
  }
  if (/caption|resimyazısı|beschriftung|название/i.test(style)) return 'caption';
  for (let n = para.parentNode; n; n = n.parentNode) {
    if ((n as XElement).localName === 'tc' && (n as XElement).namespaceURI === NS.w)
      return 'table-cell';
  }
  return 'body';
}

const hasLetters = (s: string) => /\p{L}/u.test(s);

/**
 * Keeps a manual edit structurally valid without losing content: placeholders the user deleted
 * (footnote marks, formulas…) are appended again, unknown tags/placeholders are dropped. The
 * validator still reports the change as a warning.
 */
export function repairManual(source: string, target: string): string {
  const ids = (text: string, re: RegExp) => new Set([...text.matchAll(re)].map((m) => m[1]!));
  const srcPh = ids(source, /⟦([A-Z]\d+)⟧/g);
  const srcTags = ids(source, /<(t\d+)>/g);
  let out = target
    .replace(/⟦([A-Z]\d+)⟧/g, (m, id: string) => (srcPh.has(id) ? m : ''))
    .replace(/<\/?(t\d+)>/g, (m, id: string) => (srcTags.has(id) ? m : ''));
  const present = ids(out, /⟦([A-Z]\d+)⟧/g);
  for (const id of srcPh) if (!present.has(id)) out += ` ⟦${id}⟧`;
  return out;
}

/** Manual edits are validated like engine output; structural errors are reported, never fixed silently. */
function manualIssues(source: string, target: string, opts: DocxOptions): ValidationIssue[] {
  return validateTranslation({
    source,
    target,
    sourceLang: opts.pair.source,
    targetLang: opts.pair.target,
    glossary: opts.glossary,
    checkLanguage: false,
  }).map((i) => ({ ...i, severity: 'warning' as const }));
}

interface Unit {
  id: string;
  part: string;
  p?: ExtractedParagraph;
  /** Plain-text cells: chart string caches and document title. */
  textNode?: XElement;
  /** The slide shape's text body (PPTX), fitted when the translation is longer. */
  body?: XElement;
  role: Role;
  source: string;
  skipped?: 'reference';
}

export async function translateDocx(
  bytes: Uint8Array,
  opts: DocxOptions,
): Promise<{ bytes: Uint8Array; report: DocxReport }> {
  const format = officeKind(bytes);
  const pkg = await openDocx(bytes, format);
  const parts = discoverParts(Object.keys(pkg.zip.files), opts, format);
  const docs = new Map<string, XDocument>();
  const units: Unit[] = [];

  for (const { path, kind } of parts) {
    const text = await pkg.readText(path);
    if (text === null) continue;
    const doc = parseXml(text);
    docs.set(path, doc);
    if (kind === 'core') {
      const title = doc.getElementsByTagNameNS(NS.dc, 'title')[0];
      if (title && hasLetters(title.textContent ?? '')) {
        units.push({
          id: `u${units.length + 1}`,
          part: path,
          textNode: title,
          role: 'heading',
          source: title.textContent ?? '',
        });
      }
      continue;
    }
    if (kind === 'w') {
      let inReferences = false;
      const paras = Array.from(doc.getElementsByTagNameNS(NS.w, 'p'));
      for (const para of paras) {
        const role = wRole(para, path);
        const p = extractW(para, role);
        if (role === 'heading') inReferences = REFERENCES_HEADING.test(p.plain);
        // Only letters outside placeholders count (a cell holding just a URL is not translated).
        if (!hasLetters(plainText(p.encoded.source))) continue;
        const skipped =
          inReferences && role !== 'heading' && !opts.translateReferences
            ? ('reference' as const)
            : undefined;
        units.push({
          id: `u${units.length + 1}`,
          part: path,
          p,
          role: skipped ? 'reference' : role,
          source: p.encoded.source,
          ...(skipped ? { skipped } : {}),
        });
      }
    } else if (kind === 'slide' || kind === 'notes') {
      for (const para of Array.from(doc.getElementsByTagNameNS(NS.a, 'p'))) {
        const role = slideRole(para);
        const p = extractA(para, role);
        if (!hasLetters(plainText(p.encoded.source))) continue;
        const body = kind === 'slide' ? textBodyOf(para) : null;
        units.push({
          id: `u${units.length + 1}`,
          part: path,
          p,
          role,
          source: p.encoded.source,
          ...(body ? { body } : {}),
        });
      }
    } else {
      for (const para of Array.from(doc.getElementsByTagNameNS(NS.a, 'p'))) {
        const p = extractA(para, 'label');
        if (hasLetters(p.plain))
          units.push({
            id: `u${units.length + 1}`,
            part: path,
            p,
            role: 'label',
            source: p.encoded.source,
          });
      }
      if (kind === 'chart') {
        for (const cache of Array.from(doc.getElementsByTagNameNS(NS.c, 'strCache'))) {
          for (const v of Array.from(cache.getElementsByTagNameNS(NS.c, 'v'))) {
            if (hasLetters(v.textContent ?? '')) {
              units.push({
                id: `u${units.length + 1}`,
                part: path,
                textNode: v,
                role: 'label',
                source: v.textContent ?? '',
              });
            }
          }
        }
      }
    }
  }

  // Identical sources (e.g. a text box in mc:Choice and mc:Fallback) are translated once.
  const active = units.filter((u) => !u.skipped);
  const uniqueBySource = new Map<string, SegmentRequest>();
  for (const u of active) {
    if (!uniqueBySource.has(u.source))
      uniqueBySource.set(u.source, {
        id: `s${uniqueBySource.size + 1}`,
        text: u.source,
        role: u.role,
        ...(u.p ? verbatimOf(u.p.encoded.placeholders) : {}),
      });
  }
  const requests = [...uniqueBySource.values()];
  const outcomes = await translateSegments({
    engine: opts.engine,
    segments: requests,
    ctx: { pair: opts.pair, glossary: opts.glossary, numberLocalization: opts.numberLocalization },
    signal: opts.signal,
    fidelityCheck: opts.fidelityCheck,
    localCitations: opts.localCitations ?? false,
    ...(opts.cache ? { cache: opts.cache } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  const outcomeBySource = new Map(requests.map((r, i) => [r.text, outcomes[i]!]));

  // Apply in reverse document order so nested paragraphs (text boxes) are rebuilt before the
  // paragraph whose drawing contains them is moved.
  const repairs: DocxRepair[] = [];
  const touched = new Set<string>();
  const translatedByPart = new Map<string, XElement[]>();
  /** Text length of each slide text body before and after translation (PPTX fitting). */
  const bodies = new Map<string, Map<XElement, { source: number; target: number }>>();
  for (const u of units) {
    if (!u.body) continue;
    const byBody = bodies.get(u.part) ?? new Map<XElement, { source: number; target: number }>();
    const entry = byBody.get(u.body) ?? { source: 0, target: 0 };
    const length = plainText(u.source).length;
    entry.source += length;
    entry.target += length; // replaced below by the translation's length
    byBody.set(u.body, entry);
    bodies.set(u.part, byBody);
  }
  const segReports: DocxSegmentReport[] = [];
  for (const u of [...units].reverse()) {
    if (u.skipped) {
      segReports.push({
        id: u.id,
        part: u.part,
        role: u.role,
        source: readableText(u.source, u.p?.encoded.placeholders),
        target: '',
        status: 'skipped',
        cached: false,
        manual: false,
        issues: [],
        sourceTagged: u.source,
        targetTagged: '',
      });
      continue;
    }
    const rawManual = opts.overrides?.[u.source];
    const manualText = rawManual === undefined ? undefined : repairManual(u.source, rawManual);
    const base = outcomeBySource.get(u.source)!;
    const o =
      manualText !== undefined
        ? {
            ...base,
            text: manualText,
            untranslated: false,
            issues: manualIssues(u.source, rawManual!, opts),
          }
        : base;
    const status = o.untranslated
      ? 'untranslated'
      : o.issues.some((i) => i.severity !== 'info')
        ? 'warning'
        : 'translated';
    segReports.push({
      id: u.id,
      part: u.part,
      role: u.role,
      source: readableText(u.source, u.p?.encoded.placeholders),
      target: o.untranslated ? '' : readableText(o.text, u.p?.encoded.placeholders),
      status,
      cached: o.cached,
      manual: manualText !== undefined,
      issues: o.issues,
      sourceTagged: u.source,
      targetTagged: o.untranslated ? '' : o.text,
      // The back-translation is of the engine's text, not of a manual edit.
      ...(o.back && manualText === undefined ? { back: o.back } : {}),
    });
    if (o.untranslated) continue; // the original paragraph stays untouched
    touched.add(u.part);
    if (u.body) {
      const entry = bodies.get(u.part)!.get(u.body)!;
      entry.target += plainText(o.text).length - plainText(u.source).length;
    }
    if (u.textNode) {
      while (u.textNode.firstChild) u.textNode.removeChild(u.textNode.firstChild);
      u.textNode.appendChild(u.textNode.ownerDocument!.createTextNode(plainText(o.text)));
      continue;
    }
    const p = u.p!;
    const fixed = p.dialect === 'w' && inFixedTableCell(p.para);
    const d4 = rebuild(p, decode(o.text, p.encoded), {
      targetLang: opts.pair.target,
      breakLongTokens: fixed,
    });
    if (d4)
      repairs.push({
        code: 'D4_LONG_TOKEN',
        part: u.part,
        detail: `zero-width breaks added to long tokens in a fixed-width table cell (${u.id})`,
      });
    const list = translatedByPart.get(u.part) ?? [];
    list.push(p.para);
    translatedByPart.set(u.part, list);
  }
  segReports.reverse();
  for (const [part, paras] of [...translatedByPart].sort(([a], [b]) => a.localeCompare(b)))
    repairs.push(...repairContainers(part, paras));
  for (const [part, byBody] of [...bodies].sort(([a], [b]) =>
    naturalKey(a).localeCompare(naturalKey(b)),
  ))
    repairs.push(...fitSlideText(part, byBody));

  // Language of the document defaults → target (spelling/hyphenation in Word).
  const stylesText = format === 'docx' ? await pkg.readText('word/styles.xml') : null;
  if (stylesText) {
    const styles = parseXml(stylesText);
    for (const lang of Array.from(styles.getElementsByTagNameNS(NS.w, 'lang'))) {
      if (lang.hasAttributeNS(NS.w, 'val'))
        lang.setAttributeNS(NS.w, 'w:val', localeFor(opts.pair.target));
    }
    docs.set('word/styles.xml', styles);
    touched.add('word/styles.xml');
  }

  // Only changed parts are re-serialised; every other entry is copied unchanged.
  for (const path of [...touched].sort()) pkg.zip.file(path, serializeXml(docs.get(path)!));
  const out = await pkg.zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const count = (s: DocxSegmentReport['status']) => segReports.filter((r) => r.status === s).length;
  const repairCounts: DocxReport['summary']['repairs'] = {};
  for (const r of repairs) repairCounts[r.code] = (repairCounts[r.code] ?? 0) + 1;
  return {
    bytes: out,
    report: {
      summary: {
        segments: segReports.length,
        translated: count('translated'),
        warnings: count('warning'),
        untranslated: count('untranslated'),
        skipped: count('skipped'),
        cached: segReports.filter((r) => r.cached).length,
        manual: segReports.filter((r) => r.manual).length,
        repairs: repairCounts,
      },
      segments: segReports,
      repairs,
    },
  };
}

/** Plain text of the document's paragraphs, for glossary suggestions. */
const MONO_FONT =
  /mono|courier|consolas|menlo|monaco|inconsolata|source code|fira code|lucida console/i;

/** A run set in a code font, directly or through a character style ("HTML Code", "Verbatim"). */
function isMono(rPr: XElement | null): boolean {
  if (!rPr) return false;
  const font =
    rPr.getElementsByTagNameNS(NS.w, 'rFonts')[0]?.getAttributeNS(NS.w, 'ascii') ??
    rPr.getElementsByTagNameNS(NS.a, 'latin')[0]?.getAttribute('typeface') ??
    '';
  const style = rPr.getElementsByTagNameNS(NS.w, 'rStyle')[0]?.getAttributeNS(NS.w, 'val') ?? '';
  return MONO_FONT.test(font) || /code|verbatim|monospace/i.test(style);
}

/** The text parts of a Word or PowerPoint package and their paragraphs (samples, terms, abstract). */
async function bodyParagraphs(
  bytes: Uint8Array,
): Promise<{ para: XElement; extracted: ExtractedParagraph; role: Role }[]> {
  const format = officeKind(bytes);
  const pkg = await openDocx(bytes, format);
  const paths =
    format === 'docx'
      ? ['word/document.xml']
      : Object.keys(pkg.zip.files)
          .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
          .sort((a, b) => naturalKey(a).localeCompare(naturalKey(b)));
  const out: { para: XElement; extracted: ExtractedParagraph; role: Role }[] = [];
  for (const path of paths) {
    const text = await pkg.readText(path);
    if (!text) continue;
    const doc = parseXml(text);
    if (format === 'docx') {
      for (const para of Array.from(doc.getElementsByTagNameNS(NS.w, 'p'))) {
        const role = wRole(para, path);
        out.push({ para, extracted: extractW(para, 'body'), role });
      }
    } else {
      for (const para of Array.from(doc.getElementsByTagNameNS(NS.a, 'p'))) {
        const role = slideRole(para);
        out.push({ para, extracted: extractA(para, role), role });
      }
    }
  }
  return out.filter((p) => hasLetters(p.extracted.plain));
}

/** Paragraph texts with the pieces set in a code font (term suggestions). */
export async function docxTermTexts(bytes: Uint8Array): Promise<TermText[]> {
  return (await bodyParagraphs(bytes)).map(({ extracted }) => ({
    text: extracted.plain,
    mono: decode(extracted.encoded.source, extracted.encoded)
      .filter((r) => r.type === 'text' && isMono(r.style?.rPr ?? null))
      .map((r) => r.text),
  }));
}

export async function docxParagraphs(bytes: Uint8Array): Promise<{ text: string; role: Role }[]> {
  return (await bodyParagraphs(bytes)).map(({ extracted, role }) => ({
    text: extracted.plain,
    role,
  }));
}
