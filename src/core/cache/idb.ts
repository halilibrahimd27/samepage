import type { GlossaryEntry } from '../validate/validate';
import type { CacheEntry, TranslationCache } from './cache';

/** IndexedDB persistence (works in workers): translation cache with an LRU size cap + glossaries. */
const DB_NAME = 'samepage';
const DB_VERSION = 1;
const T = 'translations';
const G = 'glossaries';

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
      const store = db.createObjectStore(T);
      store.createIndex('lastUsed', 'lastUsed');
      db.createObjectStore(G);
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
