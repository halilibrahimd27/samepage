import { LANGUAGES, type LanguageCode } from './languages';

/**
 * Offline source-language detection for the offered languages: the alphabet narrows the
 * candidates, then frequent function words and language-specific letters decide. Deterministic
 * and conservative — returns null unless one language clearly wins.
 */

const STOPWORDS: Record<LanguageCode, string> = {
  tr: 've bir bu için ile da de olarak olan daha gibi çok ise veya ancak kadar sonra göre her şekilde değil olduğu arasında üzerinde ayrıca ne mi',
  en: 'the and of to in is that for with as are this on be by from which we an it or not have has these their was were can',
  de: 'der die und das ist nicht mit den von zu auf für sich des dem ein eine im wird werden auch als bei wir sind oder durch',
  fr: 'le la les et des est du une un que pour dans qui sur pas par au avec ce sont nous plus ou cette aux il',
  es: 'el la los las y que en del se por con una para es como al lo más su sus pero este esta entre son',
  it: 'il di che la e per un una del della non sono con si le gli dei nel alla delle anche più come questo essere',
  pt: 'o a os as de que e do da em um uma para com não por mais dos das se na no como ao são também',
  nl: 'de het een en van is dat op te in voor niet met zijn er die ook aan door wordt worden bij naar dit deze',
  pl: 'i w na z się nie do że jest to o jak przez dla oraz od po są które który ich tym jego może także',
  cs: 'a v se na je že s z do o to jako pro by ve jsou k které který nebo také při bylo jejich není',
  ro: 'și de în la cu pe care din o un este să nu a mai pentru ca sau ale prin sunt fost acest această',
  hu: 'a az és hogy nem is egy van meg ez de csak már mint vagy még kell volt ami aki pedig lesz ezt által',
  sv: 'och i att det som en är på av för med till den har inte om ett de var men sig kan eller vid från',
  ru: 'и в не на что с по как это к из для от о а при или также мы был его но так только же',
  uk: 'і в не на що з до як це у та для від по при або також ми був його але так лише є які',
  bg: 'и в на да се не от за че е с по са като това които или към при но той бъде във със',
  el: 'και το η ο της του την των σε να τα με για που οι είναι από στο στην τον ως στη ένα μια δεν',
};

/** Letters that point to one language (weighted less than function words). */
const LETTERS: Partial<Record<LanguageCode, RegExp>> = {
  tr: /[ğışİ]/gu,
  de: /[ßäöü]/gu,
  pl: /[ąęłńśźż]/gu,
  cs: /[ěřůťďň]/gu,
  ro: /[ăâșțţ]/gu,
  hu: /[őű]/gu,
  sv: /[å]/gu,
  pt: /[ãõ]/gu,
  es: /[ñ¿¡]/gu,
  fr: /[èêœ]/gu,
  uk: /[іїєґ]/gu,
  ru: /[ыэё]/gu,
  bg: /[ъ]/gu,
};

const SCRIPT: Record<'latin' | 'cyrillic' | 'greek', RegExp> = {
  latin: /\p{Script=Latin}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  greek: /\p{Script=Greek}/u,
};
const scriptOf = (lang: LanguageCode) =>
  ['ru', 'uk', 'bg'].includes(lang) ? 'cyrillic' : lang === 'el' ? 'greek' : 'latin';

const sets = new Map(LANGUAGES.map((l) => [l, new Set(STOPWORDS[l].split(' '))]));
/** A function word shared by k languages counts 1/k ("de", "que", "a" say little alone). */
const weight = new Map<string, number>();
for (const set of sets.values()) for (const w of set) weight.set(w, (weight.get(w) ?? 0) + 1);

/**
 * How strongly `text` reads as `lang`: its function words, each weighted by how many languages
 * share it ("a" says little, "the" a lot). Abbreviations such as "et al." are ignored.
 */
export function languageScore(text: string, lang: string): number {
  const stop = sets.get(lang as LanguageCode);
  if (!stop) return 0;
  const words =
    text
      .replace(/\bet al\.?/gi, ' ')
      .toLocaleLowerCase()
      .match(/\p{L}+/gu) ?? [];
  return words.reduce((n, w) => (stop.has(w) ? n + 1 / weight.get(w)! : n), 0);
}

/**
 * Number of the language's function words in `text` ("the", "and", "ve", "bir" …). Identifiers
 * such as `has_long_str` are not split into words. 0 means the text is names, code or figures.
 */
export function functionWords(text: string, lang: string): number {
  const stop = sets.get(lang as LanguageCode);
  if (!stop) return 0;
  let n = 0;
  for (const token of text.toLocaleLowerCase().split(/\s+/)) {
    const w = /^\p{P}*(\p{L}+)\p{P}*$/u.exec(token)?.[1];
    if (w && stop.has(w)) n++;
  }
  return n;
}

export interface DetectedLanguage {
  lang: LanguageCode;
  /** Winner's score divided by the runner-up's (≥ 1.5 when returned). */
  margin: number;
}

export function detectLanguage(text: string): DetectedLanguage | null {
  const words = (text.toLocaleLowerCase().match(/\p{L}+/gu) ?? []).slice(0, 5000);
  if (words.length < 20) return null;
  const counts = { latin: 0, cyrillic: 0, greek: 0 };
  for (const w of words) {
    for (const s of ['latin', 'cyrillic', 'greek'] as const) if (SCRIPT[s].test(w)) counts[s]++;
  }
  const script = (['latin', 'cyrillic', 'greek'] as const).reduce((a, b) =>
    counts[b] > counts[a] ? b : a,
  );

  const sample = words.join(' ');
  const scores = LANGUAGES.filter((l) => scriptOf(l) === script).map((lang) => {
    const stop = sets.get(lang)!;
    let score = words.reduce((n, w) => (stop.has(w) ? n + 1 / weight.get(w)! : n), 0);
    const letters = LETTERS[lang];
    if (letters) score += 0.3 * (sample.match(letters)?.length ?? 0);
    return { lang, score };
  });
  scores.sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < 5) return null;
  const margin = best.score / Math.max(1, second?.score ?? 0);
  return margin >= 1.5 ? { lang: best.lang, margin } : null;
}
