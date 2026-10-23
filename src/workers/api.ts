import type { SegmentOutcome, CostEstimate } from '../core/pipeline/translate';
import type { HistoryMeta } from '../core/cache/idb';
import type { BilingualRow } from '../docx/bilingual';
import type { DocxReport } from '../docx/pipeline';
import type { InlineStyle } from '../core/segment/markup';
import type { TagDef, PlaceholderDef } from '../core/segment/types';
import type { GlossaryEntry } from '../core/validate/validate';
import type { ChromeTranslatorBridge } from '../engines/chromeBuiltin';
import type { EngineId, LangPair } from '../engines/types';
import type { PdfInspection } from '../pdf/engine';

export interface EngineSpec {
  id: EngineId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  pseudo?: { factor: number; substitute: boolean };
}

export interface TextJob {
  jobId: string;
  engine: EngineSpec;
  pair: LangPair;
  /** Paragraphs in playground markup (**bold**, *italic*, $formula$). */
  paragraphs: string[];
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  useCache: boolean;
}

export interface TextSegment {
  id: string;
  source: string;
  baseStyle: InlineStyle;
  tags: TagDef<InlineStyle>[];
  placeholders: PlaceholderDef[];
  outcome: SegmentOutcome;
}

export type JobError = {
  ok: false;
  code:
    | 'auth'
    | 'network'
    | 'rate-limit'
    | 'server'
    | 'bad-request'
    | 'unavailable'
    | 'cancelled'
    | 'rejected'
    | 'internal';
  message: string;
};

export interface DocxJob {
  jobId: string;
  file: Blob;
  engine: EngineSpec;
  pair: LangPair;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  translateComments: boolean;
  translateReferences: boolean;
  translateMetadata: boolean;
  /** Store the finished job in this device's translation history. */
  saveHistory: boolean;
  /** Review-step corrections: tagged source → tagged target. */
  overrides?: Record<string, string>;
}

export type DocxJobResult = { ok: true; bytes: Uint8Array; report: DocxReport } | JobError;

export type TextJobResult =
  | { ok: true; segments: TextSegment[]; tagSurvival: { survived: number; total: number } }
  | JobError;

/** Contract between the UI and pipeline.worker.ts (exposed through Comlink). */
export interface PipelineApi {
  /** Liveness check; resolves with 'pong'. */
  ping(): 'pong';
  /** Page count and page-1 thumbnail. The PNG buffer is transferred, not copied. */
  inspectPdf(file: Blob): Promise<PdfInspection>;
  translateText(
    job: TextJob,
    onProgress?: (done: number, total: number) => void,
    chrome?: ChromeTranslatorBridge,
  ): Promise<TextJobResult>;
  cancel(jobId: string): void;
  estimate(job: TextJob): CostEstimate;
  extractGlossary(job: TextJob): Promise<{ ok: true; entries: GlossaryEntry[] } | JobError>;
  loadGlossary(pair: LangPair): Promise<GlossaryEntry[]>;
  saveGlossary(pair: LangPair, entries: GlossaryEntry[]): Promise<void>;
  clearCache(): Promise<void>;
  translateDocx(
    job: DocxJob,
    onProgress?: (done: number, total: number) => void,
    chrome?: ChromeTranslatorBridge,
  ): Promise<DocxJobResult>;
  /** Bilingual review DOCX (source | translation | notes); the buffer is transferred. */
  bilingualDocx(
    rows: BilingualRow[],
    labels: { title: string; source: string; target: string; notes: string },
  ): Promise<Uint8Array>;
  listHistory(): Promise<HistoryMeta[]>;
  /** Translated file and report of a history entry (the file buffer is transferred). */
  getHistoryEntry(id: string): Promise<{ bytes: Uint8Array; report: unknown } | null>;
  /** Deletes one entry, or everything when id is null. */
  deleteHistory(id: string | null): Promise<void>;
  /** Glossary suggestions from a DOCX file's paragraphs. */
  extractDocxGlossary(job: DocxJob): Promise<{ ok: true; entries: GlossaryEntry[] } | JobError>;
}
