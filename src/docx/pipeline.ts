import type { Document as XDocument, Element as XElement } from '@xmldom/xmldom';
import type { TranslationCache } from '../core/cache/cache';
import type { Role } from '../core/ir/types';
import { translateSegments } from '../core/pipeline/translate';
import { decode, plainText, readableText, verbatimOf } from '../core/segment/codec';
import {
  validateTranslation,
  type GlossaryEntry,
  type ValidationIssue,
} from '../core/validate/validate';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { extractA, extractW, localeFor, rebuild, type ExtractedParagraph } from './paragraphs';
import { inFixedTableCell, repairContainers, type DocxRepair } from './repair';
import { openDocx } from './unzip';
import { NS, parseXml, serializeXml } from './xml';

export interface DocxOptions {
  engine: TranslationEngine;
  pair: LangPair;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  translateComments: boolean;
  translateReferences: boolean;
  translateMetadata: boolean;
  cache?: TranslationCache;
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
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
function discoverParts(
  paths: string[],
  opts: DocxOptions,
): { path: string; kind: 'w' | 'chart' | 'diagram' | 'core' }[] {
  const out: { path: string; kind: 'w' | 'chart' | 'diagram' | 'core' }[] = [];
  for (const path of [...paths].sort()) {
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

const REFERENCES_HEADING =
  /^\s*(\d+[.)]?\s*)?(kaynak(ça|lar)|references|bibliography|literatur(verzeichnis)?|literatür|литература|список литературы|bibliographie|références|bibliografía|riferimenti)\s*$/i;

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
  role: Role;
  source: string;
  skipped?: 'reference';
}

export async function translateDocx(
  bytes: Uint8Array,
  opts: DocxOptions,
): Promise<{ bytes: Uint8Array; report: DocxReport }> {
  const pkg = await openDocx(bytes);
  const parts = discoverParts(Object.keys(pkg.zip.files), opts);
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
    ...(opts.cache ? { cache: opts.cache } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  const outcomeBySource = new Map(requests.map((r, i) => [r.text, outcomes[i]!]));

  // Apply in reverse document order so nested paragraphs (text boxes) are rebuilt before the
  // paragraph whose drawing contains them is moved.
  const repairs: DocxRepair[] = [];
  const touched = new Set<string>();
  const translatedByPart = new Map<string, XElement[]>();
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
    const status = o.untranslated ? 'untranslated' : o.issues.length ? 'warning' : 'translated';
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
    });
    if (o.untranslated) continue; // the original paragraph stays untouched
    touched.add(u.part);
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

  // Language of the document defaults → target (spelling/hyphenation in Word).
  const stylesText = await pkg.readText('word/styles.xml');
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
export async function docxParagraphs(bytes: Uint8Array): Promise<{ text: string; role: Role }[]> {
  const pkg = await openDocx(bytes);
  const text = await pkg.readText('word/document.xml');
  if (!text) return [];
  const doc = parseXml(text);
  return Array.from(doc.getElementsByTagNameNS(NS.w, 'p'))
    .map((para) => ({ text: extractW(para, 'body').plain, role: wRole(para, 'word/document.xml') }))
    .filter((p) => hasLetters(p.text));
}
