import { en, type MessageKey } from './en';
import { tr } from './tr';

export type UiLang = 'en' | 'tr' | 'de' | 'fr' | 'es';
export const UI_LANGS: readonly UiLang[] = ['en', 'tr', 'de', 'fr', 'es'];

type Dict = Record<MessageKey, string>;

/** English and Turkish ship with the app; the other languages load when chosen. */
const DICTS: Partial<Record<UiLang, Dict>> = { en, tr };
const LOADERS: Partial<Record<UiLang, () => Promise<Dict>>> = {
  de: () => import('./de').then((m) => m.de),
  fr: () => import('./fr').then((m) => m.fr),
  es: () => import('./es').then((m) => m.es),
};

/** Makes the language's dictionary available (an import of its own chunk); English on failure. */
export async function loadUiLang(lang: UiLang): Promise<void> {
  if (DICTS[lang]) return;
  try {
    DICTS[lang] = await LOADERS[lang]!();
  } catch {
    // Offline before the chunk was cached: the interface stays in English.
  }
}

export const isLoaded = (lang: UiLang) => !!DICTS[lang];

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeTranslate(lang: UiLang): Translate {
  const dict = DICTS[lang] ?? en;
  return (key, vars) =>
    dict[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match,
    );
}

/** The browser's first preferred language the interface speaks; English otherwise. */
export function detectUiLang(languages: readonly string[]): UiLang {
  for (const l of languages) {
    const code = l.toLowerCase().split('-')[0] as UiLang;
    if (UI_LANGS.includes(code)) return code;
  }
  return 'en';
}
