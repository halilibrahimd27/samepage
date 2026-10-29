import type { TranslationCache } from '../core/cache/cache';
import { localeFor } from '../core/languages';
import { storedTranslations, type StoredOutcome } from '../core/project';
import { bracketedOutcome, titlesToTranslate, type ReferenceTitle } from '../core/referenceTitles';
import type { BlockIR, LineIR, PageIR, Rect, Role } from '../core/ir/types';
import { translateSegments, type ProgressPhase } from '../core/pipeline/translate';
import { decode, plainText, readableText, verbatimOf } from '../core/segment/codec';
import type { GlossaryEntry, ValidationIssue } from '../core/validate/validate';
import { buildEditableDocx } from '../docx/editable';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { extractAndAnalyze, type OcrOptions } from './analyze';
import {
  normalizedCopy,
  readOutlineAndTitle,
  openPdfForExtraction,
  openRenderer,
  renderRegionsPng,
  writePdf,
  type AppendedPage,
  type LoadedFaces,
  type PageWrite,
} from './engine';
import type { RawPage } from './extract/raw';
import { DEFAULT_POLICY } from '../layout-repair/policy';
import { repairDocument, type RepairInput, type RepairUnitInput } from '../layout-repair/repair';
import { scoreDocument, unitScore, type PageScore, type Status } from '../layout-repair/score';
import type {
  FallbackKind,
  Issue,
  IssueCode,
  RepairCode,
  RepairStep,
} from '../layout-repair/types';
import { layoutUnit, sizeFactors, type LayoutLine } from './typeset/layout';
import { planEditable } from './editable';
import { buildPdfUnits, type PdfUnit } from './typeset/segments';

export interface PdfOptions {
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
  faces: LoadedFaces;
  maxPages: number;
  dual: boolean;
  /** Set identical translations again instead of keeping the original drawing (identity tests). */
  resetIdentical?: boolean;
  /** Reference lists are kept in the original language unless this is set. */
  translateReferences?: boolean;
  /** Reference titles in another language get their translation in brackets (APA 7, P9.6). */
  referenceTitles?: boolean;
  cache?: TranslationCache;
  signal: AbortSignal;
  onProgress?: (done: number, total: number, phase?: ProgressPhase) => void;
  /** Review-step corrections: tagged source → tagged target. */
  overrides?: Record<string, string>;
  /** Layout repair strategies (all by default). */
  strategies?: RepairInput['strategies'];
  /** Translate bookmarks and the document title (P6.3). */
  translateMetadata?: boolean;
  /** Only units entirely inside this page range (0-based, inclusive) are translated (P6.1). */
  pageRange?: { from: number; to: number };
  /** Recognise the text of scanned pages (P8.4). */
  ocr?: Pick<OcrOptions, 'engine'>;
  /** Also build the translation as an editable Word document (P9.4). */
  editable?: boolean;
  /** A reopened project's translations, used instead of the engine (P9.5). */
  replay?: Record<string, StoredOutcome>;
}

export type PdfUnitStatus = 'translated' | 'warning' | 'untranslated' | 'kept-original';

export interface PdfUnitReport {
  id: string;
  role: Role;
  pages: number[];
  source: string;
  target: string;
  status: PdfUnitStatus;
  /** Uniform scale used to fit the box (1 = original size). */
  scale: number;
  score: number;
  fallback?: FallbackKind;
  repairs: RepairStep[];
  issues: ValidationIssue[];
  layoutIssues: Issue[];
  /** Edited by the user in the review step. */
  manual: boolean;
  /** Tagged text, for the review editor. */
  sourceTagged: string;
  targetTagged: string;
  /** The translation translated back (meaning check), for the side-by-side review. */
  back?: string;
}

export interface PdfReport {
  summary: {
    pages: number;
    units: number;
    translated: number;
    warnings: number;
    untranslated: number;
    /** Units that read in the original language: kept as they were, or translated in a note. */
    keptOriginal: number;
    scaled: number;
    score: number;
    status: Status;
    missingGlyphs: string[];
    linksMoved: number;
    issues: Partial<Record<IssueCode, number>>;
    repairs: Partial<Record<RepairCode, number>>;
    overflowNotes: number;
    /** Scanned pages whose text was recognised, with the mean word confidence (0–100). */
    ocr?: { pages: number; confidence: number };
  };
  /** Active content removed from the output (document JavaScript, launch actions…). */
  sanitization: { removed: string[] };
  pages: PageScore[];
  units: PdfUnitReport[];
  issues: Issue[];
}

/** "ℒ (U+2112)": invisible and private-use characters stay identifiable in the report. */
export const glyphLabel = (ch: string) =>
  `${ch} (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`;
const pageOf = (b: BlockIR) => Number(b.id.split('-')[0]!.slice(1));

/** Text comparison for post-apply verification: whitespace, dashes and accents ignored. */
// NFKD: mathematical italic letters (𝑒, 𝜃) read back as their plain forms or the other way
// round depending on the face; compared, they are the same letters.
const normalize = (t: string) =>
  t.normalize('NFKD').replace(/[\s\p{Pd}\p{M}\p{Cf}\p{Sk}\p{Lm}†\d]+/gu, '');
/** Order-insensitive character overlap (rotated text re-extracts in a different order). */
function overlap(a: string, b: string): number {
  if (a === b) return 1;
  const counts = new Map<string, number>();
  for (const ch of a) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let common = 0;
  for (const ch of b) {
    const n = counts.get(ch) ?? 0;
    if (n > 0) {
      common++;
      counts.set(ch, n - 1);
    }
  }
  return common / Math.max(a.length, b.length, 1);
}

function charsIn(raw: RawPage, box: Rect): string {
  return raw.blocks
    .flatMap((b) => b.lines.flatMap((l) => l.chars))
    .filter((c) => {
      const cx = (c.bbox.x0 + c.bbox.x1) / 2;
      const cy = (c.bbox.y0 + c.bbox.y1) / 2;
      return cx >= box.x0 - 1 && cx <= box.x1 + 1 && cy >= box.y0 - 1 && cy <= box.y1 + 1;
    })
    .sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x - b.x)
    .map((c) => c.c)
    .join('');
}

/** Share of `a`'s characters found in `b` (as a multiset). */
function recall(a: string, b: string): number {
  if (!a.length) return 1;
  const counts = new Map<string, number>();
  for (const ch of b) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let found = 0;
  for (const ch of a) {
    const n = counts.get(ch) ?? 0;
    if (n > 0) {
      found++;
      counts.set(ch, n - 1);
    }
  }
  return found / a.length;
}

/** `b` minus the characters of `a` (as a multiset). */
function without(b: string, a: string): string {
  const counts = new Map<string, number>();
  for (const ch of a) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let out = '';
  for (const ch of b) {
    const n = counts.get(ch) ?? 0;
    if (n > 0) counts.set(ch, n - 1);
    else out += ch;
  }
  return out;
}

/**
 * Text re-extracted along the laid-out lines: characters on each line's baseline within its x
 * extent, and those of raised or lowered runs (a fraction's numerator, its exponents) on their
 * own baselines. A box would also catch the neighbouring paragraph where line boxes overlap
 * (fonts with tall ascenders). Rotated lines fall back to the box.
 */
function charsOnLines(raw: RawPage, lines: LayoutLine[], box: Rect): string {
  if (lines.some((l) => l.dir || l.origin)) return charsIn(raw, box);
  const chars = raw.blocks.flatMap((b) => b.lines.flatMap((l) => l.chars));
  return lines
    .map((line) => {
      const size = Math.max(1, ...line.runs.map((r) => r.size));
      const x0 = Math.min(...line.runs.map((r) => r.x)) - 1;
      const x1 = Math.max(...line.runs.map((r) => r.x + r.width)) + 1;
      const shifted = line.runs.filter((r) => r.rise);
      return chars
        .filter((c) => {
          const cx = (c.bbox.x0 + c.bbox.x1) / 2;
          if (cx < x0 || cx > x1) return false;
          if (Math.abs(c.y - line.baseline) < 0.6 * size) return true;
          return shifted.some(
            (r) =>
              cx >= r.x - 1 &&
              cx <= r.x + r.width + 1 &&
              Math.abs(c.y - (line.baseline - r.rise)) < 0.6 * Math.max(1, r.size),
          );
        })
        .sort((a, b) => a.x - b.x)
        .map((c) => c.c)
        .join('');
    })
    .join('');
}

/** A one-slot synthetic box for appendix text. */
function noteBox(id: string, rect: Rect, size: number): BlockIR {
  return {
    id,
    bbox: rect,
    role: 'body',
    translatable: true,
    lines: [
      {
        bbox: { x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y0 + size * 1.2 },
        baseline: rect.y0 + size,
        spans: [],
      },
    ],
    align: 'left',
    direction: [1, 0],
    columnIndex: 0,
    readingOrder: 0,
  };
}

/**
 * Area removed for a translated line. Vertically it follows the glyphs (each span's baseline and
 * size, so superscripts are covered) instead of MuPDF's line box, which spans the font's full
 * ascent and descent and can reach into the line above (chart tick labels under an axis title).
 */
function redactRect(line: LineIR, horizontal: boolean): Rect {
  const pad = 0.5;
  const box = {
    x0: line.bbox.x0 - pad,
    y0: line.bbox.y0 - pad,
    x1: line.bbox.x1 + pad,
    y1: line.bbox.y1 + pad,
  };
  if (!horizontal || !line.spans.length) return box;
  const tops = line.spans.map((s) => (s.baseline ?? line.baseline) - 0.8 * s.size);
  const bottoms = line.spans.map((s) => (s.baseline ?? line.baseline) + 0.25 * s.size);
  return {
    ...box,
    y0: Math.max(box.y0, Math.min(...tops)),
    y1: Math.min(box.y1, Math.max(...bottoms)),
  };
}

/** The pages (of `pages`) that render (nearly) the same in both documents. */
async function pagesDrawnAlike(
  a: Uint8Array,
  b: Uint8Array,
  pages: number[],
  scale: number,
  threshold: number,
): Promise<number[]> {
  const ra = await openRenderer(a);
  const rb = await openRenderer(b);
  try {
    return pages.filter((p) => {
      const x = ra.pixels(p, scale);
      const y = rb.pixels(p, scale);
      if (x.width !== y.width || x.height !== y.height) return false;
      let changed = 0;
      for (let i = 0; i < x.data.length; i += 3) {
        const diff =
          Math.abs(x.data[i]! - y.data[i]!) +
          Math.abs(x.data[i + 1]! - y.data[i + 1]!) +
          Math.abs(x.data[i + 2]! - y.data[i + 2]!);
        if (diff > 96) changed++;
      }
      return changed / (x.data.length / 3) <= threshold;
    });
  } finally {
    ra.close();
    rb.close();
  }
}

/** Units on scanned pages below this mean confidence are flagged for review. */
const OCR_TRUSTED = 80;

/**
 * Mean OCR confidence of the recognised lines inside the blocks, or null (not a scan), and the
 * words recognised with little confidence.
 */
function ocrConfidence(
  blocks: BlockIR[],
  pages: PageIR[],
): { conf: number; weak: { text: string; conf: number }[] } | null {
  const confs: number[] = [];
  const weak: { text: string; conf: number }[] = [];
  for (const b of blocks) {
    const ocr = pages[pageOf(b)]?.ocr;
    if (!ocr) continue;
    for (const l of ocr.lines)
      if (intersects(l.bbox, b.bbox)) {
        confs.push(l.conf);
        weak.push(...(l.weak ?? []));
      }
  }
  return confs.length ? { conf: confs.reduce((a, c) => a + c, 0) / confs.length, weak } : null;
}

const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const grow = (r: Rect, d: number): Rect => ({
  x0: r.x0 - d,
  y0: r.y0 - d,
  x1: r.x1 + d,
  y1: r.y1 + d,
});

function ocrSummary(pages: PageIR[]): { ocr?: { pages: number; confidence: number } } {
  const scanned = pages.filter((p) => p.ocr);
  if (!scanned.length) return {};
  const confidence = scanned.reduce((n, p) => n + p.ocr!.confidence, 0) / scanned.length;
  return { ocr: { pages: scanned.length, confidence: Math.round(confidence) } };
}

/** The paper colour under a recognised line (white when none matches). */
function paperUnder(r: Rect, lines: NonNullable<PageIR['ocr']>['lines']): [number, number, number] {
  const hit = lines.find((l) => intersects(l.bbox, r));
  return hit ? hit.background : [1, 1, 1];
}

export async function translatePdf(
  bytes: Uint8Array,
  opts: PdfOptions,
): Promise<{
  mono: Uint8Array;
  dual: Uint8Array | null;
  editable: Uint8Array | null;
  report: PdfReport;
  /** Every segment's translation by source text, for the project file (P9.5). */
  translations: Record<string, StoredOutcome>;
}> {
  const policy = DEFAULT_POLICY;
  const inRange = (p: number) =>
    !opts.pageRange || (p >= opts.pageRange.from && p <= opts.pageRange.to);
  const pages = await extractAndAnalyze(
    bytes,
    opts.maxPages,
    opts.ocr && {
      engine: opts.ocr.engine,
      pages: inRange,
      signal: opts.signal,
      onPage: (done, total) => opts.onProgress?.(done, total, 'ocr'),
    },
  );
  const titlesOnly = !opts.translateReferences && !!opts.referenceTitles;
  if (opts.translateReferences || titlesOnly) {
    for (const b of pages.flatMap((p) => p.blocks))
      if (b.role === 'reference') b.translatable = true;
  }
  const built = buildPdfUnits(pages).filter((u) => u.blocks.every((b) => inRange(pageOf(b))));
  // Reference entries stay as published; titles in another language are translated alone and
  // put after the title in brackets (APA 7). Entries without one stay untouched.
  const titlesOf = new Map<PdfUnit, ReferenceTitle[]>();
  if (titlesOnly)
    for (const u of built) {
      if (u.role !== 'reference') continue;
      const titles = titlesToTranslate(u.encoded.source, opts.pair);
      if (titles.length) titlesOf.set(u, titles);
      else for (const b of u.blocks) b.translatable = false;
    }
  const units = built.filter((u) => !titlesOnly || u.role !== 'reference' || titlesOf.has(u));
  const meta = opts.translateMetadata
    ? await readOutlineAndTitle(bytes)
    : { outline: [], title: '' };
  const unique = new Map<string, SegmentRequest>();
  for (const u of units)
    if (!titlesOf.has(u) && !unique.has(u.encoded.source))
      unique.set(u.encoded.source, {
        id: `s${unique.size + 1}`,
        text: u.encoded.source,
        role: u.role,
        ...verbatimOf(u.encoded.placeholders, opts.pair),
      });
  // Bookmarks and the document title are translated as plain segments (no layout).
  for (const t of [...meta.outline, meta.title]) {
    if (t.trim() && /\p{L}/u.test(t) && !unique.has(t))
      unique.set(t, { id: `s${unique.size + 1}`, text: t, role: 'heading' });
  }
  for (const t of [...titlesOf.values()].flat())
    if (!unique.has(t.title))
      unique.set(t.title, { id: `s${unique.size + 1}`, text: t.title, role: 'reference' });
  const requests = [...unique.values()];
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
  const bySource = new Map(requests.map((r, i) => [r.text, outcomes[i]!]));
  for (const [u, titles] of titlesOf) {
    const titled = bracketedOutcome(u.encoded.source, titles, (t) => bySource.get(t));
    // No title translated: the entry is drawn as it was, and the reason reported.
    bySource.set(
      u.encoded.source,
      titled ?? {
        id: '',
        text: u.encoded.source,
        untranslated: false,
        cached: false,
        attempts: 0,
        issues: titles.flatMap((t) => bySource.get(t.title)?.issues ?? []),
        notes: [],
        findings: [],
      },
    );
  }
  const factors = sizeFactors(
    pages.flatMap((p) => p.blocks),
    opts.faces,
  );
  const sizeFactor = (name: string) => factors.get(name) ?? 1;

  const reports = new Map<string, PdfUnitReport>();
  const repairInputs: RepairUnitInput[] = [];
  const preIssues: Issue[] = [];
  for (const u of units) {
    const o =
      opts.overrides?.[u.encoded.source] !== undefined
        ? {
            ...bySource.get(u.encoded.source)!,
            text: opts.overrides[u.encoded.source]!,
            untranslated: false,
          }
        : bySource.get(u.encoded.source)!;
    const report: PdfUnitReport = {
      id: u.id,
      role: u.role,
      pages: [...new Set(u.blocks.map(pageOf))],
      source: readableText(u.encoded.source, u.encoded.placeholders),
      target: o.untranslated ? '' : readableText(o.text, u.encoded.placeholders),
      status: o.untranslated
        ? 'untranslated'
        : o.issues.some((i) => i.severity !== 'info')
          ? 'warning'
          : 'translated',
      scale: 1,
      score: 100,
      repairs: [],
      issues: [...o.issues],
      layoutIssues: [],
      manual: opts.overrides?.[u.encoded.source] !== undefined,
      sourceTagged: u.encoded.source,
      targetTagged: o.untranslated ? '' : o.text,
      // The back-translation is of the engine's text, not of a manual edit.
      ...(o.back && opts.overrides?.[u.encoded.source] === undefined ? { back: o.back } : {}),
    };
    const ocr = ocrConfidence(u.blocks, pages);
    if (ocr && (ocr.conf < OCR_TRUSTED || ocr.weak.length)) {
      // The words themselves: a misread number ("487,4" for "%87,4") passes every check.
      const words = ocr.weak.map((w) => `${w.text} (${w.conf}%)`).join(', ');
      report.issues.push({
        code: 'OCR_LOW_CONFIDENCE',
        severity: 'warning',
        detail: `recognised text, confidence ${Math.round(ocr.conf)}%${words ? `; check: ${words}` : ''}`,
      });
      if (report.status === 'translated') report.status = 'warning';
    }
    reports.set(u.id, report);
    // A translation identical to the source (names, formulas, figures) is not set again: the
    // original drawing stays exact. Spaces do not count: engines move them across tags
    // ("<t1>L </t1>⟦F3⟧" came back as "<t1>L</t1> ⟦F3⟧").
    const unchanged = o.text.replace(/\s+/gu, '') === u.encoded.source.replace(/\s+/gu, '');
    if (!opts.resetIdentical && !o.untranslated && unchanged) continue;
    let decoded = null;
    if (!o.untranslated) {
      try {
        decoded = decode(o.text, u.encoded);
      } catch {
        decoded = null;
      }
    }
    if (!decoded) {
      report.status = 'untranslated';
      preIssues.push({
        code: 'UNTRANSLATED',
        severity: 'error',
        pageIndex: report.pages[0]!,
        unitId: u.id,
        bbox: u.blocks[0]!.bbox,
        message: 'translation failed validation; original text kept',
      });
      continue;
    }
    repairInputs.push({ unit: u, runs: decoded });
  }

  // Symbols the text faces lack (∫, ∑, ∝ …) need the math face, fetched only then.
  await opts.faces.ensure(repairInputs.flatMap((i) => i.runs.map((r) => r.text)).join(''));
  const repaired = repairDocument({
    pages,
    units: repairInputs,
    measurer: opts.faces,
    sizeFactor,
    policy,
    ...(opts.strategies ? { strategies: opts.strategies } : {}),
  });
  const blockById = new Map(pages.flatMap((p) => p.blocks).map((b) => [b.id, b]));
  const forcedOriginal = new Set<string>();
  /**
   * Units on pages that cannot be rewritten without moving their other text (see below): the
   * page stays as it is and the translation is added as a PDF note.
   */
  const forcedNote = new Set<string>();
  /** Why the check after writing rejected a unit (kept in the report with KEPT_ORIGINAL). */
  const failReason = new Map<string, string>();
  let postIssues: Issue[] = [];
  /** What the translation is written on: the original, or its normalized copy (see below). */
  let source = bytes;
  let written: Awaited<ReturnType<typeof writePdf>> | null = null;

  for (let attempt = 0; attempt <= policy.postApply.maxRebuilds; attempt++) {
    const writes: PageWrite[] = pages.map((p) => ({
      index: p.index,
      redact: [],
      lines: [],
      notes: [],
    }));
    const placed = repaired.units.filter((r) => !forcedOriginal.has(r.unitId));
    const coverOf = (w: PageWrite) => {
      const ocr = pages[w.index]!.ocr;
      if (!ocr) return;
      // The recognised text is part of the scan: paint the paper colour over it.
      // Accents reach above the recognised box: a quarter of the line more on top.
      w.cover = w.redact.map((r) => ({
        rect: { ...grow(r, 1.8), y0: r.y0 - Math.max(1.8, 0.25 * (r.y1 - r.y0)) },
        color: paperUnder(r, ocr.lines),
      }));
    };
    for (const r of placed) {
      if (forcedNote.has(r.unitId)) {
        const first = blockById.get(r.layouts[0]?.blockId ?? '');
        const text = reports.get(r.unitId)!.target;
        if (first && text) writes[pageOf(first)]!.notes!.push({ rect: first.bbox, text });
        continue;
      }
      if (r.fallback === 'keep-original') continue;
      if (r.fallback === 'annotation' && r.annotation) {
        writes[r.pageIndex]!.notes!.push(r.annotation);
        continue;
      }
      for (const l of r.layouts) {
        const block = blockById.get(l.blockId)!;
        const w = writes[pageOf(block)]!;
        const horizontal = block.direction[1] === 0;
        for (const line of block.lines) w.redact.push(redactRect(line, horizontal));
        if (block.underlines?.length) (w.lineArt ??= []).push(...block.underlines);
        if (block.extraRedact?.length) w.redact.push(...block.extraRedact);
        w.lines.push(...l.lines);
      }
      // Overflow note marker after the last laid-out word.
      if (r.overflowNote) {
        const lastLine = [...r.layouts].reverse().flatMap((l) => [...l.lines].reverse())[0];
        const lastRun = lastLine?.runs[lastLine.runs.length - 1];
        if (lastLine && lastRun) {
          const text = `†${r.overflowNote.marker}`;
          const size = lastRun.size * 0.7;
          lastLine.runs.push({
            text,
            face: 'serif-regular',
            size,
            color: lastRun.color,
            x: lastRun.x + lastRun.width + 0.5,
            width: opts.faces.width(text, 'serif-regular', size),
            rise: lastRun.size * 0.33,
          });
        }
      }
    }

    // Overflow notes appendix (LAYOUT_REPAIR.md §5 R6).
    const notes = placed.filter((r) => r.overflowNote).map((r) => r.overflowNote!);
    const appendix: AppendedPage[] = [];
    if (notes.length) {
      const width = pages[0]!.width;
      const height = pages[0]!.height;
      const margin = 72;
      const style = {
        family: 'serif' as const,
        bold: false,
        italic: false,
        color: [0, 0, 0] as [number, number, number],
        size: 10,
        fontName: 'NotoSerif',
      };
      let page: AppendedPage = { width, height, lines: [] };
      appendix.push(page);
      let y = margin;
      for (const n of notes) {
        const unit = placed.find((r) => r.overflowNote === n)!;
        const text = `†${n.marker} (p. ${unit.pageIndex + 1}) ${n.text}`;
        for (let tries = 0; tries < 2; tries++) {
          const box = noteBox(
            `note-${n.marker}`,
            { x0: margin, y0: y, x1: width - margin, y1: height - margin },
            style.size,
          );
          const laid = layoutUnit(
            `note-${n.marker}`,
            [box],
            [{ type: 'text', text, style }],
            style,
            opts.faces,
            { sizeFactor: () => 1 },
          );
          if (!laid[0]!.overflow || tries === 1) {
            page.lines.push(...laid[0]!.lines);
            const lastBaseline = laid[0]!.lines[laid[0]!.lines.length - 1]?.baseline ?? y;
            y = lastBaseline + style.size * 1.2;
            break;
          }
          page = { width, height, lines: [] };
          appendix.push(page);
          y = margin;
        }
      }
    }

    const translatedText = (t: string) => {
      const o = bySource.get(t);
      return o && !o.untranslated ? plainText(o.text) : t;
    };
    for (const w of writes) coverOf(w);
    written = await writePdf(source, writes, opts.faces, {
      dual: opts.dual,
      appendix,
      ...(meta.outline.length ? { outline: meta.outline.map(translatedText) } : {}),
      ...(meta.title.trim() ? { title: translatedText(meta.title) } : {}),
    });

    // Post-apply verification (§7): re-extract and compare with the intended text; masked render diff.
    postIssues = [];
    // Pages are extracted on demand and dropped after use (long documents, memory).
    const pdf = await openPdfForExtraction(written.mono);
    const rawCache = new Map<number, RawPage>();
    const rawOut = (i: number) => {
      let r = rawCache.get(i);
      if (!r) {
        if (rawCache.size > 4) rawCache.delete(rawCache.keys().next().value!);
        r = pdf.extractPage(i);
        rawCache.set(i, r);
      }
      return r;
    };
    const failing: string[] = [];
    for (const r of placed) {
      if (r.fallback === 'keep-original' || r.fallback === 'annotation' || forcedNote.has(r.unitId))
        continue;
      const expected = normalize(
        r.layouts
          .flatMap((l) => l.lines.flatMap((line) => line.runs.map((run) => run.text)))
          .join(''),
      );
      const actual = normalize(
        r.layouts
          .map((l) =>
            charsOnLines(
              rawOut(pageOf(blockById.get(l.blockId)!)),
              l.lines,
              r.params.boxes[l.blockId] ?? blockById.get(l.blockId)!.bbox,
            ),
          )
          .join(''),
      );
      if (expected.length < 2) continue;
      // How much of what we wrote reads back (a formula glyph next to a short word is not ours,
      // and does not count against it), and whether the source is still there beside it.
      const similarity = recall(expected, actual);
      const source = normalize(reports.get(r.unitId)!.source);
      const leftover = without(actual, expected);
      const residual =
        source !== expected &&
        leftover.length >= 0.5 * source.length &&
        overlap(source, leftover) >= 0.8;
      if (similarity < 0.9 || residual) {
        postIssues.push({
          code: residual ? 'RESIDUAL_SOURCE' : 'TEXT_NOT_EXTRACTABLE',
          severity: 'error',
          pageIndex: r.pageIndex,
          unitId: r.unitId,
          metrics: { similarity: Math.round(similarity * 100) / 100 },
          message: residual
            ? 'source text still present after redaction'
            : 'output text does not re-extract as written',
        });
        failing.push(r.unitId);
        failReason.set(
          r.unitId,
          `${residual ? 'source text still present' : 'text does not re-extract as written'}, similarity ${similarity.toFixed(2)}`,
        );
      }
    }
    pdf.close();
    rawCache.clear();
    const originalRenderer = await openRenderer(source);
    const outputRenderer = await openRenderer(written.mono);
    const scale = policy.postApply.renderDpi / 72;
    for (const w of writes) {
      if (!w.lines.length && !w.redact.length) continue;
      const before = originalRenderer.pixels(w.index, scale);
      const after = outputRenderer.pixels(w.index, scale);
      const d = policy.postApply.maskDilatePt;
      const masks = [
        ...pages[w.index]!.blocks.flatMap((b) => b.lines.map((l) => l.bbox)),
        ...(w.cover ?? []).map((c) => c.rect),
        ...w.lines.flatMap((line) =>
          line.runs.map((run) => ({
            x0: run.x,
            y0: line.baseline - run.size,
            x1: run.x + run.width,
            y1: line.baseline + run.size * 0.3,
          })),
        ),
        ...(w.notes ?? []).map((n) => ({
          x0: n.rect.x1 - 4,
          y0: n.rect.y0 - 2,
          x1: n.rect.x1 + 16,
          y1: n.rect.y0 + 18,
        })),
      ].map((r) => ({
        x0: (r.x0 - d) * scale,
        y0: (r.y0 - d) * scale,
        x1: (r.x1 + d) * scale,
        y1: (r.y1 + d) * scale,
      }));
      let changed = 0;
      let total = 0;
      for (let y = 0; y < before.height; y += 2) {
        for (let x = 0; x < before.width; x += 2) {
          if (masks.some((m) => x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1)) continue;
          total++;
          const i = (y * before.width + x) * 3;
          if (
            Math.abs(before.data[i]! - after.data[i]!) +
              Math.abs(before.data[i + 1]! - after.data[i + 1]!) +
              Math.abs(before.data[i + 2]! - after.data[i + 2]!) >
            96
          )
            changed++;
        }
      }
      const ratio = total ? changed / total : 0;
      if (ratio > policy.postApply.collateralDiffThreshold) {
        postIssues.push({
          code: 'COLLATERAL_DAMAGE',
          severity: 'error',
          pageIndex: w.index,
          metrics: { ratio: Math.round(ratio * 10000) / 10000 },
          message: 'non-text content changed outside the text areas',
        });
      }
    }
    originalRenderer.close();
    outputRenderer.close();
    // Some producers set a page as one text object that MuPDF's redaction mishandles (glyphs
    // beside a removed word move). Write once more with those pages normalized, where the
    // normalized page draws exactly like the original; a page even that moves is left as it is,
    // with the translations as PDF notes.
    const damaged = [
      ...new Set(postIssues.filter((i) => i.code === 'COLLATERAL_DAMAGE').map((i) => i.pageIndex)),
    ].sort((a, b) => a - b);
    if (damaged.length && attempt < policy.postApply.maxRebuilds) {
      let rest = damaged;
      if (source === bytes) {
        const alike = await pagesDrawnAlike(
          bytes,
          await normalizedCopy(bytes, damaged),
          damaged,
          scale,
          policy.postApply.collateralDiffThreshold,
        );
        if (alike.length) source = await normalizedCopy(bytes, alike);
        rest = damaged.filter((p) => !alike.includes(p));
      }
      // Pages even the rewrite moves: left as they are, translations as notes.
      for (const r of repaired.units) {
        const onPage = r.layouts.some((l) => rest.includes(pageOf(blockById.get(l.blockId)!)));
        if (onPage) forcedNote.add(r.unitId);
      }
      failing.filter((id) => !forcedNote.has(id)).forEach((id) => forcedOriginal.add(id));
      continue;
    }
    if (!failing.length || attempt === policy.postApply.maxRebuilds) break;
    // Targeted rebuild: failing units keep their original text.
    failing.forEach((id) => forcedOriginal.add(id));
  }

  // ---- Report -------------------------------------------------------------------------------
  const issues = [...preIssues, ...repaired.issues, ...postIssues];
  for (const id of forcedNote) {
    const r = repaired.units.find((x) => x.unitId === id)!;
    issues.push({
      code: 'ANNOTATION',
      severity: 'warning',
      pageIndex: r.pageIndex,
      unitId: id,
      message:
        'this page cannot be rewritten without moving its other text; original kept, translation in a PDF note',
    });
  }
  for (const id of forcedOriginal) {
    const r = repaired.units.find((x) => x.unitId === id)!;
    issues.push({
      code: 'KEPT_ORIGINAL',
      severity: 'error',
      pageIndex: r.pageIndex,
      unitId: id,
      message: `verification failed (${failReason.get(id) ?? 'check after writing'}); original text kept`,
    });
  }
  for (const { pageIndex, chars } of written!.missingByPage) {
    issues.push({
      code: 'MISSING_GLYPH',
      severity: 'error',
      pageIndex,
      message: `no glyph for: ${chars.map(glyphLabel).join(' ')}`,
    });
  }
  for (const r of repaired.units) {
    const report = reports.get(r.unitId)!;
    report.scale = r.params.scale;
    report.repairs = r.steps;
    if (r.fallback) report.fallback = r.fallback;
    if (forcedNote.has(r.unitId)) {
      report.fallback = 'annotation';
      if (report.status === 'translated') report.status = 'warning';
    }
    if (r.fallback === 'keep-original' || forcedOriginal.has(r.unitId))
      report.status = 'kept-original';
  }
  const unitScores: { pageIndex: number; score: number }[] = [];
  for (const report of reports.values()) {
    report.layoutIssues = issues.filter((i) => i.unitId === report.id);
    report.score = unitScore(report.layoutIssues, report.repairs);
    unitScores.push({ pageIndex: report.pages[0]!, score: report.score });
  }
  const scored = scoreDocument(pages.length, unitScores, issues);
  const all = [...reports.values()];
  // A unit whose translation went into a PDF note reads in the original language on the page.
  const inNote = (r: PdfUnitReport) => r.fallback === 'annotation';
  const count = (st: PdfUnitStatus) => all.filter((r) => r.status === st && !inNote(r)).length;
  const issueCounts: PdfReport['summary']['issues'] = {};
  for (const i of issues) issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
  const repairCounts: PdfReport['summary']['repairs'] = {};
  for (const r of all)
    for (const st of r.repairs) repairCounts[st.code] = (repairCounts[st.code] ?? 0) + 1;

  // ---- Editable Word document (P9.4) ---------------------------------------------------------
  // Every translation that passed validation goes in, also those the PDF could not fit; figures
  // and display formulas are cut from the translated PDF.
  let editable: Uint8Array | null = null;
  if (opts.editable) {
    const runsOf = (u: PdfUnit) => {
      const o = bySource.get(u.encoded.source)!;
      const text = opts.overrides?.[u.encoded.source] ?? (o.untranslated ? null : o.text);
      if (text !== null) {
        try {
          return decode(text, u.encoded);
        } catch {
          // Failed validation: the source, as in the PDF.
        }
      }
      return decode(u.encoded.source, u.encoded);
    };
    const plan = planEditable(
      pages,
      units.map((unit) => ({ unit, runs: runsOf(unit) })),
      inRange,
    );
    const crops = await renderRegionsPng(written!.mono, plan.pictures, 2);
    const title = meta.title.trim() && bySource.get(meta.title);
    editable = await buildEditableDocx(
      plan.items,
      crops.map((c) => c.png),
      {
        locale:
          opts.pair.target === 'en' && opts.englishSpelling === 'british'
            ? 'en-GB'
            : localeFor(opts.pair.target),
        ...(title && !title.untranslated ? { title: plainText(title.text) } : {}),
        page: { width: pages[0]?.width ?? 595, height: pages[0]?.height ?? 842 },
        footnotes: plan.footnotes,
      },
    );
  }

  return {
    mono: written!.mono,
    dual: written!.dual,
    editable,
    translations: storedTranslations(requests, outcomes),
    report: {
      summary: {
        pages: pages.length,
        units: all.length,
        translated: count('translated'),
        warnings: count('warning'),
        untranslated: count('untranslated'),
        keptOriginal: count('kept-original') + all.filter(inNote).length,
        scaled: all.filter((r) => r.scale < 1).length,
        score: scored.score,
        status: scored.status,
        missingGlyphs: written!.missingGlyphs.map(glyphLabel),
        linksMoved: written!.linksAdded,
        issues: issueCounts,
        repairs: repairCounts,
        overflowNotes: repaired.units.filter((r) => r.overflowNote && !forcedOriginal.has(r.unitId))
          .length,
        ...ocrSummary(pages),
      },
      pages: scored.pages,
      units: all,
      issues,
      sanitization: { removed: written!.sanitized },
    },
  };
}
