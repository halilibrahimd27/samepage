import { REFERENCES_HEADING, referenceProse } from '../core/references';
import type { TermVariance } from '../core/glossary/consistency';
import { termsRenderedTwoWays } from '../core/pipeline/terms';
import { functionWords } from '../core/detectLanguage';
import type { Document as XDocument, Element as XElement } from '@xmldom/xmldom';
import type { TranslationCache } from '../core/cache/cache';
import type { TermText } from '../core/glossary/detect';
import type { Role } from '../core/ir/types';
import { ONE_WORD_LABEL, translateSegments, type ProgressPhase } from '../core/pipeline/translate';
import { decode, plainText, readableText, verbatimOf } from '../core/segment/codec';
import {
  validateTranslation,
  type GlossaryEntry,
  type ValidationIssue,
} from '../core/validate/validate';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { localeFor } from '../core/languages';
import { storedTranslations, type StoredOutcome } from '../core/project';
import { bracketedOutcome, titlesToTranslate, type ReferenceTitle } from '../core/referenceTitles';
import {
  extractA,
  extractW,
  isMono,
  rebuild,
  rightToLeftShare,
  type ExtractedParagraph,
  type RebuildOptions,
} from './paragraphs';
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
  /** Hybrid quality (P9.3): an LLM revises what the meaning check flags. */
  postEditor?: TranslationEngine;
  /** English targets: the spelling LLM engines write. */
  englishSpelling?: 'american' | 'british';
  /** A reopened project's translations, used instead of the engine (P9.5). */
  replay?: Record<string, StoredOutcome>;
  translateComments: boolean;
  translateReferences: boolean;
  /** Reference titles in another language get their translation in brackets (APA 7, P9.6). */
  referenceTitles?: boolean;
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
  /** Terms rendered two ways (segment ids), for the user to make consistent. */
  terms?: TermVariance[];
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

/** A heading's level: its outline level, else the number of its style ("Heading 2"); a title 0. */
function headingLevel(para: XElement): number {
  const pPr = para.getElementsByTagNameNS(NS.w, 'pPr')[0];
  const outline = pPr?.getElementsByTagNameNS(NS.w, 'outlineLvl')[0]?.getAttributeNS(NS.w, 'val');
  if (outline) return Number(outline) + 1;
  const style = pPr?.getElementsByTagNameNS(NS.w, 'pStyle')[0]?.getAttributeNS(NS.w, 'val') ?? '';
  if (/^(?:title|titel)$/i.test(style)) return 0;
  return Number(/(\d)\s*$/u.exec(style)?.[1] ?? 1);
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
): Promise<{
  bytes: Uint8Array;
  report: DocxReport;
  /** Every segment's translation by source text, for the project file (P9.5). */
  translations: Record<string, StoredOutcome>;
}> {
  const format = officeKind(bytes);
  const pkg = await openDocx(bytes, format);
  const parts = discoverParts(Object.keys(pkg.zip.files), opts, format);
  const docs = new Map<string, XDocument>();
  const units: Unit[] = [];
  // Share of Arabic and Hebrew letters in each Word part before translation.
  const rtlBefore = new Map<string, number>();

  for (const { path, kind } of parts) {
    const text = await pkg.readText(path);
    if (text === null) continue;
    const doc = parseXml(text);
    docs.set(path, doc);
    if (kind === 'w') rtlBefore.set(path, rightToLeftShare(doc.documentElement?.textContent ?? ''));
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
      // Level of the heading over the reference list; its sub-headings stay in the list.
      let referencesLevel: number | null = null;
      const paras = Array.from(doc.getElementsByTagNameNS(NS.w, 'p'));
      const code = codeFontIsCode(doc);
      for (const para of paras) {
        const role = wRole(para, path);
        const p = extractW(para, role, { code });
        if (role === 'heading') {
          const level = headingLevel(para);
          if (REFERENCES_HEADING.test(p.plain)) referencesLevel = level;
          else if (referencesLevel !== null && level <= referencesLevel) referencesLevel = null;
        }
        // Only letters outside placeholders count (a cell holding just a URL is not translated).
        if (!hasLetters(plainText(p.encoded.source))) continue;
        const skipped =
          referencesLevel !== null &&
          role !== 'heading' &&
          !opts.translateReferences &&
          !referenceProse(p.plain, functionWords(p.plain, opts.pair.source))
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
        // On a slide a code font marks code: a code slide is mostly code.
        const p = extractA(para, role, { code: true });
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

  // Reference entries stay as published; titles in another language are translated alone and
  // put after the title in brackets (APA 7).
  const titlesOf = new Map<Unit, ReferenceTitle[]>();
  if (opts.referenceTitles && !opts.translateReferences)
    for (const u of units) {
      if (u.skipped !== 'reference') continue;
      const titles = titlesToTranslate(u.source, opts.pair);
      if (titles.length) titlesOf.set(u, titles);
    }

  // Identical sources (e.g. a text box in mc:Choice and mc:Fallback) are translated once.
  const active = units.filter((u) => !u.skipped);
  // A label of one word reads its sense from the paragraph after it, in its part.
  const contextAfter = (k: number): { context?: string } => {
    const u = active[k]!;
    if (!ONE_WORD_LABEL.test(plainText(u.source))) return {};
    const next = active
      .slice(k + 1, k + 4)
      .find(
        (x) => x.part === u.part && (plainText(x.source).match(/\p{L}{2,}/gu) ?? []).length >= 3,
      );
    return next ? { context: plainText(next.source) } : {};
  };
  const uniqueBySource = new Map<string, SegmentRequest>();
  active.forEach((u, k) => {
    if (!uniqueBySource.has(u.source))
      uniqueBySource.set(u.source, {
        id: `s${uniqueBySource.size + 1}`,
        text: u.source,
        role: u.role,
        ...(u.p ? verbatimOf(u.p.encoded.placeholders, opts.pair) : {}),
        ...contextAfter(k),
      });
  });
  for (const t of [...titlesOf.values()].flat())
    if (!uniqueBySource.has(t.title))
      uniqueBySource.set(t.title, {
        id: `s${uniqueBySource.size + 1}`,
        text: t.title,
        role: 'reference',
      });
  const requests = [...uniqueBySource.values()];
  const outcomes = await translateSegments({
    engine: opts.engine,
    segments: requests,
    ctx: {
      pair: opts.pair,
      glossary: opts.glossary,
      numberLocalization: opts.numberLocalization,
      ...(opts.englishSpelling ? { englishSpelling: opts.englishSpelling } : {}),
    },
    signal: opts.signal,
    fidelityCheck: opts.fidelityCheck,
    ...(opts.postEditor ? { postEditor: opts.postEditor } : {}),
    ...(opts.replay ? { replay: opts.replay } : {}),
    localCitations: opts.localCitations ?? false,
    ...(opts.cache ? { cache: opts.cache } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  const outcomeBySource = new Map(requests.map((r, i) => [r.text, outcomes[i]!]));
  for (const [u, titles] of titlesOf) {
    const o = bracketedOutcome(u.source, titles, (t) => outcomeBySource.get(t));
    if (!o) continue;
    outcomeBySource.set(u.source, o);
    delete u.skipped;
  }

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
  const stylesText = format === 'docx' ? await pkg.readText('word/styles.xml') : null;
  const styleSize = stylesText ? sizesOfStyles(parseXml(stylesText)) : undefined;
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
      ...(styleSize ? { styleSize } : {}),
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

  // A part that was right to left and now reads left to right: its sections and tables too.
  for (const [path, before] of rtlBefore) {
    const doc = docs.get(path)!;
    if (before < 0.5 || rightToLeftShare(doc.documentElement?.textContent ?? '') >= 0.2) continue;
    for (const local of ['bidi', 'bidiVisual'])
      for (const el of Array.from(doc.getElementsByTagNameNS(NS.w, local))) {
        const parent = el.parentNode as XElement | null;
        if (parent?.localName === 'sectPr' || parent?.localName === 'tblPr')
          el.setAttributeNS(NS.w, 'w:val', '0');
      }
    touched.add(path);
  }

  // Language of the document defaults → target (spelling/hyphenation in Word).
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

  // Terms rendered two ways, confirmed by the engine (a replay calls no engine).
  const terms = opts.replay
    ? []
    : await termsRenderedTwoWays(
        opts.engine,
        { pair: opts.pair, glossary: opts.glossary, numberLocalization: opts.numberLocalization },
        segReports
          .filter((r) => (r.status === 'translated' || r.status === 'warning') && !r.manual)
          .filter((r) => r.role !== 'reference')
          .map((r) => ({ id: r.id, source: r.source, target: r.target })),
        opts.glossary,
        opts.signal,
      );
  const count = (s: DocxSegmentReport['status']) => segReports.filter((r) => r.status === s).length;
  const repairCounts: DocxReport['summary']['repairs'] = {};
  for (const r of repairs) repairCounts[r.code] = (repairCounts[r.code] ?? 0) + 1;
  return {
    bytes: out,
    translations: storedTranslations(requests, outcomes),
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
      ...(terms.length ? { terms } : {}),
    },
  };
}

/**
 * Whether a code font marks code in this document: not when nearly all its text is set in one (a
 * typescript in Courier), where it is the document's own face. A lab sheet or a tutorial may be
 * half code.
 */
/**
 * The type sizes a run takes from its character style, its paragraph's style (each along its
 * basedOn chain) and the document's defaults: half-points of Latin and complex-script text.
 */
function sizesOfStyles(styles: XDocument): NonNullable<RebuildOptions['styleSize']> {
  const byId = new Map<string, XElement>();
  for (const st of Array.from(styles.getElementsByTagNameNS(NS.w, 'style')))
    byId.set(st.getAttributeNS(NS.w, 'styleId') ?? '', st);
  const own = (el: XElement | undefined | null, local: string) => {
    const rPr = el
      ? Array.from(el.childNodes).find(
          (c): c is XElement => c.nodeType === 1 && (c as XElement).localName === 'rPr',
        )
      : undefined;
    return rPr?.getElementsByTagNameNS(NS.w, local)[0]?.getAttributeNS(NS.w, 'val') || undefined;
  };
  const chain = (id: string | null, local: string): string | undefined => {
    for (let k = 0, at = id; at && k < 10; k++) {
      const st = byId.get(at);
      if (!st) return undefined;
      const v = own(st, local);
      if (v) return v;
      at = st.getElementsByTagNameNS(NS.w, 'basedOn')[0]?.getAttributeNS(NS.w, 'val') ?? null;
    }
    return undefined;
  };
  const defaults = styles.getElementsByTagNameNS(NS.w, 'rPrDefault')[0];
  const normal = Array.from(byId.values()).find(
    (st) =>
      st.getAttributeNS(NS.w, 'type') === 'paragraph' &&
      /^(?:1|true)$/u.test(st.getAttributeNS(NS.w, 'default') ?? ''),
  );
  const size = (paragraphStyle: string | null, runStyle: string | null, local: string) =>
    chain(runStyle, local) ??
    chain(paragraphStyle ?? normal?.getAttributeNS(NS.w, 'styleId') ?? null, local) ??
    own(defaults, local);
  return (paragraphStyle, runStyle) => {
    const sz = size(paragraphStyle, runStyle, 'sz');
    const szCs = size(paragraphStyle, runStyle, 'szCs');
    return { ...(sz ? { sz } : {}), ...(szCs ? { szCs } : {}) };
  };
}

function codeFontIsCode(doc: XDocument): boolean {
  let mono = 0;
  let all = 0;
  for (const run of Array.from(doc.getElementsByTagNameNS(NS.w, 'r'))) {
    const n = Array.from(run.getElementsByTagNameNS(NS.w, 't')).reduce(
      (k, t) => k + (t.textContent ?? '').trim().length,
      0,
    );
    if (!n) continue;
    all += n;
    const rPr = run.getElementsByTagNameNS(NS.w, 'rPr')[0] ?? null;
    if (isMono(rPr)) mono += n;
  }
  return all > 0 && mono < 0.8 * all;
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
