import { createContext, useContext } from 'react';
import { makeTranslate, type Translate, type UiLang } from './translate';

export const I18nContext = createContext<{ lang: UiLang; t: Translate }>({
  lang: 'en',
  t: makeTranslate('en'),
});

export function useI18n() {
  return useContext(I18nContext);
}
