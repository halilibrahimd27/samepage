import type { LangPair } from '../../engines/types';
import { tokenize } from '../segment/codec';

/**
 * The translation memory: source/target pairs the user owns and carries to another computer or
 * to another tool (as TMX). Corrections made in the review step and entries imported from a TMX
 * file translate the same paragraph the same way next time; the engine's own translations are
 * kept for the export only (the translation cache already reuses them).
 */

export type MemoryOrigin = 'engine' | 'manual' | 'imported';

export interface MemoryEntry {
  pair: LangPair;
  /** Tagged source as the pipeline sees it ("We use <t1>MuPDF</t1> ⟦F1⟧ …"). */
  source: string;
  /** Tagged translation. */
  target: string;
  origin: MemoryOrigin;
  /** Time of the last change (milliseconds since 1970). */
  updated: number;
}

/** Entries kept at most: the engine's go first, then imported ones, the user's corrections last. */
export const MEMORY_MAX_ENTRIES = 20_000;

/** Counts shown in the settings. */
export interface MemoryStats {
  entries: number;
  /** The user's own corrections. */
  manual: number;
  /** Entries read from TMX files. */
  imported: number;
  pairs: { pair: LangPair; entries: number }[];
}

/** ASCII unit separator: cannot occur in language codes. */
const SEPARATOR = String.fromCharCode(0x1f);

export const pairKey = (pair: LangPair) => `${pair.source}>${pair.target}`;
export const memoryKey = (pair: LangPair, source: string) =>
  `${pairKey(pair)}${SEPARATOR}${source}`;

/** Code-unit order: the same on every machine (unlike localeCompare). */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Export order: by language pair, then by source. */
export const byPairAndSource = (a: MemoryEntry, b: MemoryEntry) =>
  compare(pairKey(a.pair), pairKey(b.pair)) || compare(a.source, b.source);

const RANK: Record<MemoryOrigin, number> = { engine: 0, imported: 1, manual: 2 };

/** Eviction order: the engine's entries first, then imported ones, then corrections; oldest first. */
export const evictionRank = (e: MemoryEntry): [number, number] => [RANK[e.origin], e.updated];

/**
 * Whether a translation can stand for its source in a document: something written, its tags
 * balanced and each one the source's (formatting may be dropped, never invented), and the same
 * placeholders one to one — a formula, a footnote mark or a link is never lost nor added.
 */
export function fitsSource(source: string, target: string): boolean {
  if (!target.trim()) return false;
  const tags = new Set<string>();
  const wanted: string[] = [];
  for (const t of tokenize(source)) {
    if (t.type === 'open') tags.add(t.id);
    else if (t.type === 'ph') wanted.push(t.id);
  }
  const open: string[] = [];
  const seen = new Set<string>();
  const found: string[] = [];
  for (const t of tokenize(target)) {
    if (t.type === 'open') {
      if (!tags.has(t.id) || seen.has(t.id)) return false;
      seen.add(t.id);
      open.push(t.id);
    } else if (t.type === 'close') {
      if (open.pop() !== t.id) return false;
    } else if (t.type === 'ph') found.push(t.id);
  }
  return !open.length && wanted.sort().join(' ') === found.sort().join(' ');
}

/**
 * Whether an entry replaces the one stored for the same pair and source: a correction always
 * does; an imported entry unless the stored correction or import is newer; the engine's only its
 * own (a machine translation never overwrites a correction).
 */
export function replaces(current: MemoryEntry | undefined, next: MemoryEntry): boolean {
  if (!current || next.origin === 'manual') return true;
  if (next.origin === 'imported')
    return current.origin === 'engine' || next.updated >= current.updated;
  return current.origin === 'engine';
}

/** The entries of a batch that are written, the later of two for the same source winning. */
export function folded(entries: MemoryEntry[]): Map<string, MemoryEntry> {
  const out = new Map<string, MemoryEntry>();
  for (const e of entries) {
    const key = memoryKey(e.pair, e.source);
    if (replaces(out.get(key), e)) out.set(key, e);
  }
  return out;
}

/** Where the memory is kept (IndexedDB in the app, a Map in tests). */
export interface TranslationMemory {
  /** The stored entries of the pair for these tagged sources, by source. */
  find(pair: LangPair, sources: string[]): Promise<Map<string, MemoryEntry>>;
  /**
   * Writes entries (`replaces` decides over a stored one), then keeps MEMORY_MAX_ENTRIES.
   * Returns how many were written.
   */
  put(entries: MemoryEntry[]): Promise<number>;
  /** Every entry, or the pair's, in export order. */
  all(pair?: LangPair): Promise<MemoryEntry[]>;
  stats(): Promise<MemoryStats>;
  clear(): Promise<void>;
}

/** Statistics of a list of entries. */
export function statsOf(entries: MemoryEntry[]): MemoryStats {
  const pairs = new Map<string, { pair: LangPair; entries: number }>();
  for (const e of entries) {
    const p = pairs.get(pairKey(e.pair)) ?? { pair: e.pair, entries: 0 };
    p.entries++;
    pairs.set(pairKey(e.pair), p);
  }
  return {
    entries: entries.length,
    manual: entries.filter((e) => e.origin === 'manual').length,
    imported: entries.filter((e) => e.origin === 'imported').length,
    pairs: [...pairs.values()].sort((a, b) => compare(pairKey(a.pair), pairKey(b.pair))),
  };
}

/** A memory in a Map (tests). */
export class MapMemory implements TranslationMemory {
  readonly map = new Map<string, MemoryEntry>();
  constructor(private readonly max = MEMORY_MAX_ENTRIES) {}

  find(pair: LangPair, sources: string[]) {
    const out = new Map<string, MemoryEntry>();
    for (const s of sources) {
      const e = this.map.get(memoryKey(pair, s));
      if (e) out.set(s, e);
    }
    return Promise.resolve(out);
  }

  put(entries: MemoryEntry[]) {
    let written = 0;
    for (const [key, e] of folded(entries)) {
      if (!replaces(this.map.get(key), e)) continue;
      this.map.set(key, e);
      written++;
    }
    const over = this.map.size - this.max;
    if (over > 0) {
      const order = [...this.map].sort(([ka, a], [kb, b]) => {
        const [ra, ua] = evictionRank(a);
        const [rb, ub] = evictionRank(b);
        return ra - rb || ua - ub || compare(ka, kb);
      });
      for (const [key] of order.slice(0, over)) this.map.delete(key);
    }
    return Promise.resolve(written);
  }

  all(pair?: LangPair) {
    return Promise.resolve(
      [...this.map.values()]
        .filter((e) => !pair || pairKey(e.pair) === pairKey(pair))
        .sort(byPairAndSource),
    );
  }

  stats() {
    return Promise.resolve(statsOf([...this.map.values()]));
  }

  clear() {
    this.map.clear();
    return Promise.resolve();
  }
}

/** What the translation pipeline asks of the memory. */
export interface MemoryHook {
  /** The user's corrections and imported translations of the pair for these tagged sources. */
  find(pair: LangPair, sources: string[]): Promise<Map<string, MemoryEntry>>;
  /** The engine's translations of the pair, for the export. */
  keep(pair: LangPair, translations: { source: string; target: string }[]): void;
}

/**
 * One job's use of the memory: corrections and imported entries are looked up as the pipeline
 * goes; what is learned (the engine's translations, the review step's corrections) is written
 * once the job has finished — a cancelled or failed job writes nothing.
 */
export class MemorySession implements MemoryHook {
  private readonly kept: MemoryEntry[] = [];
  constructor(
    private readonly memory: TranslationMemory,
    private readonly now: () => number = Date.now,
  ) {}

  async find(pair: LangPair, sources: string[]): Promise<Map<string, MemoryEntry>> {
    const found = await this.memory.find(pair, sources);
    // The engine's entries are not used instead of the engine: the cache covers them.
    return new Map([...found].filter(([, e]) => e.origin !== 'engine'));
  }

  keep(pair: LangPair, translations: { source: string; target: string }[]): void {
    const updated = this.now();
    for (const t of translations)
      this.kept.push({ pair, source: t.source, target: t.target, origin: 'engine', updated });
  }

  /** Writes the engine's translations, then the corrections (which win over them). */
  async finish(corrections: { pair: LangPair; source: string; target: string }[]): Promise<void> {
    const updated = this.now();
    const entries = [
      ...this.kept,
      ...corrections.map((c): MemoryEntry => ({ ...c, origin: 'manual', updated })),
    ].filter((e) => fitsSource(e.source, e.target));
    this.kept.length = 0;
    if (entries.length) await this.memory.put(entries);
  }
}
