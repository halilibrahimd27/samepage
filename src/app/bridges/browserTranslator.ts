import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { LangPair } from '../../engines/types';
import { closeGoogleTranslate, googleTranslate } from './googleTranslate';

/**
 * Main-thread side of the `browser` engine. By default texts go to Google's website translator
 * in the translation helper frame (googleTranslate.ts, ADR-021): automatic, into the language
 * the user chose. If that cannot start, or the user turned it off, the TranslationSheet shows the
 * batch and the user switches on the browser's own page translation (ADR-015); the harvested
 * texts resolve the batch. A tiny external store connects the bridge and React.
 */
export interface SheetBatch {
  id: number;
  pair: LangPair;
  texts: string[];
  /** Why the manual sheet is shown although automatic translation is on. */
  notice?: 'auto-failed';
  resolve: (texts: string[]) => void;
  reject: (error: Error) => void;
}

let current: SheetBatch | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const sheetStore = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => current,
  finish: (id: number, texts: string[]) => {
    if (current?.id !== id) return;
    const batch = current;
    current = null;
    emit();
    batch.resolve(texts);
  },
  cancel: (reason = 'Cancelled') => {
    if (!current) return;
    const batch = current;
    current = null;
    emit();
    batch.reject(new DOMException(reason, 'AbortError'));
  },
};

let automatic = true;
/**
 * When automatic translation last failed: later batches go to the sheet for a while (the user
 * is already translating by hand), then automatic translation is tried again.
 */
let failedAt = -Infinity;
const FAILED_FOR_MS = 5 * 60_000;
/**
 * Waits before the second and third attempt. Quick failures are mostly the helper not loading
 * Google's script (a network blip, or Google refusing a burst of requests for a moment).
 */
const RETRY_DELAYS_MS = [0, 4_000, 12_000];

const automaticFailed = () => Date.now() - failedAt < FAILED_FOR_MS;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Settings → bridge: automatic Google translation on or off. */
export function setAutomaticTranslation(on: boolean): void {
  automatic = on;
  if (on) failedAt = -Infinity;
  else closeGoogleTranslate();
}

function viaSheet(pair: LangPair, texts: string[], notice?: SheetBatch['notice']) {
  return new Promise<string[]>((resolve, reject) => {
    sheetStore.cancel('Superseded');
    current = { id: nextId++, pair, texts, resolve, reject, ...(notice ? { notice } : {}) };
    emit();
  });
}

export const browserTranslationBridge: ChromeTranslatorBridge = {
  // Every browser we target can do this (automatically, or with its own page translation).
  availability: () => Promise.resolve('available'),
  async translate(pair, texts) {
    if (automatic && !automaticFailed()) {
      // A failed batch gets a fresh helper frame, twice, before the manual sheet takes over.
      for (const delay of RETRY_DELAYS_MS) {
        if (delay) await sleep(delay);
        try {
          return await googleTranslate(pair, texts);
        } catch {
          closeGoogleTranslate();
        }
      }
      failedAt = Date.now();
      return viaSheet(pair, texts, 'auto-failed');
    }
    return viaSheet(pair, texts);
  },
  // The meaning check never asks the user to translate by hand.
  async backTranslate(pair, texts) {
    if (!automatic || automaticFailed()) return null;
    return googleTranslate(pair, texts).catch(() => null);
  },
};

export type BrowserKind =
  'chrome-android' | 'chrome-ios' | 'chrome-desktop' | 'edge' | 'safari' | 'firefox' | 'other';

export function detectBrowser(ua = navigator.userAgent): BrowserKind {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/CriOS\//.test(ua)) return 'chrome-ios';
  if (/Chrome\//.test(ua)) return /Android|Mobile/.test(ua) ? 'chrome-android' : 'chrome-desktop';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
