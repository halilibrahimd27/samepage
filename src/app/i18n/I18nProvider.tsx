import { useEffect, useState, type ReactNode } from 'react';
import { I18nContext } from './context';
import { isLoaded, loadUiLang, makeTranslate, type UiLang } from './translate';

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  // A language that loads on demand shows in English until its dictionary is there.
  const [ready, setReady] = useState<UiLang | null>(null);
  useEffect(() => {
    let active = true;
    if (!isLoaded(lang)) void loadUiLang(lang).then(() => active && setReady(lang));
    return () => {
      active = false;
    };
  }, [lang]);
  const shown = isLoaded(lang) || ready === lang ? lang : 'en';
  return <I18nContext value={{ lang: shown, t: makeTranslate(shown) }}>{children}</I18nContext>;
}
