import { localizeEtAl } from '../glossary/citations';
import {
  PROMPT_VERSION,
  translationSystemPrompt,
  translationUserMessage,
} from '../../engines/prompt';
import {
  EngineError,
  type FidelityFinding,
  type SegmentRequest,
  type SegmentResult,
  type TranslateContext,
  type TranslationEngine,
} from '../../engines/types';
import { cacheKey, type CacheEntry, type TranslationCache } from '../cache/cache';
import { academicHeading, isNameList, metricGlossary, usesMetrics } from '../glossary/academic';
import { glossaryHash } from '../glossary/glossary';
import { protectNumbers, protectTerms, restoreTerms } from '../glossary/protect';
import { splitSentences } from '../../engines/plainText';
import { plainText, tokenize } from '../segment/codec';
import { createDehyphenator } from '../segment/dehyphenate';
import { validateTranslation, type ValidationIssue } from '../validate/validate';

export interface SegmentOutcome {
  id: string;
  /** Translation, or the source text when untranslated. */
  text: string;
  untranslated: boolean;
  cached: boolean;
  attempts: number;
  issues: ValidationIssue[];
  notes: string[];
  findings: FidelityFinding[];
  /** The translation translated back into the source language (meaning check). */
  back?: string;
}

export interface TranslateJob {
  engine: TranslationEngine;
  segments: SegmentRequest[];
  ctx: Omit<TranslateContext, 'previousText' | 'retryFeedback'>;
  signal: AbortSignal;
  cache?: TranslationCache;
  concurrency?: number;
  fidelityCheck?: boolean;
  /** Write "et al." in citations the target language's way ("vd.", "и др."). */
  localCitations?: boolean;
  /** Progress of the translation, then (phase 'check') of the meaning check. */
  onProgress?: (done: number, total: number, phase?: ProgressPhase) => void;
}

/** 'check': the meaning check after translation (back-translation or Claude review). */
export type ProgressPhase = 'check' | 'ocr';

const MAX_SEGMENTS_PER_BATCH = 40;
const FIDELITY_BATCH_CHARS = 8000;

/** Greedy, order-preserving batching by character budget. */
export function makeBatches<T extends { text: string }>(
  items: T[],
  maxChars: number,
  maxItems = MAX_SEGMENTS_PER_BATCH,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    if (current.length && (size + item.text.length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += item.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** Runs async tasks with a concurrency limit, preserving result order. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

const FATAL: EngineError['code'][] = [
  'auth',
  'network',
  'rate-limit',
  'server',
  'bad-request',
  'unavailable',
];

/**
 * Translates segments: cache → batches → validate → retry (batch with feedback, then each
 * failing segment alone) → keep the source and report (TRANSLATION.md §6). Optionally runs the
 * fidelity check (ADR-008) on accepted translations.
 */
export async function translateSegments(job: TranslateJob): Promise<SegmentOutcome[]> {
  const { engine, signal } = job;
  // Line-end hyphens left inside words by PDF converters are joined before translating.
  const dehyphenate = createDehyphenator(job.segments.map((s) => s.text));
  const segments = job.segments.map((s) => ({ ...s, text: dehyphenate(s.text) }));
  const originalText = new Map(job.segments.map((s) => [s.id, s.text]));
  const checkLanguage = engine.id !== 'pseudo';
  const headings = !engine.capabilities.glossary && engine.id !== 'pseudo';
  const metrics =
    headings &&
    usesMetrics(
      segments.map((s) => plainText(s.text)),
      job.ctx.pair.source,
    );
  // In a metrics paper the metric terms are kept consistent like glossary terms (user entries win).
  const glossary = metrics
    ? [
        ...job.ctx.glossary,
        ...metricGlossary(job.ctx.pair.source, job.ctx.pair.target).filter(
          (m) => !job.ctx.glossary.some((g) => g.source.toLowerCase() === m.source.toLowerCase()),
        ),
      ]
    : job.ctx.glossary;
  const ctx: TranslateContext = { ...job.ctx, glossary };
  // Engines without glossary support get terms protected as placeholders (ADR-015).
  const protecting = !engine.capabilities.glossary && glossary.length > 0;
  const gHash = await glossaryHash(ctx.glossary);
  const keys = await Promise.all(
    segments.map((s) =>
      cacheKey({
        engineId: engine.id,
        model: engine.model ?? '',
        source: ctx.pair.source,
        target: ctx.pair.target,
        promptVersion: PROMPT_VERSION,
        glossaryHash: gHash,
        numberLocalization: ctx.numberLocalization,
        role: s.role,
        ...(s.budgetChars !== undefined ? { budgetChars: s.budgetChars } : {}),
        text: s.text,
      }),
    ),
  );
  const keyOf = new Map(segments.map((s, i) => [s.id, keys[i]!]));
  const hits = job.cache ? await job.cache.get(keys) : new Map<string, CacheEntry>();

  const outcomes = new Map<string, SegmentOutcome>();
  const validate = (req: SegmentRequest, text: string, notes: string[]) => {
    const issues = validateTranslation({
      source: req.text,
      target: text,
      sourceLang: ctx.pair.source,
      targetLang: ctx.pair.target,
      glossary: ctx.glossary,
      checkLanguage,
      // Machine translators translate "Of course, …" literally; they never add chatter.
      checkChatter: engine.capabilities.glossary,
    });
    if (notes.includes('style-approximated')) {
      issues.push({
        code: 'STYLE_APPROXIMATED',
        severity: 'warning',
        detail: 'some inline formatting (bold, italic, …) could not be placed in the translation',
      });
    }
    if (notes.includes('clauses')) {
      issues.push({
        code: 'REVIEW_SUGGESTED',
        severity: 'warning',
        detail:
          'translated clause by clause because the engine dropped content from the full sentence; please review the wording',
      });
    }
    if (notes.includes('sentences')) {
      issues.push({
        code: 'REVIEW_SUGGESTED',
        severity: 'info',
        detail:
          'translated sentence by sentence: given the whole paragraph, the engine changed numbers or citations',
      });
    }
    if (notes.includes('kept-verbatim')) {
      issues.push({
        code: 'PARTLY_UNTRANSLATED',
        severity: 'warning',
        detail: 'a formatted part containing a link was kept in the original language',
      });
    }
    return issues;
  };

  const pending: SegmentRequest[] = [];
  for (const s of segments) {
    const hit = hits.get(keyOf.get(s.id)!);
    const heading = headings
      ? academicHeading(s.text, ctx.pair.source, ctx.pair.target, metrics)
      : null;
    // Author lines with affiliation marks stay as they are (marks: superscripts, *, †).
    const authors =
      heading === null &&
      /⟦N\d+⟧|[*†‡]/.test(s.text) &&
      isNameList(plainText(s.text).replace(/[*†‡]/g, ''));
    if (authors) {
      outcomes.set(s.id, {
        id: s.id,
        text: s.text,
        untranslated: false,
        cached: false,
        attempts: 0,
        issues: [],
        notes: ['names'],
        findings: [],
      });
    } else if (heading !== null) {
      outcomes.set(s.id, {
        id: s.id,
        text: heading,
        untranslated: false,
        cached: false,
        attempts: 0,
        issues: [],
        notes: ['academic-heading'],
        findings: [],
      });
    } else if (hit) {
      outcomes.set(s.id, {
        id: s.id,
        text: hit.text,
        untranslated: false,
        cached: true,
        attempts: 0,
        issues: validate(s, hit.text, hit.notes ?? []).filter((i) => i.severity !== 'error'),
        notes: hit.notes ?? [],
        findings: hit.findings ?? [],
        ...(hit.back ? { back: hit.back } : {}),
      });
    } else {
      pending.push(s);
    }
  }

  let done = outcomes.size;
  job.onProgress?.(done, segments.length);
  const indexOf = new Map(segments.map((s, i) => [s.id, i]));
  const previousSource = (id: string) => {
    const i = indexOf.get(id)!;
    return i > 0 ? plainText(segments[i - 1]!.text).slice(-600) : undefined;
  };

  /**
   * One engine call; splits the batch when the output was truncated. Segments in `freeze` get
   * their numbers frozen as placeholders (a retry after an engine changed a number).
   */
  async function call(
    batch: SegmentRequest[],
    feedback?: string,
    freeze?: Set<string>,
  ): Promise<Map<string, SegmentResult>> {
    signal.throwIfAborted();
    const prev = previousSource(batch[0]!.id);
    const callCtx: TranslateContext = {
      ...ctx,
      ...(prev ? { previousText: prev } : {}),
      ...(feedback ? { retryFeedback: feedback } : {}),
    };
    try {
      if (!protecting && !freeze?.size) {
        const results = await engine.translate(batch, callCtx, signal);
        return new Map(results.map((r) => [r.id, r]));
      }
      const prepared = batch.map((s) => {
        const terms = protecting
          ? protectTerms(s.text, ctx.glossary, ctx.pair.source)
          : { text: s.text, targets: [] };
        const numbers = freeze?.has(s.id)
          ? protectNumbers(terms.text)
          : { text: terms.text, targets: [] };
        return { req: s, text: numbers.text, terms: terms.targets, numbers: numbers.targets };
      });
      const results = await engine.translate(
        prepared.map(({ req, text, terms, numbers }) => ({
          ...req,
          text,
          // Plain-text engines may send the protected terms inline (as their target wording).
          verbatim: {
            ...req.verbatim,
            ...Object.fromEntries(terms.map((t, i) => [`G${i + 1}`, t])),
            ...Object.fromEntries(numbers.map((t, i) => [`D${i + 1}`, t])),
          },
        })),
        callCtx,
        signal,
      );
      const byId = new Map(prepared.map((p) => [p.req.id, p]));
      return new Map(
        results.map((r) => {
          const p = byId.get(r.id);
          const numbers = restoreTerms(r.text, p?.numbers ?? [], 'D');
          const restored = numbers === null ? null : restoreTerms(numbers, p?.terms ?? []);
          // A lost protected term or number fails validation (empty text → retry path).
          return [r.id, restored === null ? { ...r, text: '' } : { ...r, text: restored }];
        }),
      );
    } catch (error) {
      if (error instanceof EngineError && error.code === 'truncated' && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const [a, b] = [
          await call(batch.slice(0, mid), feedback, freeze),
          await call(batch.slice(mid), feedback, freeze),
        ];
        return new Map([...a, ...b]);
      }
      if (error instanceof EngineError && FATAL.includes(error.code)) throw error;
      if (error instanceof EngineError && error.code === 'refusal') {
        return new Map(batch.map((s) => [s.id, { id: s.id, text: '', notes: ['refused'] }]));
      }
      if (error instanceof EngineError) return new Map(); // bad-response / truncated single → retry path
      throw error;
    }
  }

  const fresh: [string, CacheEntry][] = [];
  async function runBatch(batch: SegmentRequest[]) {
    let failing = batch;
    const lastIssues = new Map<string, ValidationIssue[]>();
    const attempts = new Map<string, number>();
    const accept = (req: SegmentRequest, r: SegmentResult, issues: ValidationIssue[]) => {
      const notes = r.notes ?? [];
      outcomes.set(req.id, {
        id: req.id,
        text: r.text,
        untranslated: false,
        cached: false,
        attempts: attempts.get(req.id) ?? 1,
        issues,
        notes,
        findings: [],
      });
      fresh.push([keyOf.get(req.id)!, notes.length ? { text: r.text, notes } : { text: r.text }]);
    };
    const round = async (reqs: SegmentRequest[], feedback?: string) => {
      // Machine translators answer a retry the same way; numbers they changed are frozen.
      const freeze = new Set(
        engine.capabilities.glossary
          ? []
          : reqs
              .filter((r) =>
                lastIssues
                  .get(r.id)
                  ?.some((i) => i.code === 'NUMBER_MISMATCH' || i.code === 'CITATION_MISMATCH'),
              )
              .map((r) => r.id),
      );
      const results = await call(reqs, feedback, freeze);
      const stillFailing: SegmentRequest[] = [];
      for (const req of reqs) {
        attempts.set(req.id, (attempts.get(req.id) ?? 0) + 1);
        const r = results.get(req.id);
        if (r?.notes?.includes('refused')) {
          lastIssues.set(req.id, [
            { code: 'REFUSED', severity: 'error', detail: 'the model declined this segment' },
          ]);
          continue; // retrying a refusal does not help
        }
        const issues = r
          ? validate(req, r.text, r.notes ?? [])
          : [
              {
                code: 'EMPTY' as const,
                severity: 'error' as const,
                detail: 'missing from response',
              },
            ];
        if (r && !issues.some((i) => i.severity === 'error')) accept(req, r, issues);
        else {
          lastIssues.set(req.id, issues);
          stillFailing.push(req);
        }
      }
      return stillFailing;
    };
    const feedbackFor = (reqs: SegmentRequest[]) =>
      reqs
        .map(
          (r) =>
            `- ${r.id}: ${(lastIssues.get(r.id) ?? [])
              .filter((i) => i.severity === 'error')
              .map((i) => `${i.code} (${i.detail})`)
              .join('; ')}`,
        )
        .join('\n');

    failing = await round(failing);
    if (failing.length) failing = await round(failing, feedbackFor(failing));
    const individually: SegmentRequest[] = [];
    for (const req of failing) individually.push(...(await round([req], feedbackFor([req]))));
    // Machine translators can rewrite a long paragraph the same way on every try (a sentence,
    // a year or a citation that is not in the source); sentence by sentence they rarely do.
    const unresolved: SegmentRequest[] = [];
    for (const req of individually) {
      const pieces = engine.capabilities.glossary ? null : sentencePieces(req.text);
      if (!pieces) {
        unresolved.push(req);
        continue;
      }
      const parts = pieces.map((text, k) => ({ ...req, id: `${req.id}~${k + 1}`, text }));
      const numbersChanged = lastIssues
        .get(req.id)
        ?.some((i) => i.code === 'NUMBER_MISMATCH' || i.code === 'CITATION_MISMATCH');
      const results = await call(
        parts,
        undefined,
        numbersChanged ? new Set(parts.map((p) => p.id)) : undefined,
      );
      attempts.set(req.id, (attempts.get(req.id) ?? 0) + 1);
      const texts = parts.map((p) => results.get(p.id)?.text ?? '');
      if (texts.some((t) => !t.trim())) {
        unresolved.push(req);
        continue;
      }
      const notes = [
        ...new Set(['sentences', ...parts.flatMap((p) => results.get(p.id)?.notes ?? [])]),
      ];
      const text = texts.map((t) => t.trim()).join(' ');
      const issues = validate(req, text, notes);
      if (issues.some((i) => i.severity === 'error')) {
        // Reported against the original text that is kept: not "translated sentence by sentence".
        lastIssues.set(
          req.id,
          issues.filter((i) => i.severity !== 'info'),
        );
        unresolved.push(req);
      } else accept(req, { id: req.id, text, notes }, issues);
    }
    for (const req of unresolved.concat(
      batch.filter((b) => !outcomes.has(b.id) && !unresolved.includes(b)),
    )) {
      if (outcomes.has(req.id)) continue;
      outcomes.set(req.id, {
        id: req.id,
        text: originalText.get(req.id) ?? req.text,
        untranslated: true,
        cached: false,
        attempts: attempts.get(req.id) ?? 0,
        issues: lastIssues.get(req.id) ?? [],
        notes: [],
        findings: [],
      });
    }
    done += batch.length;
    job.onProgress?.(done, segments.length);
  }

  const batches = makeBatches(pending, engine.maxBatchChars);
  await pool(batches, engine.runsOn === 'main' ? 1 : (job.concurrency ?? 2), runBatch);

  if (job.fidelityCheck && engine.checkFidelity) {
    const toCheck = segments
      .map((s) => ({ s, o: outcomes.get(s.id)! }))
      .filter(({ s, o }) => !o.untranslated && !(o.cached && hits.get(keyOf.get(s.id)!)?.findings));
    const pairs = toCheck.map(({ s, o }) => ({
      id: s.id,
      source: s.text,
      target: o.text,
      text: s.text + o.text,
      ...(s.verbatim ? { verbatim: s.verbatim } : {}),
    }));
    const size = Math.min(FIDELITY_BATCH_CHARS, engine.maxBatchChars);
    let checked = 0;
    job.onProgress?.(0, pairs.length, 'check');
    const workers = engine.runsOn === 'main' ? 1 : (job.concurrency ?? 2);
    await pool(makeBatches(pairs, size), workers, async (batch) => {
      signal.throwIfAborted();
      const { findings, back } = await engine.checkFidelity!(
        batch.map(({ text: _, ...pair }) => pair),
        ctx,
        signal,
      );
      for (const p of batch) {
        const o = outcomes.get(p.id)!;
        o.findings = findings.filter((f) => f.id === p.id);
        if (back?.[p.id]) o.back = back[p.id];
        fresh.push([
          keyOf.get(p.id)!,
          {
            text: o.text,
            ...(o.notes.length ? { notes: o.notes } : {}),
            findings: o.findings,
            ...(o.back ? { back: o.back } : {}),
          },
        ]);
      }
      checked += batch.length;
      job.onProgress?.(checked, pairs.length, 'check');
    });
    for (const o of outcomes.values()) {
      for (const f of o.findings) {
        o.issues.push({
          code: 'MEANING_DRIFT',
          severity: 'warning',
          detail: `${f.severity}: ${f.issue}${f.backTranslation ? ` — back-translation: “${f.backTranslation}”` : ''}`,
        });
      }
    }
  }

  if (job.cache && fresh.length) await job.cache.set(fresh);
  // After caching: the cache keeps the engine's text, the option applies on every run.
  if (job.localCitations) {
    for (const o of outcomes.values()) {
      if (!o.untranslated) o.text = localizeEtAl(o.text, ctx.pair.target);
    }
  }
  return segments.map((s) => outcomes.get(s.id)!);
}

/**
 * The sentences of a tagged paragraph, when it has several and no inline formatting spans a
 * sentence boundary; null otherwise.
 */
export function sentencePieces(tagged: string): string[] | null {
  const pieces = splitSentences(tagged)
    .map((t) => t.trim())
    .filter(Boolean);
  if (pieces.length < 2) return null;
  for (const piece of pieces) {
    const open: string[] = [];
    for (const t of tokenize(piece)) {
      if (t.type === 'open') open.push(t.id);
      else if (t.type === 'close' && open.pop() !== t.id) return null;
    }
    if (open.length) return null;
  }
  return pieces;
}

export interface CostEstimate {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** Rough token estimate shown before paid runs (TRANSLATION.md §8). Never shows prices. */
export function estimateCost(
  job: Pick<TranslateJob, 'engine' | 'segments' | 'ctx' | 'fidelityCheck'>,
): CostEstimate {
  const charsPerToken = ['ru', 'uk', 'bg', 'el'].includes(job.ctx.pair.target) ? 2.5 : 3.5;
  const system = translationSystemPrompt({ ...job.ctx });
  const batches = makeBatches(job.segments, job.engine.maxBatchChars);
  let input = 0;
  let output = 0;
  for (const b of batches) {
    input += (system.length + translationUserMessage(b, { ...job.ctx }).length) / charsPerToken;
    output += (b.reduce((n, s) => n + s.text.length, 0) * 1.3) / charsPerToken;
  }
  let requests = batches.length;
  if (job.fidelityCheck && job.engine.checkFidelity) {
    const fidelityBatches = makeBatches(job.segments, FIDELITY_BATCH_CHARS / 2.3).length;
    requests += fidelityBatches;
    input +=
      (job.segments.reduce((n, s) => n + s.text.length, 0) * 2.3) / charsPerToken +
      fidelityBatches * 400;
    output += fidelityBatches * 300;
  }
  return { requests, inputTokens: Math.round(input), outputTokens: Math.round(output) };
}
