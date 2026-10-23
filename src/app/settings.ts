import { useCallback, useState } from 'react';
import { detectUiLang, UI_LANGS, type UiLang } from './i18n';

/** UI preferences. Never contains API keys (those live in the key store). */
export interface Settings {
  uiLang: UiLang;
  fidelityCheck: boolean;
  translateReferences: boolean;
  translateComments: boolean;
  translateMetadata: boolean;
  showTestEngine: boolean;
}

const STORAGE_KEY = 'samepage.settings';

export function defaultSettings(languages: readonly string[]): Settings {
  return {
    uiLang: detectUiLang(languages),
    fidelityCheck: true,
    translateReferences: false,
    translateComments: false,
    translateMetadata: false,
    showTestEngine: false,
  };
}

/** Merges stored values over defaults, accepting only well-typed fields. */
export function parseSettings(raw: string | null, defaults: Settings): Settings {
  if (!raw) return defaults;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof stored !== 'object' || stored === null) return defaults;
  const s = stored as Record<string, unknown>;
  const result = { ...defaults };
  if (typeof s.uiLang === 'string' && (UI_LANGS as readonly string[]).includes(s.uiLang)) {
    result.uiLang = s.uiLang as UiLang;
  }
  for (const key of [
    'fidelityCheck',
    'translateReferences',
    'translateComments',
    'translateMetadata',
    'showTestEngine',
  ] as const) {
    if (typeof s[key] === 'boolean') result[key] = s[key];
  }
  return result;
}

function readStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(() =>
    parseSettings(readStorage(), defaultSettings(navigator.languages)),
  );
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable (private mode): keep settings for this session only.
      }
      return next;
    });
  }, []);
  return [settings, update];
}
