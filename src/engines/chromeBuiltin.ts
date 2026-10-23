import { tokenize } from '../core/segment/codec';
import type { Availability, LangPair, SegmentResult, TranslationEngine } from './types';

/**
 * Chrome's Translator API exists only on the main thread, so the worker talks to it through
 * this bridge (implemented in src/app/bridges/chromeTranslator.ts, passed via Comlink).
 */
export interface ChromeTranslatorBridge {
  availability(pair: LangPair): Promise<Availability>;
  translate(pair: LangPair, texts: string[]): Promise<string[]>;
}

const tagIds = (t: string) =>
  tokenize(t)
    .filter((x) => x.type === 'open')
    .map((x) => (x as { id: string }).id)
    .sort();
const phIds = (t: string) =>
  tokenize(t)
    .filter((x) => x.type === 'ph')
    .map((x) => (x as { id: string }).id)
    .sort();
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function structureKept(source: string, target: string): boolean {
  const stack: string[] = [];
  for (const t of tokenize(target)) {
    if (t.type === 'open') stack.push(t.id);
    if (t.type === 'close' && stack.pop() !== t.id) return false;
  }
  return (
    stack.length === 0 && same(tagIds(source), tagIds(target)) && same(phIds(source), phIds(target))
  );
}

/** Removes <tN> tags but keeps placeholders. */
const stripTags = (t: string) => t.replace(/<\/?t\d+>/g, '');

/**
 * Re-applies inline styles after a tag-free translation (TRANSLATION.md §2.2): a tag is
 * restored around its source text only when that text survived verbatim (names, numbers);
 * the rest become empty tags so the structure stays valid, and the result is reported.
 */
export function reapplyTags(source: string, translated: string): string {
  let result = translated;
  const tokens = tokenize(source);
  let unplaced = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type !== 'open') continue;
    let inner = '';
    for (let j = i + 1; j < tokens.length; j++) {
      const u = tokens[j]!;
      if (u.type === 'close' && u.id === t.id) break;
      if (u.type === 'text') inner += u.text;
    }
    const needle = inner.trim();
    const at = needle ? result.indexOf(needle) : -1;
    if (at >= 0) {
      result = `${result.slice(0, at)}<${t.id}>${needle}</${t.id}>${result.slice(at + needle.length)}`;
    } else {
      unplaced += `<${t.id}></${t.id}>`;
    }
  }
  return result + unplaced;
}

export function createChromeEngine(bridge: ChromeTranslatorBridge): TranslationEngine {
  return {
    id: 'chrome-builtin',
    label: 'Chrome built-in translator',
    runsOn: 'main',
    privacy: 'on-device',
    capabilities: {
      glossary: false,
      lengthBudget: false,
      tagsReliable: false,
      condense: false,
      vision: false,
      fidelityCheck: false,
    },
    model: 'chrome-translator',
    maxBatchChars: 4000,
    isAvailable: (pair) => bridge.availability(pair),

    async translate(batch, ctx, signal): Promise<SegmentResult[]> {
      const first = await bridge.translate(
        ctx.pair,
        batch.map((s) => s.text),
      );
      signal.throwIfAborted();
      const results: SegmentResult[] = [];
      const retry: number[] = [];
      batch.forEach((s, i) => {
        const text = first[i] ?? '';
        const hasTags = tagIds(s.text).length > 0;
        if (structureKept(s.text, text)) {
          results[i] = { id: s.id, text, notes: hasTags ? ['tags-survived'] : [] };
        } else {
          retry.push(i);
        }
      });
      if (retry.length) {
        const second = await bridge.translate(
          ctx.pair,
          retry.map((i) => stripTags(batch[i]!.text)),
        );
        signal.throwIfAborted();
        retry.forEach((i, k) => {
          const s = batch[i]!;
          results[i] = {
            id: s.id,
            text: reapplyTags(s.text, second[k] ?? ''),
            notes: ['tags-lost', 'style-approximated'],
          };
        });
      }
      return results;
    },
  };
}
