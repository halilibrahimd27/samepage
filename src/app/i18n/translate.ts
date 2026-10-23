import { en, type MessageKey } from './en';
import { tr } from './tr';

export type UiLang = 'en' | 'tr';
export const UI_LANGS: readonly UiLang[] = ['en', 'tr'];

const DICTS: Record<UiLang, Record<MessageKey, string>> = { en, tr };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function makeTranslate(lang: UiLang): Translate {
  const dict = DICTS[lang];
  return (key, vars) =>
    dict[key].replace(/\{(\w+)\}/g, (match, name: string) =>
      vars && name in vars ? String(vars[name]) : match,
    );
}

export function detectUiLang(languages: readonly string[]): UiLang {
  return languages.some((l) => l.toLowerCase().startsWith('tr')) ? 'tr' : 'en';
}
