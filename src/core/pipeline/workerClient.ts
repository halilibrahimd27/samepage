import { releaseProxy, wrap, type Remote } from 'comlink';

/** Minimal surface of `Worker` that the client needs (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  terminate(): void;
}

export type WorkerFailureKind = 'crash' | 'timeout';

export class WorkerFailedError extends Error {
  readonly kind: WorkerFailureKind;
  constructor(kind: WorkerFailureKind, message: string) {
    super(message);
    this.name = 'WorkerFailedError';
    this.kind = kind;
  }
}

export interface WorkerClientOptions {
  /** Default watchdog timeout per call in milliseconds. */
  timeoutMs: number;
}

interface Live<T> {
  worker: WorkerLike;
  remote: Remote<T>;
  /** Rejects when the worker reports an uncaught error. */
  crashed: Promise<never>;
  dispose: () => void;
}

/**
 * Owns one worker. Every call races against a watchdog timeout and against the worker
 * crashing; on either failure the worker is terminated and a fresh one is created lazily
 * on the next call, so the UI can always recover.
 */
export class WorkerClient<T> {
  private live: Live<T> | null = null;
  private readonly factory: () => WorkerLike;
  private readonly options: WorkerClientOptions;

  constructor(factory: () => WorkerLike, options: WorkerClientOptions) {
    this.factory = factory;
    this.options = options;
  }

  async call<R>(
    fn: (remote: Remote<T>) => Promise<R>,
    timeoutMs = this.options.timeoutMs,
  ): Promise<R> {
    const live = this.ensure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new WorkerFailedError('timeout', `Worker did not respond within ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([fn(live.remote), live.crashed, timeout]);
    } catch (error) {
      if (error instanceof WorkerFailedError) this.reset();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Terminates the current worker (if any). The next call starts a new one. */
  reset(): void {
    if (!this.live) return;
    this.live.dispose();
    this.live = null;
  }

  private ensure(): Live<T> {
    if (this.live) return this.live;
    const worker = this.factory();
    let onError: (event: Event) => void = () => undefined;
    const crashed = new Promise<never>((_, reject) => {
      onError = (event: Event) => {
        const detail = event instanceof ErrorEvent && event.message ? `: ${event.message}` : '';
        reject(new WorkerFailedError('crash', `Worker crashed${detail}`));
      };
    });
    // Avoid an unhandled rejection when the worker crashes between calls.
    crashed.catch(() => undefined);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    const remote = wrap<T>(worker);
    const dispose = () => {
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      remote[releaseProxy]();
      worker.terminate();
    };
    this.live = { worker, remote, crashed, dispose };
    return this.live;
  }
}
