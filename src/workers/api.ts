/** Contract between the UI and pipeline.worker.ts (exposed through Comlink). */
export interface PipelineApi {
  /** Liveness check; resolves with 'pong'. */
  ping(): 'pong';
}
