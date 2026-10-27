import type { Role } from '../core/ir/types';
import type { GlossaryEntry } from '../core/validate/validate';
import type { EngineId, Privacy } from './catalog';

export type { EngineId, Privacy };
export type LangPair = { source: string; target: string };

export interface SegmentRequest {
  id: string;
  /** Tagged source: "<t1>…</t1> ⟦F1⟧ …" */
  text: string;
  role: Role;
  /** Soft length limit (PDF only). */
  budgetChars?: number;
  /**
   * Text of the ⟦U⟧ placeholders (URLs, identifiers). Engines that cannot keep placeholders may
   * send it inline and put the placeholder back.
   */
  verbatim?: Record<string, string>;
}

export interface SegmentResult {
  id: string;
  text: string;
  overBudget?: boolean;
  /** Engine notes, e.g. 'tags-survived' / 'style-approximated' (Chrome built-in). */
  notes?: string[];
}

export interface TranslateContext {
  pair: LangPair;
  docTitle?: string;
  headingPath?: string[];
  /** Source text preceding the batch, for coherence (not translated). */
  previousText?: string;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  /** Validator feedback from a failed attempt, appended to the retry prompt. */
  retryFeedback?: string;
}

export interface CondenseRequest {
  id: string;
  role: Role;
  source: string;
  current: string;
  maxChars: number;
  ctx: TranslateContext;
}

export interface FidelityFinding {
  id: string;
  /** Short description of the meaning difference, in the UI language of the report (English). */
  issue: string;
  severity: 'minor' | 'major';
  /** The translation translated back into the source language (back-translation check). */
  backTranslation?: string;
}

export interface FidelityResult {
  findings: FidelityFinding[];
  /** Back-translation of each checked target by id (back-translation check, source language). */
  back?: Record<string, string>;
}

export interface FidelityPair {
  id: string;
  source: string;
  target: string;
  /** Text of the ⟦U⟧ placeholders (identifiers, URLs), as in SegmentRequest.verbatim. */
  verbatim?: Record<string, string>;
}

export type Availability = 'available' | 'downloadable' | 'unavailable';

export interface TranslationEngine {
  id: EngineId;
  label: string;
  runsOn: 'main' | 'worker';
  privacy: Privacy;
  capabilities: {
    glossary: boolean;
    lengthBudget: boolean;
    tagsReliable: boolean;
    condense: boolean;
    vision: boolean;
    fidelityCheck: boolean;
  };
  /** Model id used for this run (part of the cache key); undefined for non-LLM engines. */
  model?: string;
  /** Upper bound of source characters per translate() call. */
  maxBatchChars: number;
  isAvailable(pair: LangPair): Promise<Availability>;
  prepare?(pair: LangPair, onProgress?: (fraction: number) => void): Promise<void>;
  translate(
    batch: SegmentRequest[],
    ctx: TranslateContext,
    signal: AbortSignal,
  ): Promise<SegmentResult[]>;
  condense?(req: CondenseRequest, signal: AbortSignal): Promise<string>;
  checkFidelity?(
    pairs: FidelityPair[],
    ctx: TranslateContext,
    signal: AbortSignal,
  ): Promise<FidelityResult>;
  extractGlossary?(
    sample: string,
    ctx: TranslateContext,
    signal: AbortSignal,
  ): Promise<GlossaryEntry[]>;
}

/** Thrown by engines for failures the user must fix (bad key, unreachable server…). */
export class EngineError extends Error {
  readonly code:
    | 'auth'
    | 'network'
    | 'rate-limit'
    | 'server'
    | 'bad-request'
    | 'refusal'
    | 'truncated'
    | 'bad-response'
    | 'unavailable';
  constructor(code: EngineError['code'], message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}
