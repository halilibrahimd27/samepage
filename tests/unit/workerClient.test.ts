import { expose } from 'comlink';
import { describe, expect, it } from 'vitest';
import {
  WorkerClient,
  WorkerFailedError,
  type WorkerLike,
} from '../../src/core/pipeline/workerClient';

/** Worker stand-in backed by a MessageChannel; can simulate a crash. */
class FakeWorker extends EventTarget implements WorkerLike {
  terminated = false;
  private readonly port: MessagePort;
  constructor(api: object) {
    super();
    const { port1, port2 } = new MessageChannel();
    expose(api, port1);
    this.port = port2;
    port2.addEventListener('message', (e: MessageEvent<unknown>) => {
      this.dispatchEvent(new MessageEvent('message', { data: e.data }));
    });
    port2.start();
  }
  postMessage(message: unknown, transfer: Transferable[]) {
    this.port.postMessage(message, transfer);
  }
  terminate() {
    this.terminated = true;
    this.port.close();
  }
  crash() {
    this.dispatchEvent(new Event('error'));
  }
}

type Api = { ping(): string; hang(): Promise<never> };
const api: Api = { ping: () => 'pong', hang: () => new Promise<never>(() => undefined) };

describe('WorkerClient', () => {
  it('recovers from a crash and a timeout by starting a fresh worker', async () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient<Api>(
      () => {
        const w = new FakeWorker(api);
        workers.push(w);
        return w;
      },
      { timeoutMs: 50 },
    );

    expect(await client.call((r) => r.ping())).toBe('pong');

    const hanging = client.call((r) => r.hang());
    workers[0]!.crash();
    await expect(hanging).rejects.toMatchObject({ kind: 'crash' });
    expect(workers[0]!.terminated).toBe(true);

    await expect(client.call((r) => r.hang())).rejects.toBeInstanceOf(WorkerFailedError);
    expect(workers[1]!.terminated).toBe(true);

    expect(await client.call((r) => r.ping())).toBe('pong');
    expect(workers).toHaveLength(3);
    client.reset();
  });
});
