import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { Availability, LangPair } from '../../engines/types';

/** Minimal typing of Chrome's Translator API (desktop Chrome/Edge 138+, main thread only). */
interface ChromeTranslator {
  translate(text: string): Promise<string>;
}
interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: { loaded: number }) => void): void;
}
interface TranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: DownloadMonitor) => void;
  }): Promise<ChromeTranslator>;
}

const api = (): TranslatorStatic | undefined =>
  (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;

const translators = new Map<string, ChromeTranslator>();
const keyOf = (p: LangPair) => `${p.source}>${p.target}`;

/**
 * Creates (and downloads, if needed) the translator for a pair. Chrome requires a user
 * gesture, so call this directly from the click handler that starts a job.
 */
export async function prepareChromeTranslator(
  pair: LangPair,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const T = api();
  if (!T) throw new Error('Chrome built-in translator is not available in this browser.');
  if (translators.has(keyOf(pair))) return;
  const translator = await T.create({
    sourceLanguage: pair.source,
    targetLanguage: pair.target,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)),
  });
  translators.set(keyOf(pair), translator);
}

export const chromeTranslatorBridge: ChromeTranslatorBridge = {
  async availability(pair: LangPair): Promise<Availability> {
    const T = api();
    if (!T) return 'unavailable';
    const a = await T.availability({ sourceLanguage: pair.source, targetLanguage: pair.target });
    return a === 'available' ? 'available' : a === 'unavailable' ? 'unavailable' : 'downloadable';
  },
  async translate(pair: LangPair, texts: string[]): Promise<string[]> {
    const translator = translators.get(keyOf(pair));
    if (!translator) throw new Error('Chrome translator was not prepared for this language pair.');
    const out: string[] = [];
    // The API processes requests sequentially anyway.
    for (const text of texts) out.push(text.trim() ? await translator.translate(text) : text);
    return out;
  },
};
