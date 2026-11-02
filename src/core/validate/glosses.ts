import { functionWords } from '../detectLanguage';

/** A bracket of words in Latin letters, no figures: "(tool calling)", "(Standard of Care)". */
const LATIN_GLOSS = /\(\p{Script=Latin}[\p{Script=Latin} '’,-]{0,60}\p{Script=Latin}\)/gu;

const untagged = (t: string) => t.replace(/<\/?t\d+>/g, '');

/** How English a term reads: its function words, Title Case, English endings, an acronym. */
const englishness = (term: string) =>
  2 * functionWords(term, 'en') +
  (/^(?:\p{Lu}\p{Ll}+[ -]?)+$/u.test(term) ? 1 : 0) +
  (/(?:ing|ness|ship|ity|ment|tion)\b/u.test(term) ? 1 : 0) +
  (/^\p{Lu}{2,6}$/u.test(term) ? 1 : 0);

/**
 * Terms in brackets a translation left out: a Spanish or Czech paper names the English term after
 * its own ("Arquitectura de Invocación de Herramientas (Tool Calling)") and Google drops it as
 * said twice. As many as the translation lost, the most English first; brackets with the source
 * language's function words or letters ("(CDSS, en adelante)") are its own text, not a term.
 */
export function droppedGlosses(source: string, target: string, lang: string): string[] {
  if (lang === 'en') return [];
  const count = (t: string) => untagged(t).match(/\(/gu)?.length ?? 0;
  const lost = count(source) - count(target);
  if (lost <= 0) return [];
  return [...untagged(source).matchAll(LATIN_GLOSS)]
    .map((m) => m[0])
    .filter(
      (g) =>
        /^[\x20-\x7e’]+$/u.test(g) &&
        functionWords(g.slice(1, -1), lang) === 0 &&
        g.split(/\s+/u).length <= 6 &&
        !untagged(target).includes(g),
    )
    .map((g, order) => ({ g, order, score: englishness(g.slice(1, -1)) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, lost)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.g);
}
