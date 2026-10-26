import type { TranslationCache } from '../core/cache/cache';
import type { BlockIR, LineIR, Rect, Role } from '../core/ir/types';
import { translateSegments, type ProgressPhase } from '../core/pipeline/translate';
import { decode, plainText, readableText, verbatimOf } from '../core/segment/codec';
import type { GlossaryEntry, ValidationIssue } from '../core/validate/validate';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { extractAndAnalyze } from './analyze';
import {
  readOutlineAndTitle,
  openPdfForExtraction,
  openRenderer,
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
import { layoutUnit, sizeFactors } from './typeset/layout';
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
  onProgress?: (done: number, total: number, phase?: ProgressPhase) => void;
  /** Review-step corrections: tagged source → tagged target. */
  overrides?: Record<string, string>;
  /** Layout repair strategies (all by default). */
  strategies?: RepairInput['strategies'];
  /** Translate bookmarks and the document title (P6.3). */
  translateMetadata?: boolean;
  /** Only units entirely inside this page range (0-based, inclusive) are translated (P6.1). */
  pageRange?: { from: number; to: number };
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
    score: number;
    status: Status;
    missingGlyphs: string[];
    linksMoved: number;
    issues: Partial<Record<IssueCode, number>>;
    repairs: Partial<Record<RepairCode, number>>;
    overflowNotes: number;
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
const normalize = (t: string) =>
  t.normalize('NFD').replace(/[\s\p{Pd}\p{M}\p{Cf}\p{Sk}\p{Lm}†\d]+/gu, '');
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

export async function translatePdf(
  bytes: Uint8Array,
  opts: PdfOptions,
): Promise<{ mono: Uint8Array; dual: Uint8Array | null; report: PdfReport }> {
  const policy = DEFAULT_POLICY;
  const pages = await extractAndAnalyze(bytes, opts.maxPages);
  if (opts.translateReferences) {
    for (const b of pages.flatMap((p) => p.blocks))
      if (b.role === 'reference') b.translatable = true;
  }
  const inRange = (p: number) =>
    !opts.pageRange || (p >= opts.pageRange.from && p <= opts.pageRange.to);
  const units = buildPdfUnits(pages).filter((u) => u.blocks.every((b) => inRange(pageOf(b))));
  const meta = opts.translateMetadata
    ? await readOutlineAndTitle(bytes)
    : { outline: [], title: '' };
  const unique = new Map<string, SegmentRequest>();
  for (const u of units)
    if (!unique.has(u.encoded.source))
      unique.set(u.encoded.source, {
        id: `s${unique.size + 1}`,
        text: u.encoded.source,
        role: u.role,
        ...verbatimOf(u.encoded.placeholders),
      });
  // Bookmarks and the document title are translated as plain segments (no layout).
  for (const t of [...meta.outline, meta.title]) {
    if (t.trim() && /\p{L}/u.test(t) && !unique.has(t))
      unique.set(t, { id: `s${unique.size + 1}`, text: t, role: 'heading' });
  }
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
      status: o.untranslated ? 'untranslated' : o.issues.length ? 'warning' : 'translated',
      scale: 1,
      score: 100,
      repairs: [],
      issues: [...o.issues],
      layoutIssues: [],
      manual: opts.overrides?.[u.encoded.source] !== undefined,
      sourceTagged: u.encoded.source,
      targetTagged: o.untranslated ? '' : o.text,
    };
    reports.set(u.id, report);
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
  let postIssues: Issue[] = [];
  let written: Awaited<ReturnType<typeof writePdf>> | null = null;

  for (let attempt = 0; attempt <= policy.postApply.maxRebuilds; attempt++) {
    const writes: PageWrite[] = pages.map((p) => ({
      index: p.index,
      redact: [],
      lines: [],
      notes: [],
    }));
    const placed = repaired.units.filter((r) => !forcedOriginal.has(r.unitId));
    for (const r of placed) {
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
    written = await writePdf(bytes, writes, opts.faces, {
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
      if (r.fallback === 'keep-original' || r.fallback === 'annotation') continue;
      const expected = normalize(
        r.layouts
          .flatMap((l) => l.lines.flatMap((line) => line.runs.map((run) => run.text)))
          .join(''),
      );
      const actual = normalize(
        r.layouts
          .map((l) =>
            charsIn(
              rawOut(pageOf(blockById.get(l.blockId)!)),
              r.params.boxes[l.blockId] ?? blockById.get(l.blockId)!.bbox,
            ),
          )
          .join(''),
      );
      if (expected.length < 2) continue;
      const similarity = overlap(expected, actual);
      if (similarity < 0.9) {
        const source = normalize(reports.get(r.unitId)!.source);
        const residual = overlap(source, actual) > similarity;
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
      }
    }
    pdf.close();
    rawCache.clear();
    const originalRenderer = await openRenderer(bytes);
    const outputRenderer = await openRenderer(written.mono);
    const scale = policy.postApply.renderDpi / 72;
    for (const w of writes) {
      if (!w.lines.length && !w.redact.length) continue;
      const before = originalRenderer.pixels(w.index, scale);
      const after = outputRenderer.pixels(w.index, scale);
      const d = policy.postApply.maskDilatePt;
      const masks = [
        ...pages[w.index]!.blocks.flatMap((b) => b.lines.map((l) => l.bbox)),
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
    if (!failing.length || attempt === policy.postApply.maxRebuilds) break;
    // Targeted rebuild: failing units keep their original text.
    failing.forEach((id) => forcedOriginal.add(id));
  }

  // ---- Report -------------------------------------------------------------------------------
  const issues = [...preIssues, ...repaired.issues, ...postIssues];
  for (const id of forcedOriginal) {
    const r = repaired.units.find((x) => x.unitId === id)!;
    issues.push({
      code: 'KEPT_ORIGINAL',
      severity: 'error',
      pageIndex: r.pageIndex,
      unitId: id,
      message: 'verification failed; original text kept',
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
  const count = (st: PdfUnitStatus) => all.filter((r) => r.status === st).length;
  const issueCounts: PdfReport['summary']['issues'] = {};
  for (const i of issues) issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
  const repairCounts: PdfReport['summary']['repairs'] = {};
  for (const r of all)
    for (const st of r.repairs) repairCounts[st.code] = (repairCounts[st.code] ?? 0) + 1;

  return {
    mono: written!.mono,
    dual: written!.dual,
    report: {
      summary: {
        pages: pages.length,
        units: all.length,
        translated: count('translated'),
        warnings: count('warning'),
        untranslated: count('untranslated'),
        keptOriginal: count('kept-original'),
        scaled: all.filter((r) => r.scale < 1).length,
        score: scored.score,
        status: scored.status,
        missingGlyphs: written!.missingGlyphs.map(glyphLabel),
        linksMoved: written!.linksAdded,
        issues: issueCounts,
        repairs: repairCounts,
        overflowNotes: repaired.units.filter((r) => r.overflowNote && !forcedOriginal.has(r.unitId))
          .length,
      },
      pages: scored.pages,
      units: all,
      issues,
      sanitization: { removed: written!.sanitized },
    },
  };
}
