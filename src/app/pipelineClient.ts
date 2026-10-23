import { WorkerClient } from '../core/pipeline/workerClient';
import type { PipelineApi } from '../workers/api';

/** Shared client for the pipeline worker. Long stages pass their own timeout per call. */
export const pipelineClient = new WorkerClient<PipelineApi>(
  () => new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module' }),
  { timeoutMs: 15_000 },
);
