/**
 * Locale-tolerant number comparison. Academic texts do not always follow their language's
 * separator conventions, so each numeric token gets every value it can validly denote
 * ("1,000" → {1000, 1}; "3,5" → {3.5}) and source/target tokens are matched bipartitely.
 */
/** Decimal/thousands separators: dot, comma, space, no-break space, narrow no-break space. */
const SEP = '[.,\\u0020\\u00a0\\u2000-\\u200a\\u202f\\u205f]';
// A space separates thousands only before exactly three digits ("12 500"); "3-9 5" (a page
// number after a page range) is two numbers.
const NUMBER_RE = /\d+(?:[.,]\d+|[\u0020\u00a0\u2000-\u200a\u202f\u205f]\d{3}(?!\d))*/g;
const SEP_RE = new RegExp(SEP);
const SEP_RE_G = new RegExp(SEP, 'g');

export function candidateValues(token: string): number[] {
  const values = new Set<number>();
  const groups = token.split(SEP_RE);
  const seps = token.match(SEP_RE_G) ?? [];
  if (seps.length === 0) {
    values.add(Number(token));
    return [...values];
  }
  const thousandsOk = (sepIdxs: number[]) =>
    sepIdxs.every((i) => groups[i + 1]?.length === 3) && (groups[0]?.length ?? 0) <= 3;
  // Interpretation A: the last separator is a decimal point, earlier ones are thousands.
  const last = seps.length - 1;
  const earlier = seps.slice(0, last);
  const lastSep = seps[last]!;
  if (
    (lastSep === '.' || lastSep === ',') &&
    earlier.every((s) => s !== lastSep) &&
    thousandsOk(earlier.map((_, i) => i))
  ) {
    values.add(Number(`${groups.slice(0, -1).join('')}.${groups[groups.length - 1]}`));
  }
  // Interpretation B: every separator is a thousands separator (all the same character).
  if (seps.every((s) => s === seps[0]) && thousandsOk(seps.map((_, i) => i))) {
    values.add(Number(groups.join('')));
  }
  if (values.size === 0) {
    // Not a well-formed number (e.g. "1.2.3" section numbers): compare digit groups as-is.
    groups.forEach((g) => values.add(Number(g)));
  }
  return [...values];
}

export function extractNumbers(text: string): string[] {
  // Runs of spaces count as one (source and target are compared alike), and "425 ,0" — a decimal
  // split by extraction — is one number.
  const joined = text.replace(/\s{2,}/g, ' ').replace(/(\d)\s+([.,])(\d)/g, '$1$2$3');
  return [...joined.matchAll(NUMBER_RE)].map((m) => m[0].trim());
}

const ROMAN_RE =
  /\b(?=[MDCLXVI]{2,}\b)M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})\b/g;
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanValue(r: string): number {
  let v = 0;
  for (let i = 0; i < r.length; i++) {
    const cur = ROMAN[r[i]!]!;
    const next = ROMAN[r[i + 1] ?? ''] ?? 0;
    v += cur < next ? -cur : cur;
  }
  return v;
}

/** Greek numerals with a keraia ("Α’ Γυμνασίου" = 1st grade, "Γ’ τάξη" = 3rd class). */
const GREEK_NUMERAL_RE = /(?<!\p{L})(ΣΤ|[ΑΒΓΔΕΖΗΘΙ])['’ʹ](?!\p{L})/gu;
const GREEK_NUMERAL: Record<string, number> = {
  Α: 1,
  Β: 2,
  Γ: 3,
  Δ: 4,
  Ε: 5,
  ΣΤ: 6,
  Ζ: 7,
  Η: 8,
  Θ: 9,
  Ι: 10,
};

/**
 * Number words that a translation may write as digits ("négy" → 4, "tisíc" → 1,000, "nineties" →
 * 1990s), per source language, for WORD_VALUES in order.
 */
const NUMBER_WORDS: Record<string, string[]> = {
  en: [
    'two',
    'three',
    'four',
    'five',
    'ten',
    'hundreds?',
    'thousands?',
    'sixties',
    'eighties',
    'nineties',
  ],
  de: [
    'zwei',
    'drei',
    'vier',
    'fünf',
    'zehn',
    'hundert',
    'tausend',
    'sechziger',
    'achtziger',
    'neunziger',
  ],
  fr: ['deux', 'trois', 'quatre', 'cinq', 'dix', 'cents?', 'milles?', '', '', ''],
  es: ['dos', 'tres', 'cuatro', 'cinco', 'diez', 'cien(?:to)?s?', 'mil', '', '', ''],
  it: ['due', 'tre', 'quattro', 'cinque', 'dieci', 'cento', 'mille', '', '', ''],
  pt: ['dois', 'três', 'quatro', 'cinco', 'dez', 'cem', 'mil', '', '', ''],
  nl: ['twee', 'drie', 'vier', 'vijf', 'tien', 'honderd', 'duizend', '', '', ''],
  pl: [
    'dwa',
    'trzy',
    'cztery',
    'pięć',
    'dziesięć',
    'sto',
    'tysiąc\\p{L}*',
    '',
    'osiemdziesiąt\\p{L}*',
    'dziewięćdziesiąt\\p{L}*',
  ],
  cs: [
    'dva',
    'tři',
    'čtyři',
    'pět',
    'deset',
    'sto',
    'tisíc\\p{L}*',
    'šedesát\\p{L}*',
    'osmdesát\\p{L}*',
    'devadesát\\p{L}*',
  ],
  ru: [
    'два',
    'три',
    'четыре',
    'пять',
    'десять',
    'сто',
    'тысяч\\p{L}*',
    'шестидесят\\p{L}*',
    'восьмидесят\\p{L}*',
    'девяност\\p{L}*',
  ],
  uk: ['два', 'три', 'чотири', "п'ять", 'десять', 'сто', 'тисяч\\p{L}*', '', '', ''],
  hu: [
    'két|kettő',
    'három',
    'négy',
    'öt',
    'tíz',
    'száz',
    'ezer',
    'hatvanas',
    'nyolcvanas',
    'kilencvenes',
  ],
  ro: ['doi|două', 'trei', 'patru', 'cinci', 'zece', 'sută', 'mii|mie', '', '', ''],
  sv: ['två', 'tre', 'fyra', 'fem', 'tio', 'hundra', 'tusen', '', '', ''],
  el: ['δύο', 'τρ(?:ία|εις)', 'τέσσερ\\p{L}*', 'πέντε', 'δέκα', 'εκατό', 'χίλι\\p{L}*', '', '', ''],
  tr: ['iki', 'üç', 'dört', 'beş', 'on', 'yüz', 'bin', '', '', ''],
  bg: ['два|две', 'три', 'четири', 'пет', 'десет', 'сто', 'хиляд\\p{L}*', '', '', ''],
};
const WORD_VALUES = [2, 3, 4, 5, 10, 100, 1000, 1960, 1980, 1990];

/** Values the source writes in words, in the source language. */
function wordNumbers(text: string, lang: string): { t: string; v: number[]; optional: true }[] {
  const words = NUMBER_WORDS[lang];
  if (!words) return [];
  return text
    .split(/[^\p{L}']+/u)
    .flatMap((w) =>
      words.flatMap((pattern, k) =>
        pattern && new RegExp(`^(?:${pattern})$`, 'iu').test(w)
          ? [{ t: w, v: [WORD_VALUES[k]!], optional: true as const }]
          : [],
      ),
    );
}

/** Returns source tokens that have no matching target token, and vice versa. */
export function compareNumbers(
  source: string,
  target: string,
  /** Source language, for numbers written in words. */
  lang?: string,
): { missing: string[]; extra: string[] } {
  // A Roman numeral may become digits ("siglo XX" → "20th century"); one the target keeps as
  // is needs no match.
  const romans = [...source.matchAll(ROMAN_RE)]
    .map((m) => m[0])
    .filter((r) => r && !new RegExp(`\\b${r}\\b`).test(target));
  // A decade may gain its century ("90-es évek" → "the 1990s").
  const decade = (t: string, v: number[]) =>
    /^[1-9]0$/.test(t) ? [...v, 1900 + Number(t), 2000 + Number(t)] : v;
  const src = [
    ...extractNumbers(source).map((t) => ({
      t,
      v: decade(t, candidateValues(t)),
      optional: false,
    })),
    ...romans.map((t) => ({ t, v: [romanValue(t)], optional: true })),
    ...(lang ? wordNumbers(source, lang) : []),
    // A decade written with an apostrophe ("anni '90") becomes a year ("the 1990s").
    ...[...source.matchAll(/['’](\d{2})(?!\d)/g)].map((m) => ({
      t: m[0],
      v: [1900 + Number(m[1]), 2000 + Number(m[1])],
      optional: true,
    })),
    ...[...source.matchAll(GREEK_NUMERAL_RE)].map((m) => ({
      t: m[0],
      v: [GREEK_NUMERAL[m[1]!]!],
      optional: true,
    })),
  ];
  const tgt = extractNumbers(target).map((t) => ({ t, v: candidateValues(t) }));
  const matchOf = new Array<number>(tgt.length).fill(-1);
  const compatible = (i: number, j: number) => src[i]!.v.some((x) => tgt[j]!.v.includes(x));
  const augment = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < tgt.length; j++) {
      if (seen[j] || !compatible(i, j)) continue;
      seen[j] = true;
      if (matchOf[j] === -1 || augment(matchOf[j]!, seen)) {
        matchOf[j] = i;
        return true;
      }
    }
    return false;
  };
  const missing: string[] = [];
  src.forEach((s, i) => {
    if (!augment(i, new Array<boolean>(tgt.length).fill(false)) && !s.optional) missing.push(s.t);
  });
  const extra = tgt.filter((_, j) => matchOf[j] === -1).map((x) => x.t);
  return { missing, extra };
}

/**
 * Writes the numbers of a machine translation the way the source wrote them: Google turns
 * "100.0±0.0" into "100,0±0,0" and "31,292" into "31.292" in running text while table cells
 * keep the source spelling. A number is rewritten only when its digits are the source's and its
 * value is the only one that fits a single source spelling (and that spelling fits only it);
 * anything else stays. Tags and placeholders are not numbers.
 */
export function keepNumberSpelling(source: string, target: string): string {
  const mask = (t: string) => t.replace(/<\/?t\d+>|⟦[^⟧]*⟧/g, (m) => '\u0001'.repeat(m.length));
  const find = (t: string) =>
    [...mask(t).matchAll(NUMBER_RE)].map((m) => ({
      text: m[0],
      at: m.index,
      v: candidateValues(m[0]),
    }));
  const src = find(source);
  const tgt = find(target);
  const digits = (t: string) => t.replace(/\D/g, '');
  // A source number the target already spells alike is spoken for.
  const free = [...src];
  const open = tgt.filter((t) => {
    const k = free.findIndex((s) => s.text === t.text);
    if (k >= 0) free.splice(k, 1);
    return k < 0;
  });
  const fits = (s: { text: string; v: number[] }, t: { text: string; v: number[] }) =>
    digits(s.text) === digits(t.text) && s.v.some((x) => t.v.includes(x));
  const edits = open.flatMap((t) => {
    const from = free.filter((s) => fits(s, t));
    const spelling = from[0];
    if (!spelling || from.some((s) => s.text !== spelling.text)) return [];
    // As many numbers to rewrite as there are source numbers to take the spelling from.
    const rivals = open.filter((o) => fits(spelling, o));
    return rivals.length <= from.length ? [{ ...t, to: spelling.text }] : [];
  });
  let out = target;
  for (const e of edits.reverse())
    out = out.slice(0, e.at) + e.to + out.slice(e.at + e.text.length);
  return out;
}
