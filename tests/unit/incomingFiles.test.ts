import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  SHARE_ACTION,
  SHARE_CACHE,
  SHARE_FIELD,
  SHARE_MAX_AGE_MS,
  SHARE_NAME_HEADER,
  shareEntry,
  sharedFileName,
  shareIdFrom,
  takeSharedFiles,
  withoutShareMarker,
} from '../../src/app/incomingFiles';

const keyOf = (key: RequestInfo | URL) =>
  typeof key === 'string' ? key : key instanceof URL ? key.href : key.url;

/** The Cache API in memory: what the service worker and the app share. */
class MemoryCache {
  readonly entries = new Map<string, Response>();
  put(key: RequestInfo | URL, response: Response) {
    this.entries.set(keyOf(key), response);
    return Promise.resolve();
  }
  match(key: RequestInfo | URL) {
    return Promise.resolve(this.entries.get(keyOf(key))?.clone());
  }
  keys() {
    return Promise.resolve([...this.entries.keys()].map((url) => new Request(url)));
  }
  delete(key: RequestInfo | URL) {
    return Promise.resolve(this.entries.delete(keyOf(key)));
  }
}

class MemoryStorage {
  readonly caches = new Map<string, MemoryCache>();
  open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new MemoryCache());
    return Promise.resolve(this.caches.get(name)!);
  }
  has(name: string) {
    return Promise.resolve(this.caches.has(name));
  }
  keys() {
    return Promise.resolve([...this.caches.keys()]);
  }
  delete(name: string) {
    return Promise.resolve(this.caches.delete(name));
  }
  get api() {
    return this as unknown as CacheStorage;
  }
}

const SCOPE = 'https://example.org/samepage/';

/** public/sw.js, run with an in-memory cache: its listeners. */
function loadServiceWorker(storage: MemoryStorage) {
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL('sw.js', SCOPE),
    crypto: globalThis.crypto,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const fetch = () => Promise.reject(new Error('no network in this test'));
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    self,
    caches: storage.api,
    fetch,
    Response,
    Request,
    URL,
    File,
  });
  /** The service worker's answer to a request, or undefined when it leaves it to the network. */
  const answer = (request: Request) => {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request, respondWith: (r: Promise<Response>) => (response = r) });
    return response;
  };
  const activate = async () => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get('activate')!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return { answer, activate };
}

/** Shares `files` the way the system does: a multipart POST to the share URL. */
function shareRequest(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append(SHARE_FIELD, file);
  return new Request(new URL(SHARE_ACTION, SCOPE), { method: 'POST', body: form });
}

describe('share marker', () => {
  it('reads a well-formed share id only', () => {
    expect(shareIdFrom('?share=mh2x9k3c-1f3a9b2c')).toBe('mh2x9k3c-1f3a9b2c');
    expect(shareIdFrom('?lang=tr&share=mh2x9k3c-1f3a9b2c')).toBe('mh2x9k3c-1f3a9b2c');
    expect(shareIdFrom('')).toBeNull();
    expect(shareIdFrom('?share=')).toBeNull();
    expect(shareIdFrom('?share=../../etc')).toBeNull();
    expect(shareIdFrom('?share=mh2x9k3c-1F3A9B2C')).toBeNull();
  });

  it('removes the marker and keeps the rest of the address', () => {
    expect(withoutShareMarker(`${SCOPE}?share=mh2x9k3c-1f3a9b2c`)).toBe(SCOPE);
    expect(withoutShareMarker(`${SCOPE}?a=1&share=mh2x9k3c-1f3a9b2c#quality`)).toBe(
      `${SCOPE}?a=1#quality`,
    );
    expect(withoutShareMarker(SCOPE)).toBe(SCOPE);
  });

  it('reads a kept file’s key', () => {
    expect(shareEntry(`${SCOPE}share/mh2x9k3c-1f3a9b2c/2`)).toEqual({
      id: 'mh2x9k3c-1f3a9b2c',
      n: 2,
      time: parseInt('mh2x9k3c', 36),
    });
    expect(shareEntry(`${SCOPE}share/not-an-id/0`)).toBeNull();
    expect(shareEntry(`${SCOPE}assets/index.js`)).toBeNull();
  });

  it('names a kept file safely', () => {
    expect(sharedFileName(encodeURIComponent('Makale – taslak ğüş.pdf'))).toBe(
      'Makale – taslak ğüş.pdf',
    );
    expect(sharedFileName(encodeURIComponent('../../evil/paper.docx'))).toBe(
      '.._.._evil_paper.docx',
    );
    expect(sharedFileName('%E0%A4%A')).toBe('%E0%A4%A');
    expect(sharedFileName(null)).toBe('document');
    expect(sharedFileName('x'.repeat(300))).toHaveLength(200);
  });
});

describe('Share → samepage (public/sw.js and the app)', () => {
  it('the manifest posts to the share URL and opens the same file types it handles', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../public/manifest.webmanifest', import.meta.url), 'utf8'),
    ) as {
      share_target: {
        action: string;
        method: string;
        enctype: string;
        params: { files: { name: string; accept: string[] }[] };
      };
      file_handlers: { action: string; accept: Record<string, string[]> }[];
    };
    const share = manifest.share_target;
    expect(share).toMatchObject({
      action: SHARE_ACTION,
      method: 'POST',
      enctype: 'multipart/form-data',
    });
    expect(share.params.files.map((f) => f.name)).toEqual([SHARE_FIELD]);
    const shared = share.params.files[0]!.accept.filter((a) => a.startsWith('.'));
    const handled = manifest.file_handlers.flatMap((h) => Object.values(h.accept).flat());
    expect(new Set(shared)).toEqual(new Set(handled));
    expect(new Set(handled)).toEqual(
      new Set(['.pdf', '.docx', '.pptx', '.tex', '.zip', '.samepage']),
    );
  });

  it('keeps the shared files for the app, which takes them once and in order', async () => {
    const storage = new MemoryStorage();
    const sw = loadServiceWorker(storage);
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'Makale ğ.pdf', {
      type: 'application/pdf',
    });
    const tex = new File(['\\documentclass{article}'], 'paper.tex');

    const response = await sw.answer(shareRequest([pdf, tex]));
    expect(response?.status).toBe(303);
    const location = new URL(response!.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(SCOPE);
    const id = shareIdFrom(location.search);
    expect(id).not.toBeNull();

    const files = await takeSharedFiles(id!, storage.api);
    expect(files.map((f) => f.name)).toEqual(['Makale ğ.pdf', 'paper.tex']);
    expect(files[0]!.type).toBe('application/pdf');
    expect([...new Uint8Array(await files[0]!.arrayBuffer())]).toEqual([
      0x25, 0x50, 0x44, 0x46, 0x2d,
    ]);
    expect(await files[1]!.text()).toBe('\\documentclass{article}');
    // Read once: nothing is left behind.
    expect(await takeSharedFiles(id!, storage.api)).toEqual([]);
    expect(storage.caches.get(SHARE_CACHE)!.entries.size).toBe(0);
  });

  it('a share without readable files still lands in the app', async () => {
    const storage = new MemoryStorage();
    const sw = loadServiceWorker(storage);
    const broken = new Request(new URL(SHARE_ACTION, SCOPE), {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body: 'not a form',
    });
    const response = await sw.answer(broken);
    expect(response?.status).toBe(303);
    const id = shareIdFrom(new URL(response!.headers.get('location')!).search);
    expect(await takeSharedFiles(id!, storage.api)).toEqual([]);
  });

  it('removes shares never opened once they are old, and keeps recent ones', async () => {
    const storage = new MemoryStorage();
    const cache = await storage.open(SHARE_CACHE);
    const now = Date.UTC(2026, 10, 3, 12);
    const old = `${(now - SHARE_MAX_AGE_MS - 1).toString(36)}-00000000`;
    const recent = `${(now - 60_000).toString(36)}-11111111`;
    const mine = `${now.toString(36)}-22222222`;
    for (const id of [old, recent, mine])
      await cache.put(
        `${SCOPE}share/${id}/0`,
        new Response('%PDF-', { headers: { [SHARE_NAME_HEADER]: `${id}.pdf` } }),
      );
    const files = await takeSharedFiles(mine, storage.api, now);
    expect(files.map((f) => f.name)).toEqual([`${mine}.pdf`]);
    expect([...cache.entries.keys()]).toEqual([`${SCOPE}share/${recent}/0`]);
  });

  it('leaves other origins, other posts and the translation helper to the network', () => {
    const sw = loadServiceWorker(new MemoryStorage());
    expect(
      sw.answer(new Request('https://api.anthropic.com/v1/messages', { method: 'POST' })),
    ).toBeUndefined();
    expect(sw.answer(new Request('https://example.org/share-target', { method: 'POST' }))).toBe(
      undefined,
    );
    expect(sw.answer(new Request(`${SCOPE}other`, { method: 'POST' }))).toBeUndefined();
    expect(sw.answer(new Request(`${SCOPE}translate.html`))).toBeUndefined();
    // The app fetched under a share marker is not kept as an asset.
    expect(sw.answer(new Request(`${SCOPE}?share=mh2x9k3c-1f3a9b2c`))).toBeUndefined();
  });

  it('a new version drops the old app shell but not files waiting to be opened', async () => {
    const storage = new MemoryStorage();
    await storage.open('samepage-v1');
    await storage.open(SHARE_CACHE);
    const sw = loadServiceWorker(storage);
    await sw.activate();
    expect(await storage.keys()).toEqual([SHARE_CACHE]);
  });
});
