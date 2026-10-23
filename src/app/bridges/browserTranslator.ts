import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { LangPair } from '../../engines/types';

/**
 * Main-thread side of the `browser` engine (ADR-015). The worker hands over a batch; the
 * TranslationSheet component renders it, the user turns on the browser's page translation, and
 * the harvested texts resolve the batch. A tiny external store connects the bridge and React.
 */
export interface SheetBatch {
  id: number;
  pair: LangPair;
  texts: string[];
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

export const browserTranslationBridge: ChromeTranslatorBridge = {
  // Every browser we target has page translation; the user decides whether to use it.
  availability: () => Promise.resolve('available'),
  translate(pair, texts) {
    return new Promise<string[]>((resolve, reject) => {
      sheetStore.cancel('Superseded');
      current = { id: nextId++, pair, texts, resolve, reject };
      emit();
    });
  },
};

export type BrowserKind =
  'chrome-android' | 'chrome-desktop' | 'edge' | 'safari' | 'firefox' | 'other';

export function detectBrowser(ua = navigator.userAgent): BrowserKind {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua))
    return /Android|Mobile|CriOS/.test(ua) ? 'chrome-android' : 'chrome-desktop';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
