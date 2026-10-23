/**
 * Languages offered in v1: scripts covered by the bundled Noto fonts (Latin, Cyrillic, Greek).
 * RTL and CJK are out of scope for v1. Codes are BCP-47; display names come from Intl.
 */
export const LANGUAGES = [
  'tr',
  'en',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'cs',
  'ro',
  'hu',
  'sv',
  'ru',
  'uk',
  'bg',
  'el',
] as const;

export type LanguageCode = (typeof LANGUAGES)[number];

export function languageName(code: string, uiLang: string): string {
  try {
    return new Intl.DisplayNames([uiLang], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
