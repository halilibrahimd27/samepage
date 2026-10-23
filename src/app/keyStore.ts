import { useCallback, useSyncExternalStore } from 'react';

/**
 * Anthropic API key store (SECURITY.md §4): memory-only by default; persisted to localStorage
 * only when the user opts in. Never logged, never put in URLs, reports or the cache.
 */
const STORAGE_KEY = 'samepage.anthropicKey';
const listeners = new Set<() => void>();

function readRemembered(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

let state = { key: readRemembered(), remember: readRemembered() !== '' };

function emit(next: typeof state) {
  state = next;
  try {
    if (next.remember && next.key) localStorage.setItem(STORAGE_KEY, next.key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: memory only.
  }
  listeners.forEach((l) => l());
}

export function useApiKey() {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  return {
    key: snapshot.key,
    remember: snapshot.remember,
    setKey: useCallback((key: string) => emit({ ...state, key: key.trim() }), []),
    setRemember: useCallback((remember: boolean) => emit({ ...state, remember }), []),
    forget: useCallback(() => emit({ key: '', remember: false }), []),
  };
}
