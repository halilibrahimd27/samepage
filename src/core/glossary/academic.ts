import { tokenize } from '../segment/codec';

/**
 * Section names that machine translation gets wrong without context: "Abstract" alone becomes
 * "Soyut" / "Abstrakt" / "Абстрактный". Used for engines without glossary support when a whole
 * segment is that heading (optionally followed by ":" or ".").
 */
const ABSTRACT: Record<string, string> = {
  en: 'Abstract',
  tr: 'Özet',
  de: 'Zusammenfassung',
  fr: 'Résumé',
  es: 'Resumen',
  it: 'Sommario',
  pt: 'Resumo',
  nl: 'Samenvatting',
  pl: 'Streszczenie',
  cs: 'Abstrakt',
  ro: 'Rezumat',
  hu: 'Összefoglaló',
  sv: 'Sammanfattning',
  ru: 'Аннотация',
  uk: 'Анотація',
  bg: 'Резюме',
  el: 'Περίληψη',
};

/** The translated heading with the source's markup and letter case, or null. */
export function academicHeading(tagged: string, source: string, target: string): string | null {
  const from = ABSTRACT[source];
  const to = ABSTRACT[target];
  if (!from || !to) return null;
  const tokens = tokenize(tagged);
  const texts = tokens.filter((t) => t.type === 'text' && t.text.trim());
  if (texts.length !== 1) return null;
  const m = /^(\s*)(\p{L}+)(\s*[:.]?\s*)$/u.exec((texts[0] as { text: string }).text);
  if (!m || m[2]!.toLocaleLowerCase(source) !== from.toLocaleLowerCase(source)) return null;
  const word = m[2]!;
  const cased = word === word.toLocaleUpperCase(source) ? to.toLocaleUpperCase(target) : to;
  return tokens
    .map((t) => {
      if (t === texts[0]) return m[1]! + cased + m[3]!;
      if (t.type === 'text') return t.text;
      if (t.type === 'ph') return `⟦${t.id}⟧`;
      return t.type === 'open' ? `<${t.id}>` : `</${t.id}>`;
    })
    .join('');
}
