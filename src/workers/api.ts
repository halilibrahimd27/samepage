import type { SegmentOutcome, CostEstimate, ProgressPhase } from '../core/pipeline/translate';
import type { BilingualRow } from '../docx/bilingual';
import type { DocxReport } from '../docx/pipeline';
import type { PdfReport } from '../pdf/pipeline';
import type { InlineStyle } from '../core/segment/markup';
import type { TagDef, PlaceholderDef } from '../core/segment/types';
import type { GlossaryEntry } from '../core/validate/validate';
import type { ChromeTranslatorBridge } from '../engines/chromeBuiltin';
import type { EngineId, LangPair } from '../engines/types';
import type { PdfInspection, Thumbnail } from '../pdf/engine';
import type { PageIR } from '../core/ir/types';
import type { PaperParts } from '../core/abstract';
import type { TermSuggestion } from '../core/glossary/detect';
import type { ProjectManifest, StoredOutcome } from '../core/project';
import type { OpenedProject } from '../core/projectFile';

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
  /** Paragraphs in playground markup (**bold**, *italic*, $formula$), or plain text. */
  paragraphs: string[];
  /** The paragraphs are plain text (no markup). */
  plain?: boolean;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  useCache: boolean;
  /** "et al." in citations the target language's way ("vd.", "и др."). */
  localCitations?: boolean;
  /** Hybrid quality (P9.3): flagged translations revised by Claude under the user's own key. */
  polish?: { apiKey: string; model: string };
  /** English targets: the spelling LLM engines write. */
  englishSpelling?: 'american' | 'british';
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
  /** "et al." in citations the target language's way ("vd.", "и др."). */
  localCitations?: boolean;
  translateComments: boolean;
  translateReferences: boolean;
  /** Reference titles in another language translated in brackets (APA 7, P9.6). */
  referenceTitles?: boolean;
  translateMetadata: boolean;
  /** Review-step corrections: tagged source → tagged target. */
  overrides?: Record<string, string>;
  /** Hybrid quality (P9.3): flagged translations revised by Claude under the user's own key. */
  polish?: { apiKey: string; model: string };
  /** English targets: the spelling LLM engines write. */
  englishSpelling?: 'american' | 'british';
  /** A reopened project's translations (P9.5): used instead of the engine, which is not called. */
  replay?: Record<string, StoredOutcome>;
}

export interface PdfJob extends Omit<DocxJob, 'translateComments' | 'translateMetadata'> {
  /** Also produce the side-by-side (original | translation) PDF. */
  dual: boolean;
  /** Translate bookmarks and the document title. */
  translateMetadata: boolean;
  /** 0-based inclusive page range; omitted = all pages. */
  pageRange?: { from: number; to: number };
}

export type PdfJobResult =
  | {
      ok: true;
      mono: Uint8Array;
      dual: Uint8Array | null;
      /** The translation as an editable Word document (P9.4). */
      editable: Uint8Array | null;
      report: PdfReport;
      /** Every segment's translation by source text, for the project file (P9.5). */
      translations: Record<string, StoredOutcome>;
    }
  | JobError;

export type DocxJobResult =
  | {
      ok: true;
      bytes: Uint8Array;
      report: DocxReport;
      translations: Record<string, StoredOutcome>;
    }
  | JobError;

/** LaTeX (P9.7): a `.tex` file or a project `.zip`, returned in the same form. */
export type LatexJobResult =
  | {
      ok: true;
      bytes: Uint8Array;
      zip: boolean;
      report: DocxReport;
      translations: Record<string, StoredOutcome>;
    }
  | JobError;

export type TextJobResult =
  | { ok: true; segments: TextSegment[]; tagSurvival: { survived: number; total: number } }
  | JobError;

/** Contract between the UI and pipeline.worker.ts (exposed through Comlink). */
export interface PipelineApi {
  /** Liveness check; resolves with 'pong'. */
  ping(): 'pong';
  /** Page count and page-1 thumbnail. The PNG buffer is transferred, not copied. */
  inspectPdf(file: Blob): Promise<PdfInspection>;
  /** Plain text of the first paragraphs of a DOCX (for language detection); '' on failure. */
  sampleDocx(file: Blob): Promise<string>;
  /** Glossary suggestions from the document (code-font words, tool names, field terms). */
  suggestTerms(
    file: Blob,
    kind: 'pdf' | 'docx',
    pair: LangPair,
    known: GlossaryEntry[],
  ): Promise<TermSuggestion[]>;
  /** Title, abstract and keywords of a paper; null when no abstract was found. */
  paperParts(file: Blob, kind: 'pdf' | 'docx', sourceLang: string): Promise<PaperParts | null>;
  translateText(
    job: TextJob,
    onProgress?: (done: number, total: number, phase?: ProgressPhase) => void,
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
    onProgress?: (done: number, total: number, phase?: ProgressPhase) => void,
    chrome?: ChromeTranslatorBridge,
  ): Promise<DocxJobResult>;
  /** Bilingual review DOCX (source | translation | notes); the buffer is transferred. */
  bilingualDocx(
    rows: BilingualRow[],
    labels: { title: string; source: string; target: string; notes: string },
  ): Promise<Uint8Array>;
  /** PDF analysis for the debug overlay (P3.3). */
  analyzePdf(file: Blob, maxPages: number): Promise<PageIR[]>;
  /** One page as PNG at `scale` (1 = 72 dpi); the buffer is transferred. */
  renderPdfPage(file: Blob, index: number, scale: number): Promise<Thumbnail>;
  translatePdf(
    job: PdfJob,
    onProgress?: (done: number, total: number, phase?: ProgressPhase) => void,
    chrome?: ChromeTranslatorBridge,
  ): Promise<PdfJobResult>;
  /** Glossary suggestions from a DOCX file's paragraphs. */
  extractDocxGlossary(job: DocxJob): Promise<{ ok: true; entries: GlossaryEntry[] } | JobError>;
  /** LaTeX source or project (P9.7); options as for Word documents. */
  translateLatex(
    job: DocxJob,
    onProgress?: (done: number, total: number, phase?: ProgressPhase) => void,
    chrome?: ChromeTranslatorBridge,
  ): Promise<LatexJobResult>;
  /** A `.samepage` project file (P9.5); the buffer is transferred. */
  writeProject(manifest: ProjectManifest, source: Blob): Promise<Uint8Array>;
  /** Reads an untrusted `.samepage` file; the source buffer is transferred. */
  readProject(file: Blob): Promise<OpenedProject>;
}
