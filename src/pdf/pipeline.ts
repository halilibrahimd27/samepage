import type { TranslationCache } from '../core/cache/cache';
import type { BlockIR, Role } from '../core/ir/types';
import { translateSegments } from '../core/pipeline/translate';
import { decode, plainText } from '../core/segment/codec';
import type { GlossaryEntry, ValidationIssue } from '../core/validate/validate';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { extractAndAnalyze } from './analyze';
import { writePdf, type LoadedFaces, type PageWrite } from './engine';
import { layoutUnit, sizeFactors, type BlockLayout } from './typeset/layout';
import { buildPdfUnits } from './typeset/segments';

export interface PdfOptions {
  engine: TranslationEngine;
  pair: LangPair;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  faces: LoadedFaces;
  maxPages: number;
  dual: boolean;
  /** Reference lists are kept in the original language unless this is set. */
  translateReferences?: boolean;
  cache?: TranslationCache;
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
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
  issues: ValidationIssue[];
}

export interface PdfReport {
  summary: {
    pages: number;
    units: number;
    translated: number;
    warnings: number;
    untranslated: number;
    keptOriginal: number;
    scaled: number;
    missingGlyphs: string[];
    linksMoved: number;
  };
  units: PdfUnitReport[];
}

const pageOf = (b: BlockIR) => Number(b.id.split('-')[0]!.slice(1));
/** Stop-gap fitting until the Layout Repair Engine (Phase 5): shrink, then keep the original. */
const SCALES = [1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.76, 0.72, 0.7];

export async function translatePdf(
  bytes: Uint8Array,
  opts: PdfOptions,
): Promise<{ mono: Uint8Array; dual: Uint8Array | null; report: PdfReport }> {
  const pages = await extractAndAnalyze(bytes, opts.maxPages);
  if (opts.translateReferences) {
    for (const b of pages.flatMap((p) => p.blocks))
      if (b.role === 'reference') b.translatable = true;
  }
  const units = buildPdfUnits(pages);
  const unique = new Map<string, SegmentRequest>();
  for (const u of units)
    if (!unique.has(u.encoded.source))
      unique.set(u.encoded.source, {
        id: `s${unique.size + 1}`,
        text: u.encoded.source,
        role: u.role,
      });
  const requests = [...unique.values()];
  const outcomes = await translateSegments({
    engine: opts.engine,
    segments: requests,
    ctx: { pair: opts.pair, glossary: opts.glossary, numberLocalization: opts.numberLocalization },
    signal: opts.signal,
    fidelityCheck: opts.fidelityCheck,
    ...(opts.cache ? { cache: opts.cache } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  const bySource = new Map(requests.map((r, i) => [r.text, outcomes[i]!]));
  const factors = sizeFactors(
    pages.flatMap((p) => p.blocks),
    opts.faces,
  );
  const sizeFactor = (name: string) => factors.get(name) ?? 1;

  const layouts: BlockLayout[] = [];
  const reports: PdfUnitReport[] = [];
  for (const u of units) {
    const o = bySource.get(u.encoded.source)!;
    const report: PdfUnitReport = {
      id: u.id,
      role: u.role,
      pages: [...new Set(u.blocks.map(pageOf))],
      source: plainText(u.encoded.source),
      target: o.untranslated ? '' : plainText(o.text),
      status: o.untranslated ? 'untranslated' : o.issues.length ? 'warning' : 'translated',
      scale: 1,
      issues: [...o.issues],
    };
    reports.push(report);
    if (o.untranslated) continue;
    let decoded;
    try {
      decoded = decode(o.text, u.encoded);
    } catch {
      report.status = 'untranslated';
      continue;
    }
    let fitted: BlockLayout[] | null = null;
    for (const scale of SCALES) {
      const attempt = layoutUnit(u.id, u.blocks, decoded, u.encoded.baseStyle, opts.faces, {
        sizeFactor,
        scale,
      });
      if (!attempt.some((l) => l.overflow)) {
        fitted = attempt;
        report.scale = scale;
        break;
      }
    }
    if (!fitted) {
      report.status = 'kept-original';
      report.issues.push({
        code: 'LENGTH_RATIO',
        severity: 'warning',
        detail: 'translation does not fit the original boxes; original text kept',
      });
      continue;
    }
    layouts.push(...fitted);
  }

  const blockById = new Map(pages.flatMap((p) => p.blocks).map((b) => [b.id, b]));
  const writes: PageWrite[] = pages.map((p) => ({ index: p.index, redact: [], lines: [] }));
  for (const l of layouts) {
    const block = blockById.get(l.blockId)!;
    const w = writes[pageOf(block)]!;
    for (const line of block.lines)
      w.redact.push({
        x0: line.bbox.x0 - 0.5,
        y0: line.bbox.y0 - 0.5,
        x1: line.bbox.x1 + 0.5,
        y1: line.bbox.y1 + 0.5,
      });
    w.lines.push(...l.lines);
  }
  const written = await writePdf(bytes, writes, opts.faces, { dual: opts.dual });
  if (written.missingGlyphs.length) {
    for (const r of reports) {
      const lost = written.missingGlyphs.filter((g) => r.target.includes(g));
      if (lost.length)
        r.issues.push({
          code: 'WRONG_LANGUAGE',
          severity: 'warning',
          detail: `MISSING_GLYPH: ${lost.join(' ')}`,
        });
    }
  }
  const count = (s: PdfUnitStatus) => reports.filter((r) => r.status === s).length;
  return {
    mono: written.mono,
    dual: written.dual,
    report: {
      summary: {
        pages: pages.length,
        units: reports.length,
        translated: count('translated'),
        warnings: count('warning'),
        untranslated: count('untranslated'),
        keptOriginal: count('kept-original'),
        scaled: reports.filter((r) => r.scale < 1).length,
        missingGlyphs: written.missingGlyphs,
        linksMoved: written.linksAdded,
      },
      units: reports,
    },
  };
}
