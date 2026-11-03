import type { StoredOutcome } from '../project';
import { localizeEtAl } from '../glossary/citations';
import {
  PROMPT_VERSION,
  translationSystemPrompt,
  translationUserMessage,
} from '../../engines/prompt';
import {
  EngineError,
  type FidelityFinding,
  type LangPair,
  type PostEditItem,
  type SegmentRequest,
  type SegmentResult,
  type TranslateContext,
  type TranslationEngine,
} from '../../engines/types';
import { cacheKey, type CacheEntry, type TranslationCache } from '../cache/cache';
import {
  academicHeading,
  documentAcronyms,
  isNameList,
  isOrcidAuthorLine,
  keepAsWritten,
  metricGlossary,
  runInLabels,
  usesMetrics,
} from '../glossary/academic';
import { inScriptOf, paragraphLanguage } from '../detectLanguage';
import { glossaryHash } from '../glossary/glossary';
import { protectNumbers, protectTerms, restoreTerms, withBuiltInNames } from '../glossary/protect';
import { splitSentences } from '../../engines/plainText';
import { plainText, tokenize } from '../segment/codec';
import { createDehyphenator } from '../segment/dehyphenate';
import { keepNumberSpelling } from '../validate/numbers';
import { compareMeaning, cueText } from '../validate/meaning';
import { softenClaims } from './hedges';
import { SAME_LABEL, validateTranslation, type ValidationIssue } from '../validate/validate';

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
  /**
   * Hybrid quality (P9.3): translations the meaning check flags are revised by this engine (an
   * LLM under the user's own key), with the source, the finding and the back-translation.
   */
  postEditor?: TranslationEngine;
  /** Progress of the translation, then (phase 'check') of the meaning check. */
  onProgress?: (done: number, total: number, phase?: ProgressPhase) => void;
  /**
   * A reopened project (P9.5): translations by source text, used instead of the engine, which is
   * not called. A segment the project lacks stays untranslated and is reported.
   */
  replay?: Record<string, StoredOutcome>;
  /** Every segment is in the pair's source language (a part split off by its own language). */
  oneLanguage?: boolean;
}

/**
 * 'check': the meaning check after translation (back-translation or Claude review); 'polish':
 * flagged translations revised by an LLM.
 */
export type ProgressPhase = 'check' | 'ocr' | 'polish';

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
/** The prompt version in the cache key: LLM engines write the chosen English spelling. */
const promptVersion = (engine: TranslationEngine, ctx: TranslateContext) =>
  engine.capabilities.glossary && ctx.pair.target === 'en' && ctx.englishSpelling
    ? `${PROMPT_VERSION}:${ctx.englishSpelling}`
    : PROMPT_VERSION;

/**
 * Segments written in another language than the document's are translated from their own (an
 * English abstract of a Turkish paper, the Arabic body of a paper whose abstract is English):
 * given as the document's language, the engine returns them as they were or makes up text.
 * Those already in the target language stay as written. Null when all are in the source's.
 */
async function byOwnLanguage(job: TranslateJob): Promise<SegmentOutcome[] | null> {
  const { pair } = job.ctx;
  const own = new Map<string, string>();
  // Languages of the paragraphs long enough to tell (the source's when nothing else shows).
  const tally = new Map<string, number>();
  let long = 0;
  const short: SegmentRequest[] = [];
  for (const s of job.segments) {
    const plain = plainText(s.text);
    const lang = paragraphLanguage(plain, pair.source);
    if (lang && lang !== pair.source) own.set(s.id, lang);
    if ((plain.match(/\p{L}+/gu)?.length ?? 0) >= 8) {
      long++;
      tally.set(lang ?? pair.source, (tally.get(lang ?? pair.source) ?? 0) + 1);
    } else if (!lang) short.push(s);
  }
  // A paper mostly in another language than the one given (an Indonesian paper taken for
  // English): its short lines that tell nothing ("1 = sangat tidak dikenal") are in it too.
  const [major, n] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? [pair.source, 0];
  if (major !== pair.source && long >= 5 && n > 0.5 * long)
    for (const s of short)
      if (/\p{L}{2}/u.test(plainText(s.text)) && inScriptOf(plainText(s.text), major))
        own.set(s.id, major);
  if (!own.size) return null;
  const outcomes = new Map<string, SegmentOutcome>();
  const groups = new Map<string, SegmentRequest[]>();
  for (const s of job.segments) {
    const lang = own.get(s.id);
    if (lang === pair.target)
      outcomes.set(s.id, {
        id: s.id,
        text: s.text,
        untranslated: false,
        cached: false,
        attempts: 0,
        issues: [],
        notes: ['in-target'],
        findings: [],
      });
    else if (lang) groups.set(lang, [...(groups.get(lang) ?? []), s]);
  }
  // A language the engine does not translate from stays with the document's.
  for (const lang of [...groups.keys()])
    if ((await job.engine.isAvailable({ source: lang, target: pair.target })) === 'unavailable')
      groups.delete(lang);
  const split = new Set([...groups.values()].flat());
  const parts: [SegmentRequest[], string][] = [
    [job.segments.filter((s) => !outcomes.has(s.id) && !split.has(s)), pair.source],
    ...[...groups].map(([lang, segments]): [SegmentRequest[], string] => [segments, lang]),
  ];
  let done = outcomes.size;
  // One after another: the browser engines keep one language pair open at a time.
  for (const [segments, source] of parts) {
    if (!segments.length) continue;
    const base = done;
    const results = await translateSegments({
      ...job,
      segments,
      ctx: { ...job.ctx, pair: { source, target: pair.target } },
      oneLanguage: true,
      onProgress: (n, total, phase) =>
        phase ? job.onProgress?.(n, total, phase) : job.onProgress?.(base + n, job.segments.length),
    });
    for (const r of results) outcomes.set(r.id, r);
    done += segments.length;
  }
  return job.segments.map((s) => outcomes.get(s.id)!);
}

/** A label of one word, maybe after its number ("KUR", "2 · Süreç"): prefix and word. */
export const ONE_WORD_LABEL = /^([\p{N}\p{P}\p{S}\s]*?)(\p{L}{3,})\s*$/u;

export async function translateSegments(job: TranslateJob): Promise<SegmentOutcome[]> {
  if (!job.replay && !job.oneLanguage) {
    const split = await byOwnLanguage(job);
    if (split) return split;
  }
  if (job.replay) {
    const replay = job.replay;
    job.onProgress?.(job.segments.length, job.segments.length);
    return job.segments.map((s) => {
      const stored = Object.hasOwn(replay, s.text) ? replay[s.text] : undefined;
      return stored
        ? // From the project file, not from this browser's cache.
          { id: s.id, ...stored, cached: false, attempts: 0 }
        : {
            id: s.id,
            text: s.text,
            untranslated: true,
            cached: false,
            attempts: 0,
            issues: [
              {
                code: 'UNTRANSLATED',
                severity: 'error',
                detail: 'not in the project file; translate the document again to include it',
              },
            ],
            notes: [],
            findings: [],
          };
    });
  }
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
  // The built-in software names ("Python", "npm") are protected the same way, glossary or not.
  const protecting = !engine.capabilities.glossary;
  const protectedTerms = protecting ? withBuiltInNames(glossary) : glossary;
  // Cached text from before the built-in names or the number spelling must not be reused.
  const gHash = await glossaryHash(
    protecting
      ? [
          ...ctx.glossary,
          { source: 'machine-v1', target: '', note: 'built-in names, number spelling' },
        ]
      : ctx.glossary,
  );
  const keys = await Promise.all(
    segments.map((s) =>
      cacheKey({
        engineId: engine.id,
        model: engine.model ?? '',
        source: ctx.pair.source,
        target: ctx.pair.target,
        promptVersion: promptVersion(engine, ctx),
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
    if (notes.includes('pieced')) {
      issues.push({
        code: 'MEANING_DRIFT',
        severity: 'error',
        detail: 'the engine translated the words between held numbers piece by piece',
      });
    }
    if (notes.includes('numbers-held')) {
      issues.push({
        code: 'REVIEW_SUGGESTED',
        severity: 'warning',
        detail:
          'the engine kept changing a number, so it was held in place; please check the wording around it',
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
  const acronyms = documentAcronyms(segments.map((s) => plainText(s.text)));
  const acronymNames = [...acronyms].map((a) => ({ source: a, target: a, exact: true }));
  for (const s of segments) {
    const hit = hits.get(keyOf.get(s.id)!);
    const heading = headings
      ? academicHeading(s.text, ctx.pair.source, ctx.pair.target, metrics, s.role === 'heading')
      : null;
    // Author lines with affiliation marks stay as they are (marks: superscripts, *, ∗, †).
    // So do authors each with an ORCID link, the link set aside or not.
    const linked = plainText(
      s.text.replace(/⟦([A-Z]\d+)⟧/g, (m, id: string) => s.verbatim?.[id] ?? m),
    );
    const authors =
      heading === null &&
      ((/⟦N\d+⟧|[*∗†‡§¶]/.test(s.text) && isNameList(plainText(s.text).replace(/[*∗†‡§¶]/g, ''))) ||
        isOrcidAuthorLine(linked));
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
    } else if (heading === null && keepAsWritten(plainText(s.text), acronyms)) {
      outcomes.set(s.id, {
        id: s.id,
        text: s.text,
        untranslated: false,
        cached: false,
        attempts: 0,
        issues: [],
        notes: ['as-written'],
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

  /** A label of one word and the sentence that gives its sense: its context, or the next text. */
  const labelInContext = (s: SegmentRequest) => {
    const m = ONE_WORD_LABEL.exec(s.text);
    const next = s.context ?? segments[(indexOf.get(s.id) ?? -2) + 1]?.text;
    if (!m || !next) return null;
    const context = plainText(next)
      .replace(/⟦[^⟧]*⟧/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    if ((context.match(/\p{L}{2,}/gu) ?? []).length < 3) return null;
    // Text already in the target language is not sent (kept as written), nor as a context.
    if (paragraphLanguage(context, ctx.pair.source) === ctx.pair.target) return null;
    return {
      prefix: m[1]!,
      word: m[2]!,
      context: (splitSentences(context)[0] ?? context).slice(0, 200),
    };
  };
  const inCaps = (w: string, lang: string) =>
    w === w.toLocaleUpperCase(lang) && w !== w.toLocaleLowerCase(lang);

  /**
   * A label of one word is a dictionary entry to a machine translator: alone it takes the most
   * common sense ("KUR" → "CURE", "SÜREÇ" → "PERIOD"). Asked once more ahead of the sentence
   * after it ("Kur: Geliştirici paketi kurar; …"), the sense comes from that sentence
   * ("Installation: …"): the part before the colon is the label's, when the answer keeps it.
   * Measured on labels of one word only — a phrase reads well alone, and in context
   * "30 dakikada sertleştirme" became "Erection in 30 minutes".
   */
  async function inContext(
    batch: SegmentRequest[],
    results: Map<string, SegmentResult>,
    callCtx: TranslateContext,
  ): Promise<Map<string, SegmentResult>> {
    const src = ctx.pair.source;
    const labels = batch.flatMap((s) => {
      const l = labelInContext(s);
      return l ? [{ s, ...l }] : [];
    });
    if (!labels.length) return results;
    try {
      const answers = await engine.translate(
        labels.map(({ s, word, context }) => ({
          ...s,
          id: `${s.id}~context`,
          text: `${inCaps(word, src) ? word[0] + word.slice(1).toLocaleLowerCase(src) : word}: ${context}`,
        })),
        callCtx,
        signal,
      );
      const byId = new Map(answers.map((a) => [a.id, a.text]));
      for (const { s, prefix, word } of labels) {
        const m = /^([^:：]{1,60})[:：]\s*\S/u.exec((byId.get(`${s.id}~context`) ?? '').trim());
        const part = m?.[1]!.trim();
        if (!part || !/\p{L}/u.test(part) || part.split(/\s+/u).length > 3) continue;
        const own = results.get(s.id);
        results.set(s.id, {
          ...own,
          id: s.id,
          text: prefix + (inCaps(word, src) ? part.toLocaleUpperCase(ctx.pair.target) : part),
          notes: [...(own?.notes ?? []), 'in-context'],
        });
      }
    } catch (error) {
      // The label alone stands.
      if (error instanceof EngineError && FATAL.includes(error.code)) throw error;
    }
    return results;
  }

  /**
   * One engine call; splits the batch when the output was truncated. Segments in `freeze` get
   * their numbers frozen as placeholders (a retry after an engine changed a number). A first
   * call to a machine translator also reads its one-word labels in context.
   */
  async function call(
    batch: SegmentRequest[],
    feedback?: string,
    freeze?: Set<string>,
  ): Promise<Map<string, SegmentResult>> {
    const results = await callOnce(batch, feedback, freeze);
    if (feedback || freeze?.size || engine.capabilities.glossary) return results;
    const prev = previousSource(batch[0]!.id);
    return inContext(batch, results, { ...ctx, ...(prev ? { previousText: prev } : {}) });
  }

  async function callOnce(
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
        // A label has no sentence around its acronyms: they go as names.
        const plain = plainText(s.text).trim();
        const short = !/[.!?]$/u.test(plain) && plain.split(/\s+/u).length <= 5;
        const terms = protecting
          ? protectTerms(
              s.text,
              short ? [...protectedTerms, ...acronymNames] : protectedTerms,
              ctx.pair.source,
            )
          : { text: s.text, targets: [] };
        const numbers = freeze?.has(s.id)
          ? protectNumbers(terms.text, ctx.pair.target)
          : { text: terms.text, targets: [] };
        return {
          req: s,
          text: numbers.text,
          terms: terms.targets,
          exact: terms.exact,
          numbers: numbers.targets,
        };
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
          const restored =
            numbers === null ? null : restoreTerms(numbers, p?.terms ?? [], 'G', p?.exact);
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
    /**
     * The last translation whose only fault is a number the source does not write in digits
     * ("końca osiemnastego wieku" → "18. yüzyılın sonu"): taken, flagged for review, when no
     * try does better, rather than leaving the paragraph in the source language.
     */
    const onlyAddedNumbers = new Map<string, { r: SegmentResult; issues: ValidationIssue[] }>();
    const remember = (
      req: SegmentRequest,
      r: SegmentResult,
      issues: ValidationIssue[],
      bySentence = false,
    ) => {
      const errors = issues.filter((i) => i.severity === 'error');
      // One or two small numbers only ("18" for "osiemnastego"): years an engine made up
      // ("2018, 2019, 2023" in a decree's dates) are no spelled-out number.
      // A source number written once more ("29 de março … de 2020" → "29 Mart 2020 … 2020") is
      // no made-up one either.
      const digits = (v: string) => v.replace(/[\s.,]/gu, '');
      const inSource = new Set(
        (plainText(req.text).match(/\d+(?:[\s.,]\d+)*/gu) ?? []).map(digits),
      );
      const small = (i: ValidationIssue) => {
        const values = i.detail.replace(/^unexpected /u, '').split(/,\s*/u);
        return (
          (values.length <= 2 && values.every((v) => /^\d{1,2}$/u.test(v.trim()))) ||
          values.every((v) => inSource.has(digits(v)))
        );
      };
      // Translated sentence by sentence, each piece came back: fewer sentences counted is the
      // engine joining two, nothing left out.
      const joined = (i: ValidationIssue) => bySentence && i.code === 'SENTENCE_LOST';
      // A sentence broken at a number, or pieced around held numbers, on every try: the words
      // are there, flagged for review.
      const broken = (i: ValidationIssue) =>
        i.code === 'PUNCTUATION_CHANGED' ||
        (i.code === 'MEANING_DRIFT' && (r.notes ?? []).includes('pieced'));
      if (
        errors.length &&
        errors.every(
          (i) =>
            joined(i) ||
            broken(i) ||
            (i.code === 'NUMBER_MISMATCH' && /^unexpected /u.test(i.detail) && small(i)),
        )
      )
        onlyAddedNumbers.set(req.id, {
          r,
          issues: issues.map((i) => (i.severity === 'error' ? { ...i, severity: 'warning' } : i)),
        });
    };
    const attempts = new Map<string, number>();
    const accept = (req: SegmentRequest, r: SegmentResult, issues: ValidationIssue[]) => {
      const notes = r.notes ?? [];
      // Machine translators localise some decimals in running text but not in table cells.
      const spelled =
        engine.capabilities.glossary || ctx.numberLocalization
          ? r.text
          : keepNumberSpelling(req.text, r.text);
      // A structured abstract's labels in the field's terms ("Results" → "Bulgular").
      const text = runInLabels(req.text, spelled, ctx.pair.source, ctx.pair.target);
      r = { ...r, text };
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
      fresh.push([keyOf.get(req.id)!, notes.length ? { text, notes } : { text }]);
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
          if (r) remember(req, r, issues);
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
      const translate = async (freeze?: Set<string>) => {
        const results = await call(parts, undefined, freeze);
        attempts.set(req.id, (attempts.get(req.id) ?? 0) + 1);
        const texts = parts.map((p) => results.get(p.id)?.text ?? '');
        if (texts.some((t) => !t.trim())) return null;
        const notes = [
          ...new Set(['sentences', ...parts.flatMap((p) => results.get(p.id)?.notes ?? [])]),
        ];
        const text = texts.map((t) => t.trim()).join(' ');
        return { r: { id: req.id, text, notes }, issues: validate(req, text, notes) };
      };
      const failed = (t: { issues: ValidationIssue[] } | null) =>
        !t || t.issues.some((i) => i.severity === 'error');
      // Plain first: one sentence alone rarely makes the engine change a number, and held numbers
      // are translated around piece by piece. Held only when plain sentences still differ.
      const plain = await translate();
      const held =
        failed(plain) && numbersChanged ? await translate(new Set(parts.map((p) => p.id))) : null;
      const best = !failed(held) ? held : (plain ?? held);
      if (!best) {
        unresolved.push(req);
        continue;
      }
      if (failed(best)) {
        // The plain sentences are kept over held ones the engine pieced, when they may be.
        for (const t of [held, plain]) if (t) remember(req, t.r, t.issues, true);
        // Reported against the original text that is kept: not "translated sentence by sentence".
        lastIssues.set(
          req.id,
          best.issues.filter((i) => i.severity !== 'info'),
        );
        unresolved.push(req);
      } else accept(req, best.r, best.issues);
    }
    for (const req of unresolved.concat(
      batch.filter((b) => !outcomes.has(b.id) && !unresolved.includes(b)),
    )) {
      if (outcomes.has(req.id)) continue;
      const added = onlyAddedNumbers.get(req.id);
      if (added) {
        accept(req, added.r, added.issues);
        continue;
      }
      const issues = lastIssues.get(req.id) ?? [];
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length && errors.every((i) => i.detail === SAME_LABEL)) {
        outcomes.set(req.id, {
          id: req.id,
          text: originalText.get(req.id) ?? req.text,
          untranslated: false,
          cached: false,
          attempts: attempts.get(req.id) ?? 0,
          issues: [
            ...issues.filter((i) => i.severity !== 'error'),
            {
              code: 'UNTRANSLATED',
              severity: 'info',
              detail: 'kept as is: it came back as it was on every try',
            },
          ],
          notes: ['as-written'],
          findings: [],
        });
        continue;
      }
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
  // Each batch is kept as it is done: a long book stopped by the engine (Google limiting a
  // network for a while) goes on later from where it stopped, not from its first page. What the
  // meaning check has not read yet carries no findings and is read on the next run.
  await pool(batches, engine.runsOn === 'main' ? 1 : (job.concurrency ?? 2), async (batch) => {
    await runBatch(batch);
    if (job.cache && fresh.length) await job.cache.set(fresh.splice(0));
  });

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

  /**
   * Hybrid quality (P9.3): what the meaning check flagged goes to the post-editor with the
   * source, the finding and the back-translation. A revision replaces the draft only if it
   * passes the same validation; the finding stays in the report as revised.
   */
  async function postEdit(editor: TranslationEngine) {
    const flagged = segments
      .map((s) => ({ s, o: outcomes.get(s.id)! }))
      .filter(({ o }) => !o.untranslated && o.findings.length > 0);
    if (!flagged.length) return;
    const peKeys = await Promise.all(
      flagged.map(({ s, o }) =>
        cacheKey({
          engineId: `post-edit/${editor.id}`,
          model: editor.model ?? '',
          source: ctx.pair.source,
          target: ctx.pair.target,
          promptVersion: promptVersion(editor, ctx),
          glossaryHash: gHash,
          numberLocalization: ctx.numberLocalization,
          role: s.role,
          text: `${s.text}\u2028${o.text}`,
        }),
      ),
    );
    const peHits = job.cache ? await job.cache.get(peKeys) : new Map<string, CacheEntry>();
    const revised = new Map<string, string>();
    const todo: (PostEditItem & { text: string })[] = [];
    flagged.forEach(({ s, o }, k) => {
      const hit = peHits.get(peKeys[k]!);
      if (hit) revised.set(s.id, hit.text);
      else
        todo.push({
          id: s.id,
          role: s.role,
          source: s.text,
          draft: o.text,
          findings: o.findings.map((f) => `${f.severity}: ${f.issue}`),
          ...(o.back ? { back: o.back } : {}),
          text: s.text + o.text,
        });
    });
    let polished = 0;
    job.onProgress?.(0, todo.length, 'polish');
    await pool(makeBatches(todo, editor.maxBatchChars), 1, async (batch) => {
      signal.throwIfAborted();
      const results = await editor.postEdit!(
        batch.map(({ text: _, ...item }) => item),
        ctx,
        signal,
      );
      for (const r of results) revised.set(r.id, r.text);
      polished += batch.length;
      job.onProgress?.(polished, todo.length, 'polish');
    });
    flagged.forEach(({ s, o }, k) => {
      const text = revised.get(s.id);
      if (text === undefined) return;
      const problems = validateTranslation({
        source: s.text,
        target: text,
        sourceLang: ctx.pair.source,
        targetLang: ctx.pair.target,
        glossary: ctx.glossary,
        checkLanguage,
        checkChatter: true,
      }).filter((i) => i.severity === 'error');
      if (problems.length) return;
      if (!peHits.has(peKeys[k]!)) fresh.push([peKeys[k]!, { text }]);
      const findings = o.findings.map((f) => f.issue).join('; ');
      o.text = text;
      o.notes.push('post-edited');
      // The back-translation was of the draft.
      delete o.back;
      o.issues = o.issues.filter((i) => i.code !== 'MEANING_DRIFT');
      o.issues.push({
        code: 'POST_EDITED',
        severity: 'info',
        detail: `revised by ${editor.label} after the meaning check found: ${findings}`,
      });
    });
  }

  /**
   * Free repair, without a post-editor: what the meaning check flagged (a "not" or a "may" a
   * machine translator dropped inside a long paragraph) is translated again sentence by
   * sentence, alone, and checked again. It replaces the draft only when the check then finds
   * nothing; otherwise the finding stays for the reader.
   */
  async function selfRepair() {
    const flagged = segments
      .map((s) => ({ s, o: outcomes.get(s.id)! }))
      .filter(({ o }) => !o.untranslated && o.findings.length > 0)
      .slice(0, 40);
    const checksOut = async (s: SegmentRequest, text: string) => {
      const problems = validateTranslation({
        source: s.text,
        target: text,
        sourceLang: ctx.pair.source,
        targetLang: ctx.pair.target,
        glossary: ctx.glossary,
        checkLanguage,
        checkChatter: true,
      }).filter((i) => i.severity === 'error' && i.code !== 'SENTENCE_LOST');
      if (problems.length) return false;
      const again = await engine.checkFidelity!(
        [
          {
            id: s.id,
            source: s.text,
            target: text,
            ...(s.verbatim ? { verbatim: s.verbatim } : {}),
          },
        ],
        ctx,
        signal,
      ).catch(() => null);
      if (!again) return false;
      return !again.findings.length || (await sameInEnglish(s, text));
    };
    /**
     * A second opinion: the translation in English, read against the source with each one's own
     * cues. A back-translation can go wrong itself ("bakımsız kalan çocuklar" came back as
     * "children in care"); the source is not translated again, so an engine that drops a
     * negation from it cannot drop it on both sides.
     */
    const inEnglish = async (items: { s: SegmentRequest; text: string }[]) => {
      const out = new Map<string, string>();
      if (ctx.pair.target === 'en') {
        for (const { s, text } of items) out.set(s.id, text);
        return out;
      }
      // In as few calls as fit: each change of language pair reloads a browser engine's helper.
      const requests = items.map(({ s, text }) => ({ ...s, id: `${s.id}~en`, text }));
      for (const batch of makeBatches(requests, engine.maxBatchChars)) {
        const results = await engine
          .translate(
            batch,
            { ...ctx, glossary: [], pair: { source: ctx.pair.target, target: 'en' } },
            signal,
          )
          .catch(() => null);
        for (const r of results ?? []) out.set(r.id.replace(/~en$/u, ''), r.text);
      }
      return out;
    };
    const soundIn = (s: SegmentRequest, english: string | undefined) =>
      !!english?.trim() &&
      compareMeaning(
        cueText(s.text, s.verbatim),
        cueText(english, s.verbatim),
        ctx.pair.source,
        'en',
      ).length === 0;
    const sameInEnglish = async (s: SegmentRequest, text: string): Promise<boolean> =>
      ctx.pair.source !== 'en' && soundIn(s, (await inEnglish([{ s, text }])).get(s.id));
    const soften = (s: SegmentRequest, text: string) =>
      softenClaims(s.text, text, ctx.pair.source, ctx.pair.target);
    const adoptFor = (
      s: SegmentRequest,
      o: SegmentOutcome,
      found: string,
      text: string,
      note: string,
      detail: string,
    ) => {
      o.text = text;
      o.findings = [];
      delete o.back;
      o.notes.push(note);
      o.issues = o.issues.filter((i) => i.code !== 'MEANING_DRIFT');
      o.issues.push({ code: 'POST_EDITED', severity: 'info', detail: `${detail}: ${found}` });
      fresh.push([keyOf.get(s.id)!, { text, notes: o.notes, findings: [] }]);
    };
    /** Texts in another language pair, in as few calls as fit. */
    const inPair = async (
      items: { id: string; s: SegmentRequest; text: string }[],
      pair: LangPair,
    ) => {
      const out = new Map<string, string>();
      const requests = items.map(({ id, s, text }) => ({ ...s, id: `${id}~via`, text }));
      for (const batch of makeBatches(requests, engine.maxBatchChars)) {
        const results = await engine
          .translate(batch, { ...ctx, glossary: [], pair }, signal)
          .catch(() => null);
        for (const r of results ?? [])
          if (r.text.trim()) out.set(r.id.replace(/~via$/u, ''), r.text);
      }
      return out;
    };
    // Every flagged translation in English at once.
    const english =
      ctx.pair.source === 'en'
        ? new Map<string, string>()
        : await inEnglish(flagged.map(({ s, o }) => ({ s, text: o.text })));
    for (const { s, o } of flagged) {
      signal.throwIfAborted();
      const found = o.findings.map((f) => f.issue).join('; ');
      // Sound in English: the flag came from the back-translation, nothing to repair.
      if (ctx.pair.source !== 'en' && soundIn(s, english.get(s.id))) {
        o.findings = [];
        delete o.back;
        o.issues = o.issues.filter((i) => i.code !== 'MEANING_DRIFT');
        fresh.push([keyOf.get(s.id)!, { text: o.text, notes: o.notes, findings: [] }]);
        continue;
      }
      const adopt = (text: string, note: string, detail: string) =>
        adoptFor(s, o, found, text, note, detail);
      // A "suggests" the engine wrote as "shows" is put back first: no new translation needed.
      const softened = soften(s, o.text);
      if (softened !== o.text && (await checksOut(s, softened))) {
        adopt(
          softened,
          'softened',
          'a claim worded as in the source after the meaning check found',
        );
        continue;
      }
      const pieces = sentencePieces(s.text) ?? [s.text];
      const parts = pieces.map((text, k) => ({ ...s, id: `${s.id}~m${k + 1}`, text }));
      const results = await call(parts).catch(() => null);
      if (!results) continue;
      const texts = parts.map((p) => results.get(p.id)?.text.trim() ?? '');
      if (texts.some((t) => !t)) continue;
      const joined = texts.join(' ');
      const spelled = ctx.numberLocalization ? joined : keepNumberSpelling(s.text, joined);
      const text = soften(s, runInLabels(s.text, spelled, ctx.pair.source, ctx.pair.target));
      if (!(await checksOut(s, text))) continue;
      adopt(
        text,
        'sentences',
        'translated again sentence by sentence after the meaning check found',
      );
    }
    // Still flagged: through English. A pair a machine translator knows less well turns a
    // sentence around ("jelentősen csökken" → "önemli ölçüde azalmamaktadır"); through English
    // it rarely does. The English must read as the source does, and the result pass the check.
    const still = flagged.filter(({ o }) => o.findings.length > 0);
    if (!still.length || ctx.pair.source === 'en' || ctx.pair.target === 'en') return;
    const viaEnglish = await inPair(
      still.map(({ s }) => ({ id: s.id, s, text: s.text })),
      { source: ctx.pair.source, target: 'en' },
    );
    const sound = still.filter(({ s }) => soundIn(s, viaEnglish.get(s.id)));
    const anew = await inPair(
      sound.map(({ s }) => ({ id: s.id, s, text: viaEnglish.get(s.id)! })),
      { source: 'en', target: ctx.pair.target },
    );
    for (const { s, o } of sound) {
      signal.throwIfAborted();
      const draft = anew.get(s.id);
      if (!draft) continue;
      const spelled = ctx.numberLocalization ? draft : keepNumberSpelling(s.text, draft);
      const text = soften(s, runInLabels(s.text, spelled, ctx.pair.source, ctx.pair.target));
      if (!(await checksOut(s, text))) continue;
      adoptFor(
        s,
        o,
        o.findings.map((f) => f.issue).join('; '),
        text,
        'via-english',
        'translated again through English after the meaning check found',
      );
    }
  }

  if (job.postEditor?.postEdit) await postEdit(job.postEditor);
  else if (job.fidelityCheck && engine.checkFidelity && !engine.capabilities.glossary)
    await selfRepair();

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
  // A run of formatting across a sentence end keeps those sentences together.
  const groups: string[] = [];
  const open: string[] = [];
  let group = '';
  for (const piece of pieces) {
    for (const t of tokenize(piece)) {
      if (t.type === 'open') open.push(t.id);
      else if (t.type === 'close' && open.pop() !== t.id) return null;
    }
    group = group ? `${group} ${piece}` : piece;
    if (!open.length) {
      groups.push(group);
      group = '';
    }
  }
  if (open.length || groups.length < 2) return null;
  return groups;
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
