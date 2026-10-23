import type { GlossaryEntry } from '../validate/validate';
import type { CacheEntry, TranslationCache } from './cache';

/** IndexedDB persistence (works in workers): translation cache with an LRU size cap + glossaries. */
const DB_NAME = 'samepage';
const DB_VERSION = 2;
const T = 'translations';
const G = 'glossaries';
const H = 'history';

interface Row {
  entry: CacheEntry;
  size: number;
  lastUsed: number;
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(T))
        db.createObjectStore(T).createIndex('lastUsed', 'lastUsed');
      if (!db.objectStoreNames.contains(G)) db.createObjectStore(G);
      if (!db.objectStoreNames.contains(H))
        db.createObjectStore(H).createIndex('createdAt', 'meta.createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
  return opening;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });

const request = <R>(req: IDBRequest<R>) =>
  new Promise<R>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

export class IdbCache implements TranslationCache {
  constructor(private readonly maxBytes = 50 * 1024 * 1024) {}

  async get(keys: string[]): Promise<Map<string, CacheEntry>> {
    const db = await openDb();
    const tx = db.transaction(T, 'readwrite');
    const store = tx.objectStore(T);
    const out = new Map<string, CacheEntry>();
    const now = Date.now();
    await Promise.all(
      keys.map(async (k) => {
        const row = (await request(store.get(k))) as Row | undefined;
        if (!row) return;
        out.set(k, row.entry);
        store.put({ ...row, lastUsed: now }, k);
      }),
    );
    await done(tx);
    return out;
  }

  async set(entries: [string, CacheEntry][]): Promise<void> {
    if (entries.length === 0) return;
    const db = await openDb();
    const tx = db.transaction(T, 'readwrite');
    const store = tx.objectStore(T);
    const now = Date.now();
    for (const [k, entry] of entries) {
      store.put(
        { entry, size: JSON.stringify(entry).length * 2 + k.length, lastUsed: now } satisfies Row,
        k,
      );
    }
    await done(tx);
    await this.evict();
  }

  async clear(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(T, 'readwrite');
    tx.objectStore(T).clear();
    await done(tx);
  }

  /** Drops least-recently-used rows until the cache is under 90% of the cap. */
  private async evict(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(T, 'readwrite');
    const store = tx.objectStore(T);
    const rows = (await request(store.getAll())) as Row[];
    let total = rows.reduce((sum, r) => sum + r.size, 0);
    if (total > this.maxBytes) {
      const target = this.maxBytes * 0.9;
      await new Promise<void>((resolve, reject) => {
        const cursorReq = store.index('lastUsed').openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || total <= target) return resolve();
          total -= (cursor.value as Row).size;
          cursor.delete();
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error ?? new Error('cursor failed'));
      });
    }
    await done(tx);
  }
}

const glossaryKey = (source: string, target: string) => `${source}>${target}`;

export async function loadGlossary(source: string, target: string): Promise<GlossaryEntry[]> {
  const db = await openDb();
  const tx = db.transaction(G, 'readonly');
  const value = (await request(tx.objectStore(G).get(glossaryKey(source, target)))) as
    GlossaryEntry[] | undefined;
  return value ?? [];
}

export async function saveGlossary(
  source: string,
  target: string,
  entries: GlossaryEntry[],
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(G, 'readwrite');
  tx.objectStore(G).put(entries, glossaryKey(source, target));
  await done(tx);
}

/** Translation history (P1b.8): kept on this device only. */
export interface HistoryMeta {
  id: string;
  createdAt: number;
  name: string;
  outputName: string;
  kind: 'docx' | 'pdf';
  pair: { source: string; target: string };
  engine: string;
  model?: string;
  summary: { segments: number; translated: number; warnings: number; untranslated: number };
  sizeBytes: number;
}

interface HistoryRow {
  meta: HistoryMeta;
  bytes: Uint8Array;
  report: unknown;
}

const HISTORY_MAX_BYTES = 300 * 1024 * 1024;

export async function addHistory(
  meta: HistoryMeta,
  bytes: Uint8Array,
  report: unknown,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(H, 'readwrite');
  const store = tx.objectStore(H);
  store.put({ meta, bytes, report } satisfies HistoryRow, meta.id);
  // Evict the oldest entries beyond the cap.
  const metas = ((await request(store.getAll())) as HistoryRow[]).map((r) => r.meta);
  metas.sort((a, b) => b.createdAt - a.createdAt);
  let total = 0;
  for (const m of metas) {
    total += m.sizeBytes;
    if (total > HISTORY_MAX_BYTES && m.id !== meta.id) store.delete(m.id);
  }
  await done(tx);
}

export async function listHistory(): Promise<HistoryMeta[]> {
  const db = await openDb();
  const tx = db.transaction(H, 'readonly');
  const rows = (await request(tx.objectStore(H).getAll())) as HistoryRow[];
  return rows.map((r) => r.meta).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getHistoryEntry(id: string): Promise<HistoryRow | null> {
  const db = await openDb();
  const tx = db.transaction(H, 'readonly');
  return ((await request(tx.objectStore(H).get(id))) as HistoryRow | undefined) ?? null;
}

export async function deleteHistory(id: string | null): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(H, 'readwrite');
  if (id === null) tx.objectStore(H).clear();
  else tx.objectStore(H).delete(id);
  await done(tx);
}
