import type { ReactNode } from 'react';
import { I18nContext } from './context';
import { makeTranslate, type UiLang } from './translate';

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  return <I18nContext value={{ lang, t: makeTranslate(lang) }}>{children}</I18nContext>;
}
