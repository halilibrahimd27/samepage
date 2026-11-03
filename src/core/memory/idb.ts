import type { LangPair } from '../../engines/types';
import { done, request } from '../cache/idb';
import {
  byPairAndSource,
  evictionRank,
  folded,
  MEMORY_MAX_ENTRIES,
  memoryKey,
  pairKey,
  replaces,
  type MemoryEntry,
  type MemoryStats,
  type TranslationMemory,
} from './memory';

/**
 * The translation memory in IndexedDB (works in workers). A database of its own: adding it to the
 * cache's would make every tab still open on an older version block the upgrade.
 */
const DB_NAME = 'samepage-memory';
const DB_VERSION = 1;
const M = 'entries';

interface Row {
  entry: MemoryEntry;
  /** "tr>en", for the export of one pair and the counts. */
  pair: string;
  origin: MemoryEntry['origin'];
  /** Eviction order (origin rank, then time); ties go by key. */
  order: [number, number];
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(M)) {
        const store = db.createObjectStore(M);
        store.createIndex('pair', 'pair');
        store.createIndex('origin', 'origin');
        store.createIndex('order', 'order');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer version opened in another tab: let it upgrade.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('IndexedDB unavailable'));
    };
  });
  return opening;
}

const rowOf = (entry: MemoryEntry): Row => ({
  entry,
  pair: pairKey(entry.pair),
  origin: entry.origin,
  order: evictionRank(entry),
});

export class IdbMemory implements TranslationMemory {
  constructor(private readonly max = MEMORY_MAX_ENTRIES) {}

  async find(pair: LangPair, sources: string[]): Promise<Map<string, MemoryEntry>> {
    const out = new Map<string, MemoryEntry>();
    if (!sources.length) return out;
    const db = await openDb();
    const tx = db.transaction(M, 'readonly');
    const store = tx.objectStore(M);
    await Promise.all(
      [...new Set(sources)].map(async (s) => {
        const row = (await request(store.get(memoryKey(pair, s)))) as Row | undefined;
        if (row) out.set(s, row.entry);
      }),
    );
    await done(tx);
    return out;
  }

  async put(entries: MemoryEntry[]): Promise<number> {
    const batch = folded(entries);
    if (!batch.size) return 0;
    const db = await openDb();
    const tx = db.transaction(M, 'readwrite');
    const store = tx.objectStore(M);
    let written = 0;
    await Promise.all(
      [...batch].map(async ([key, entry]) => {
        const row = (await request(store.get(key))) as Row | undefined;
        if (!replaces(row?.entry, entry)) return;
        store.put(rowOf(entry), key);
        written++;
      }),
    );
    await done(tx);
    await this.evict();
    return written;
  }

  async all(pair?: LangPair): Promise<MemoryEntry[]> {
    const db = await openDb();
    const tx = db.transaction(M, 'readonly');
    const store = tx.objectStore(M);
    const rows = (await request(
      pair ? store.index('pair').getAll(pairKey(pair)) : store.getAll(),
    )) as Row[];
    await done(tx);
    return rows.map((r) => r.entry).sort(byPairAndSource);
  }

  async stats(): Promise<MemoryStats> {
    const db = await openDb();
    const tx = db.transaction(M, 'readonly');
    const store = tx.objectStore(M);
    const [entries, manual, imported] = await Promise.all([
      request(store.count()),
      request(store.index('origin').count('manual')),
      request(store.index('origin').count('imported')),
    ]);
    // The keys of the pair index only: no entry is read.
    const counts = new Map<string, number>();
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.index('pair').openKeyCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return resolve();
        const key = cursor.key as string;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('cursor failed'));
    });
    await done(tx);
    return {
      entries,
      manual,
      imported,
      pairs: [...counts].map(([key, n]) => {
        const [source = '', target = ''] = key.split('>');
        return { pair: { source, target }, entries: n };
      }),
    };
  }

  async clear(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(M, 'readwrite');
    tx.objectStore(M).clear();
    await done(tx);
  }

  /** Keeps the newest entries: the engine's go first, the user's corrections last. */
  private async evict(): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(M, 'readwrite');
    const store = tx.objectStore(M);
    let over = (await request(store.count())) - this.max;
    if (over > 0) {
      await new Promise<void>((resolve, reject) => {
        const cursorReq = store.index('order').openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || over <= 0) return resolve();
          cursor.delete();
          over--;
          cursor.continue();
        };
        cursorReq.onerror = () => reject(cursorReq.error ?? new Error('cursor failed'));
      });
    }
    await done(tx);
  }
}
