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
  let lastProgress = Date.now();
  // create() first, while the click still counts as a user gesture (a download needs one).
  const creating = T.create({
    sourceLanguage: pair.source,
    targetLanguage: pair.target,
    monitor: (m) =>
      m.addEventListener('downloadprogress', (e) => {
        lastProgress = Date.now();
        onProgress?.(e.loaded);
      }),
  });
  const availability = await T.availability({
    sourceLanguage: pair.source,
    targetLanguage: pair.target,
  });
  if (availability === 'unavailable') throw new Error(CHROME_PAIR_UNAVAILABLE);
  // A language pack to download: say so at once (Chrome may take a while to report progress).
  if (availability !== 'available') onProgress?.(0);
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastProgress > DOWNLOAD_STALL_MS) reject(new Error(CHROME_DOWNLOAD_STALLED));
    }, 1000);
  });
  try {
    translators.set(keyOf(pair), await Promise.race([creating, stalled]));
  } finally {
    clearInterval(watchdog);
  }
}

/** No download progress for this long: Chrome's language pack download is stuck. */
const DOWNLOAD_STALL_MS = 90_000;
export const CHROME_PAIR_UNAVAILABLE = 'Chrome cannot translate this language pair';
export const CHROME_DOWNLOAD_STALLED = 'Chrome language pack download stalled';

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
  // Only a reverse model that is already installed: a download would need a user gesture.
  async backTranslate(pair: LangPair, texts: string[]): Promise<string[] | null> {
    const T = api();
    if (!T) return null;
    if (!translators.has(keyOf(pair))) {
      const a = await T.availability({ sourceLanguage: pair.source, targetLanguage: pair.target });
      if (a !== 'available') return null;
      translators.set(
        keyOf(pair),
        await T.create({ sourceLanguage: pair.source, targetLanguage: pair.target }),
      );
    }
    return chromeTranslatorBridge.translate(pair, texts).catch(() => null);
  },
};
