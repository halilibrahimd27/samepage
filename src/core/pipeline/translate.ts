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
import { glossaryHash } from '../glossary/glossary';
import { plainText } from '../segment/codec';
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
}

export interface TranslateJob {
  engine: TranslationEngine;
  segments: SegmentRequest[];
  ctx: Omit<TranslateContext, 'previousText' | 'retryFeedback'>;
  signal: AbortSignal;
  cache?: TranslationCache;
  concurrency?: number;
  fidelityCheck?: boolean;
  onProgress?: (done: number, total: number) => void;
}

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
  const { engine, segments, signal } = job;
  const ctx: TranslateContext = { ...job.ctx };
  const checkLanguage = engine.id !== 'pseudo';
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
    });
    if (notes.includes('style-approximated')) {
      issues.push({
        code: 'STYLE_APPROXIMATED',
        severity: 'warning',
        detail: 'inline styles re-applied approximately',
      });
    }
    return issues;
  };

  const pending: SegmentRequest[] = [];
  for (const s of segments) {
    const hit = hits.get(keyOf.get(s.id)!);
    if (hit) {
      outcomes.set(s.id, {
        id: s.id,
        text: hit.text,
        untranslated: false,
        cached: true,
        attempts: 0,
        issues: validate(s, hit.text, hit.notes ?? []).filter((i) => i.severity === 'warning'),
        notes: hit.notes ?? [],
        findings: hit.findings ?? [],
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

  /** One engine call; splits the batch when the output was truncated. */
  async function call(
    batch: SegmentRequest[],
    feedback?: string,
  ): Promise<Map<string, SegmentResult>> {
    signal.throwIfAborted();
    const prev = previousSource(batch[0]!.id);
    const callCtx: TranslateContext = {
      ...ctx,
      ...(prev ? { previousText: prev } : {}),
      ...(feedback ? { retryFeedback: feedback } : {}),
    };
    try {
      const results = await engine.translate(batch, callCtx, signal);
      return new Map(results.map((r) => [r.id, r]));
    } catch (error) {
      if (error instanceof EngineError && error.code === 'truncated' && batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const [a, b] = [
          await call(batch.slice(0, mid), feedback),
          await call(batch.slice(mid), feedback),
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
      const results = await call(reqs, feedback);
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
    for (const req of individually.concat(
      batch.filter((b) => !outcomes.has(b.id) && !individually.includes(b)),
    )) {
      if (outcomes.has(req.id)) continue;
      outcomes.set(req.id, {
        id: req.id,
        text: req.text,
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
    }));
    await pool(makeBatches(pairs, FIDELITY_BATCH_CHARS), job.concurrency ?? 2, async (batch) => {
      signal.throwIfAborted();
      const findings = await engine.checkFidelity!(
        batch.map(({ id, source, target }) => ({ id, source, target })),
        ctx,
        signal,
      );
      for (const p of batch) {
        const o = outcomes.get(p.id)!;
        o.findings = findings.filter((f) => f.id === p.id);
        fresh.push([
          keyOf.get(p.id)!,
          { text: o.text, ...(o.notes.length ? { notes: o.notes } : {}), findings: o.findings },
        ]);
      }
    });
    for (const o of outcomes.values()) {
      for (const f of o.findings) {
        o.issues.push({
          code: 'MEANING_DRIFT',
          severity: 'warning',
          detail: `${f.severity}: ${f.issue}`,
        });
      }
    }
  }

  if (job.cache && fresh.length) await job.cache.set(fresh);
  return segments.map((s) => outcomes.get(s.id)!);
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
