import type { PdfInspection } from '../pdf/engine';

/** Contract between the UI and pipeline.worker.ts (exposed through Comlink). */
export interface PipelineApi {
  /** Liveness check; resolves with 'pong'. */
  ping(): 'pong';
  /** Page count and page-1 thumbnail. The PNG buffer is transferred, not copied. */
  inspectPdf(file: Blob): Promise<PdfInspection>;
}
