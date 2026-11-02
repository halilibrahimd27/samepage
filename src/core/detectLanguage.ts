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

/**
 * The language of a short text such as a reference title, from its function words and its
 * language's own letters ("kayması" is Turkish, "Übersicht" German). A text with letters
 * outside ASCII but no clearer sign is taken to be in `hint` (the paper's language) when the
 * script matches. Null when nothing tells (an English title without function words).
 */
export function shortTextLanguage(text: string, hint?: string): LanguageCode | null {
  const words = text.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  if (!words.length) return null;
  const counts = { latin: 0, cyrillic: 0, greek: 0 };
  for (const w of words)
    for (const s of ['latin', 'cyrillic', 'greek'] as const) if (SCRIPT[s].test(w)) counts[s]++;
  const script = (['latin', 'cyrillic', 'greek'] as const).reduce((a, b) =>
    counts[b] > counts[a] ? b : a,
  );
  const sample = words.join(' ');
  const scores = LANGUAGES.filter((l) => scriptOf(l) === script)
    .map((lang) => ({
      lang,
      score: languageScore(text, lang) + 0.5 * (sample.match(LETTERS[lang] ?? /$^/gu)?.length ?? 0),
    }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best && best.score >= 0.5 && best.score > (second?.score ?? 0)) return best.lang;
  const hinted = LANGUAGES.find((l) => l === hint && scriptOf(l) === script);
  if (hinted && (script !== 'latin' || /[^a-z\s]/u.test(sample))) return hinted;
  // Another script than the hint's: its first language stands for it.
  return script === 'latin' ? null : (scores[0]?.lang ?? null);
}

/**
 * Writing systems outside the offered languages, each with the language Google reads it as
 * (Persian and Urdu by their own letters; Japanese by its kana).
 */
const OTHER_SCRIPTS: [RegExp, (text: string) => string][] = [
  [/\p{Script=Arabic}/gu, (t) => (/[پچژگ]/u.test(t) ? 'fa' : /[ٹڈڑںے]/u.test(t) ? 'ur' : 'ar')],
  [/\p{Script=Hebrew}/gu, () => 'iw'],
  [
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
    (t) => (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t) ? 'ja' : 'zh-CN'),
  ],
  [/\p{Script=Hangul}/gu, () => 'ko'],
  [/\p{Script=Devanagari}/gu, () => 'hi'],
  [/\p{Script=Thai}/gu, () => 'th'],
  [/\p{Script=Armenian}/gu, () => 'hy'],
  [/\p{Script=Georgian}/gu, () => 'ka'],
];
/** Letters outside Mathematical Alphanumeric Symbols ("𝑝", "𝐱" belong to no language). */
const LETTER = /(?![\u{1d400}-\u{1d7ff}])\p{L}/gu;

/**
 * Function words of Latin-script languages outside the offered ones, to tell a paragraph in one
 * (an Indonesian paper with an English abstract; Malay reads as Indonesian). Google translates
 * from each of them.
 */
const MORE_STOPWORDS: Record<string, string> = {
  id: 'yang dan di ini dengan untuk dari dalam pada tidak akan adalah juga ke oleh atau dapat karena sebagai telah bahwa mereka lebih ada itu kami kita tersebut',
  ca: 'el la els les i de que en un una per amb no és del dels als al com més però aquest aquesta són també seu seva hi',
  vi: 'của và các có là được trong cho này với những một không người để đã khi từ theo về như',
  fi: 'ja on ei se että oli kun mutta tai myös ovat joka sekä kuin jos niin tämä nämä hän sen voi',
  da: 'og i at det er en som på af for med til den har ikke de et var men sig kan eller ved fra også efter meget',
  no: 'og i at det er en som på av for med til den har ikke de et var men seg kan eller ved fra også etter mye',
  sk: 'a v sa na je že s z do o to ako pre by vo sú k ktoré ktorý alebo aj pri bolo ich nie',
  hr: 'i u je na da se za od su s ne koji kao što ili iz o te biti bio može ali',
  sl: 'in je v na da se za ki so z ne kot pa ali tudi iz o bi lahko',
  lt: 'ir yra kad su į iš tai buvo kaip bet ar jo jų taip pat dėl už',
  lv: 'un ir ka ar uz no par kas tas bija arī lai vai bet pēc to',
  et: 'ja on et ei see oli kui ka mis või aga ning selle mida seda',
};
const MORE_LETTERS: Record<string, RegExp> = {
  vi: /[ạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹđơư]/gu,
  sk: /[ľĺŕô]/gu,
  lv: /[āēīūļņķģ]/gu,
  lt: /[ėįų]/gu,
  da: /[æø]/gu,
  no: /[æø]/gu,
  ca: /l·l|ŀ/gu,
};
const allSets = new Map<string, Set<string>>([
  ...sets,
  ...Object.entries(MORE_STOPWORDS).map(([l, w]): [string, Set<string>] => [
    l,
    new Set(w.split(' ')),
  ]),
]);
const allWeight = new Map<string, number>();
for (const set of allSets.values())
  for (const w of set) allWeight.set(w, (allWeight.get(w) ?? 0) + 1);

/** A language a paragraph clearly reads as by its function words and letters, among a script's. */
function clearLanguage(text: string, script: 'latin' | 'cyrillic' | 'greek', source: string) {
  const words =
    text
      .replace(/\bet al\.?/giu, ' ')
      .toLocaleLowerCase()
      .match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return null;
  const sample = words.join(' ');
  const candidates: string[] = [
    ...LANGUAGES.filter((l) => scriptOf(l) === script),
    ...(script === 'latin' ? Object.keys(MORE_STOPWORDS) : []),
  ];
  const scored = candidates.map((lang) => {
    const stop = allSets.get(lang)!;
    const letters = LETTERS[lang as LanguageCode] ?? MORE_LETTERS[lang];
    return {
      lang,
      score:
        words.reduce((n, w) => (stop.has(w) ? n + 1 / allWeight.get(w)! : n), 0) +
        0.3 * (letters ? (sample.match(letters)?.length ?? 0) : 0),
    };
  });
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const own = scored.find((s) => s.lang === source)?.score ?? 0;
  return best.lang !== source && best.score >= 3 && best.score >= 3 * Math.max(own, 0.5)
    ? best.lang
    : null;
}

/**
 * The language a paragraph is written in when it is not the document's: an abstract in English
 * in a Turkish paper, the Arabic body of a paper whose abstract is English. Another writing
 * system tells it at once; in the same one, its function words must clearly say so. Null when
 * the paragraph reads as the source language or nothing tells (names, figures, a short line).
 */
export function paragraphLanguage(text: string, source: string): string | null {
  const letters = text.match(LETTER) ?? [];
  if (letters.length < 3) return null;
  const joined = letters.join('');
  for (const [script, lang] of OTHER_SCRIPTS)
    if ((joined.match(script)?.length ?? 0) >= 0.6 * letters.length) return lang(text);
  const script = (['latin', 'cyrillic', 'greek'] as const).find(
    (s) => (joined.match(new RegExp(SCRIPT[s].source, 'gu'))?.length ?? 0) >= 0.6 * letters.length,
  );
  if (!script) return null;
  const known = LANGUAGES.find((l) => l === source);
  if (known && scriptOf(known) === script) return clearLanguage(text, script, source);
  // Words, not symbols: "α β γ" in a formula or a table head is no Greek.
  if (script !== 'latin' && !new RegExp(`${SCRIPT[script].source}{3}`, 'u').test(text)) return null;
  if (script === 'greek') return 'el';
  if (script === 'cyrillic') return shortTextLanguage(text) ?? 'ru';
  return clearLanguage(text, script, source);
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
