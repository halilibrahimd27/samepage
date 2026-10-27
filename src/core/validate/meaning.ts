import type { FidelityFinding, FidelityPair } from '../../engines/types';
import { splitSentences } from '../../engines/plainText';
import { functionWords } from '../detectLanguage';
import { tokenize } from '../segment/codec';

/**
 * Back-translation meaning check for machine translators (ADR-022). The translation is
 * translated back into the source language and compared with the source for the cues that
 * change what a sentence claims: negation, hedging (a claim made stronger or weaker) and
 * quantifier scope ("most" → "all"). Back-translation paraphrases, so wording is never compared,
 * only whether a class of cue is present on both sides.
 */

/** A pattern that matches whole words only (JS \b does not know non-ASCII letters). */
const words = (alternatives: string[]) =>
  new RegExp(`(?<![\\p{L}\\p{M}])(?:${alternatives.join('|')})(?![\\p{L}\\p{M}])`, 'giu');

interface Cues {
  /** Phrases that look like negation but are not ("whether … or not", "not only … but"). */
  ignore?: RegExp;
  /** Syntactic negation ("not", "never", Turkish "-me-"): its loss or gain reverses a claim. */
  negation: RegExp;
  /**
   * Lexical negation ("missing", "impossible", "unable"): a paraphrase may turn it into syntactic
   * negation and back, so either side having it suppresses a negation finding.
   */
  softNegation?: RegExp;
  /** Hedges whose loss makes a claim stronger. */
  hedge?: RegExp;
  /** Hedges plus weaker modal forms; accepted as a match for `hedge` on the other side. */
  weakHedge?: RegExp;
  quantifiers?: Record<string, RegExp>;
}

const EN_HEDGE = [
  'may',
  'might',
  'could',
  'possibly',
  'probably',
  'likely',
  'unlikely',
  'perhaps',
  'potentially',
  'presumably',
  'plausibl[ey]',
  // "suggest" hedges a finding ("results suggest that"), not a proposal ("was suggested by").
  'suggest(?:s|ed|ing)? that',
  '(?:results|findings|data|evidence|analys[ie]s|study|studies|this|these|which|it) suggests?',
  'appear(?:s|ed)? to',
  'seem(?:s|ed)?',
  // Not the limit of mathematics ("tends to zero", "tends to the stationary distribution").
  'tend(?:s|ed)? to(?! (?:zero|infinity|one|a|an|the|its|\\d|∞))',
];
const TR_HEDGE = [
  'muhtemelen',
  'belki',
  'ihtimal\\p{L}*',
  'gibi görün\\p{L}*',
  'düşündür\\p{L}*',
  'olabil\\p{L}*',
  // "-abileceğini" (that it may …) reports a possibility.
  '\\p{L}+[ae]bilece[ğk]\\p{L}*',
];
/** "-abilir" is also plain ability ("uygulanabilir" = applicable), "olası" an adjective. */
const TR_WEAK_HEDGE = [
  '\\p{L}+[ae]bil(?:ir|ecek|eceğ|mekte|iyor|en)\\p{L}*',
  'muhtemel\\p{L}*',
  'olası\\p{L}*',
  'potansiyel\\p{L}*',
  'mümkün\\p{L}*',
  'olasılık\\p{L}*',
];

const CUES: Record<string, Cues> = {
  en: {
    negation: words([
      'not',
      'no(?!\\.\\s*\\d)',
      'never',
      'none',
      'nor',
      'neither',
      'nothing',
      'nobody',
      'nowhere',
      'without',
      'cannot',
      "\\p{L}+n[’']t",
    ]),
    softNegation: words([
      'fail(?:s|ed|ing|ure)?',
      'lack(?:s|ed|ing)?',
      'absen(?:ce|t)',
      'missing',
      'unable',
      'impossible',
      'in(?:feasible|complete|correct|sufficient|valid|accurate|capable)',
      'im(?:practical|proper|probable)',
      '(?:in|un|im)\\p{L}{3,}(?:able|ible)',
      'a(?:periodic|symmetric|typical|cyclic)',
      '\\p{L}{3,}less',
      '\\p{L}+-free',
      '\\p{L}+-less',
      'otherwise',
      'yet to',
      'instead',
      'rather than',
      // un- adjectives ("not popular" ↔ "unpopular"), not under-, uni-, until, unless.
      'un(?!der|i|til|less)\\p{L}{4,}',
      'non-?\\p{L}{3,}',
    ]),
    hedge: words(EN_HEDGE),
    weakHedge: words([
      ...EN_HEDGE,
      'can',
      'possible',
      'possibility',
      'probable',
      'maybe',
      'seemingly',
      'potential',
      'apparently',
      'appear(?:s|ed)?',
      'as if',
      'as though',
      'almost',
    ]),
    ignore: words(['(?:whether )?or not', 'not only']),
    quantifiers: {
      'all/every': words(['all', 'every', 'each', 'always', 'entire(?:ly)?', 'whole']),
      most: words(['most', 'majority', 'mostly', 'largely']),
      some: words(['some', 'several', 'a few', 'partly', 'partially', 'sometimes']),
      few: words(['(?<!a )few', 'rarely', 'seldom', 'minority']),
    },
  },
  tr: {
    // Verb negation is a suffix. "-maz/-mez" only in lower-case words: names ("Yılmaz", "Dönmez").
    negation: new RegExp(
      `(?<!\\p{L})(?:[Dd]eğil\\p{L}*|[Yy]ok(?:tur|tu)?|[Hh]iç\\p{L}*|[Aa]sla|\\p{Ll}{2,}m[ae]z\\p{L}*|\\p{L}\\p{Ll}+(?:m[ae]d[ıi]|m[ae]m[ıi]ş|m[ae]y[ae]n|m[ae]m[ae]k|m[ıiuü]yor|m[ae]m[ae]l[ıi]|m[ae]y[ae]c[ae]k|m[ae]y[ae]bil|m[ae]s[ae]|m[ae]y[ıi]p|m[ae]ks[ıi]z[ıi]n)\\p{L}*)(?!\\p{L})`,
      'gu',
    ),
    softNegation: words([
      'eksik\\p{L}*',
      'yerine',
      'ziyade',
      'aksine',
      '\\p{Ll}{2,}s[ıiuü]z\\p{L}*',
      'imkânsız\\p{L}*',
      'olanaksız\\p{L}*',
    ]),
    hedge: words(TR_HEDGE),
    // "olup olmadığı" is "whether or not"; "yok etmek" is "to destroy".
    ignore: words(['olup olma\\p{L}*', 'yok (?:et|ed|ol|say)\\p{L}*']),
    weakHedge: words([...TR_HEDGE, ...TR_WEAK_HEDGE]),
    quantifiers: {
      'all/every': words([
        'tüm\\p{L}*',
        'bütün\\p{L}*',
        'her',
        'hepsi\\p{L}*',
        'daima',
        'tamam\\p{L}*',
      ]),
      most: words(['çoğu\\p{L}*', 'çoğunluk\\p{L}*', 'büyük ölçüde', 'büyük kısm\\p{L}*']),
      some: words(['bazı\\p{L}*', 'bazen', 'kısmen', 'birkaç']),
      few: words(['az sayıda', 'nadiren']),
    },
  },
  de: {
    negation: words([
      'nicht',
      'kein\\p{L}*',
      'nie',
      'niemals',
      'nichts',
      'niemand',
      'ohne',
      'weder',
    ]),
  },
  fr: { negation: words(['ne', "n[’']", 'pas', 'jamais', 'aucun\\p{L}*', 'sans', 'ni', 'rien']) },
  es: {
    negation: words([
      'no',
      'nunca',
      'ningun\\p{L}*',
      'ningún',
      'nada',
      'nadie',
      'sin',
      'ni',
      'jamás',
      'tampoco',
    ]),
  },
  it: { negation: words(['non', 'mai', 'nessun\\p{L}*', 'niente', 'nulla', 'senza', 'né']) },
  pt: {
    negation: words(['não', 'nunca', 'nenhum\\p{L}*', 'nada', 'ninguém', 'sem', 'nem', 'jamais']),
  },
  ru: { negation: words(['не', 'нет', 'ни', 'никогда', 'ничего', 'никто', 'без', 'нельзя']) },
};

const has = (re: RegExp, text: string) => {
  re.lastIndex = 0;
  return re.test(text);
};

/**
 * Plain words of tagged text: identifiers as written, formulas and code as "X" (a sentence
 * without its formulas falls apart in back-translation), other placeholders as spaces.
 */
export function cueText(tagged: string, verbatim?: Record<string, string>): string {
  const ph = (id: string) => verbatim?.[id] ?? (/^[FC]/.test(id) ? ' X ' : ' ');
  return tokenize(tagged)
    .map((t) => (t.type === 'text' ? t.text : t.type === 'ph' ? ph(t.id) : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Difference {
  issue: string;
  severity: 'minor' | 'major';
  /** The back-translated sentence the difference was found in (long paragraphs). */
  sentence?: string;
}

/** Cue differences between one source passage and its back-translation. */
function differences(sourceText: string, backText: string, cues: Cues): Difference[] {
  const out: Difference[] = [];
  const clean = (t: string) => (cues.ignore ? t.replace(cues.ignore, ' ') : t);
  const source = clean(sourceText);
  const back = clean(backText);
  const negSource = has(cues.negation, source);
  const negBack = has(cues.negation, back);
  const soft =
    !!cues.softNegation && (has(cues.softNegation, source) || has(cues.softNegation, back));
  if (negSource && !negBack && !soft) out.push({ issue: 'negation lost', severity: 'major' });
  if (!negSource && negBack && !soft) out.push({ issue: 'negation added', severity: 'major' });
  // Only a hedge that disappears is reported: one the back-translation adds is nearly always
  // paraphrase ("would have been unattainable" → "could not have been achieved").
  if (cues.hedge && cues.weakHedge && has(cues.hedge, source) && !has(cues.weakHedge, back))
    out.push({
      issue: 'hedging lost: the claim may read stronger than in the source',
      severity: 'major',
    });
  if (cues.quantifiers) {
    const classes = Object.entries(cues.quantifiers);
    const lost = classes.filter(([, re]) => has(re, source) && !has(re, back)).map(([k]) => k);
    const added = classes.filter(([, re]) => !has(re, source) && has(re, back)).map(([k]) => k);
    if (lost.length && added.length)
      out.push({
        issue: `quantifier changed: ${lost.join(', ')} → ${added.join(', ')}`,
        severity: 'major',
      });
  }
  return out;
}

/**
 * Meaning differences between a source text and the back-translation of its translation.
 * Back-translation usually keeps the sentence count; then sentences are compared pairwise and
 * each finding names its sentence. Otherwise the whole passage is compared, which in a long
 * paragraph only reports a cue class that is missing everywhere on one side.
 */
export function compareMeaning(source: string, back: string, lang: string): Difference[] {
  const cues = CUES[lang];
  // Headings and table cells are too short for a reliable comparison.
  if (!cues || !back.trim() || source.split(/\s+/).length < 5) return [];
  const sourceSentences = splitSentences(source);
  const backSentences = splitSentences(back);
  const words = (t: string) => t.split(/\s+/).length;
  // Pairs only when every pair has a similar length (otherwise sentences were split or merged
  // differently and the pairs are shifted).
  const aligned =
    sourceSentences.length > 1 &&
    sourceSentences.length === backSentences.length &&
    sourceSentences.every((t, i) => {
      const r = words(backSentences[i]!) / words(t);
      return r > 0.5 && r < 2;
    });
  if (!aligned) return differences(source, back, cues);
  const seen = new Set<string>();
  return sourceSentences.flatMap((sentence, i) =>
    differences(sentence, backSentences[i]!, cues)
      .filter((d) => !seen.has(d.issue) && seen.add(d.issue))
      .map((d) => ({ ...d, sentence: backSentences[i]!.trim() })),
  );
}

/** Findings for translated pairs, given the back-translation of each target. */
export function backTranslationFindings(
  pairs: FidelityPair[],
  back: string[],
  lang: string,
  targetLang: string,
): FidelityFinding[] {
  // A back-translation the translator left in the target language says nothing.
  const inSource = (t: string) => functionWords(t, lang) >= functionWords(t, targetLang);
  return pairs.flatMap((p, i) =>
    (inSource(back[i] ?? '')
      ? compareMeaning(cueText(p.source, p.verbatim), back[i] ?? '', lang)
      : []
    ).map((f) => ({
      id: p.id,
      issue: f.issue,
      severity: f.severity,
      backTranslation: f.sentence ?? back[i]!,
    })),
  );
}
