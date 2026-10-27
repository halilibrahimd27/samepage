/**
 * "et al." in author–year and numbered citations, written the target language's way (P8.5):
 * Turkish APA uses "vd.", Russian and Bulgarian "и др.", Ukrainian "та ін.", Polish "i in.".
 * Engines leave "et al." as it is, expand it ("ve diğerleri", "and others") or read Turkish "vd."
 * as "etc."; in a citation all of these become the target form. Off unless the user turns it on.
 */

const ET_AL: Record<string, string> = {
  tr: 'vd.',
  ru: 'и др.',
  bg: 'и др.',
  uk: 'та ін.',
  pl: 'i in.',
};

/** Forms engines produce for "and colleagues" after an author name. */
const FORMS = [
  'et\\s+al\\.?',
  'and\\s+others',
  'and\\s+colleagues',
  've\\s+diğerleri',
  've\\s+ark\\.?',
  've\\s+arkadaşları',
  'vd\\.?',
  'и\\s+др\\.?',
  'и\\s+соавт\\.?',
  'та\\s+ін\\.?',
  'i\\s+in\\.?',
  'u\\.\\s*a\\.',
].join('|');

/**
 * Author name, form, then what makes it a citation: a year ("(2020)", ", 2020"), a page-free
 * bracket number ("[12]") or the end of a parenthesised citation.
 */
const CITATION = new RegExp(
  `(\\p{Lu}[\\p{L}'’-]+)\\s+(?:${FORMS})(?=\\s*(?:[,(]\\s*)?(?:\\d{4}[a-z]?\\b|\\[\\d)|\\s*\\))`,
  'gu',
);

/** The target language's "et al." in citations; other text is left alone. */
export function localizeEtAl(text: string, target: string): string {
  const form = ET_AL[target] ?? 'et al.';
  return text.replace(CITATION, (_, name: string) => `${name} ${form}`);
}
