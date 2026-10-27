import type { FidelityFinding } from '../../engines/types';

export interface CacheEntry {
  text: string;
  notes?: string[];
  /** undefined = fidelity not checked yet; [] = checked, no findings. */
  findings?: FidelityFinding[];
  /** Back-translation of the text (back-translation check). */
  back?: string;
}

export interface TranslationCache {
  get(keys: string[]): Promise<Map<string, CacheEntry>>;
  set(entries: [string, CacheEntry][]): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCache implements TranslationCache {
  private readonly map = new Map<string, CacheEntry>();
  get(keys: string[]) {
    const out = new Map<string, CacheEntry>();
    for (const k of keys) {
      const v = this.map.get(k);
      if (v) out.set(k, v);
    }
    return Promise.resolve(out);
  }
  set(entries: [string, CacheEntry][]) {
    for (const [k, v] of entries) this.map.set(k, v);
    return Promise.resolve();
  }
  clear() {
    this.map.clear();
    return Promise.resolve();
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface CacheKeyParts {
  engineId: string;
  model: string;
  source: string;
  target: string;
  promptVersion: string;
  glossaryHash: string;
  numberLocalization: boolean;
  role: string;
  budgetChars?: number;
  text: string;
}

/** ASCII unit separator: cannot occur in ids or language codes. */
const FIELD_SEPARATOR = String.fromCharCode(0x1f);

/** TRANSLATION.md §7. Budgets are bucketed (10%) so tiny layout changes reuse translations. */
export function cacheKey(p: CacheKeyParts): Promise<string> {
  const bucket = p.budgetChars ? String(Math.round(Math.log(p.budgetChars) / Math.log(1.1))) : '-';
  return sha256Hex(
    [
      p.engineId,
      p.model,
      p.source,
      p.target,
      p.promptVersion,
      p.glossaryHash,
      p.numberLocalization ? 'loc' : 'keep',
      p.role,
      bucket,
      p.text,
    ].join(FIELD_SEPARATOR),
  );
}
