import type { FidelityFinding, FidelityPair } from '../../engines/types';
import { splitSentences } from '../../engines/plainText';
import { functionWords, languageScore } from '../detectLanguage';
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
  /** "No less" (a negated comparative: as much as), kept apart from the plain negation. */
  noLess?: RegExp;
  /** What says "no less" in a back-translation: itself, "at least as", "equally". */
  asMuch?: RegExp;
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
  // "olabilir" (may be) and "-abileceğini" (that it may …) report a possibility; "olabilmesi
  // için" (in order to be) and "sorulabilecek sorular" (questions that can be asked) do not.
  'olabilir\\p{L}*',
  '\\p{L}+[ae]bileceğ(?:i|in|ini|inden|ine)',
];
/** "-abilir" is also plain ability ("uygulanabilir" = applicable), "olası" an adjective. */
const TR_WEAK_HEDGE = [
  '\\p{L}+[ae]bil(?:ir|ecek|eceğ|mekte|iyor|en)\\p{L}*',
  'muhtemel\\p{L}*',
  'olası\\p{L}*',
  'potansiyel\\p{L}*',
  'mümkün\\p{L}*',
  'olasılık\\p{L}*',
  // "yapılabileceğini" (that … can be made) often comes back as "olanak sağladığını" (allows).
  'olanak\\p{L}*',
  'imk[âa]n\\p{L}*',
];

/**
 * A French "ne" that "pas", "plus", "jamais" … follow within a few words is a negation, whatever
 * comes before ("ne se limite pas").
 */
const NOT_PAS =
  "(?!\\s+(?:\\p{L}+[’'\\s]+){0,3}(?:pas|plus|jamais|rien|personne|guère|point|aucun\\p{L}*)(?!\\p{L}))";

/**
 * Cyrillic negation "не" in lower case, or capitalised at a sentence start: "Не" alone is also
 * helium ("t-Не/O2").
 */
const cyrillicNe = (cs: Cues): Cues => ({
  ...cs,
  negation: new RegExp(
    `${cs.negation.source}|(?<![\\p{L}\\p{M}])(?:не|(?<=^|[.!?:]\\s+)Не(?=\\s+\\p{Ll}))(?![\\p{L}\\p{M}])`,
    'gu',
  ),
});

/** Cue sets from word lists; the weak hedges include the hedges. */
function cues(c: {
  /** Phrases that look like negation but are not ("whether or not", "not only"). */
  ignore?: string[];
  negation: string[];
  soft: string[];
  hedge: string[];
  weak: string[];
  all: string[];
  most: string[];
  some: string[];
  few: string[];
}): Cues {
  return {
    ...(c.ignore ? { ignore: words(c.ignore) } : {}),
    negation: words(c.negation),
    softNegation: words(c.soft),
    hedge: words(c.hedge),
    weakHedge: words([...c.hedge, ...c.weak]),
    quantifiers: {
      'all/every': words(c.all),
      most: words(c.most),
      some: words(c.some),
      few: words(c.few),
    },
  };
}

const CUES: Record<string, Cues> = {
  en: {
    negation: words([
      'not',
      // Not the number sign ("No. 3", "project No 17–78").
      'no(?!\\.?\\s*\\d)',
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
      // "залишених без опіки" (left without care) ↔ "neglected".
      'neglect\\p{L}*',
      'depriv\\p{L}*',
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
      // "were excluded" ↔ "were not included".
      'exclu(?:de|ded|des|ding|sion)',
      // "it is omitted in Figure 4" ↔ "it is not included".
      'omi(?:t|ts|tted|tting|ssion)',
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
      // "how likely i is relevant" ↔ "the probability of i being related".
      'probabilit(?:y|ies)',
      'likelihood',
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
    ignore: words([
      '(?:whether )?or not',
      'not only',
      'above all',
      'after all',
      // "which may or may not be present" is "whether or not".
      '(?:may|might) or (?:may|might) not',
      // "The index could be calculated for 4845 respondents": what was possible, no hedge.
      'could be (?:calculated|computed|determined|obtained|included|analy[sz]ed|collected|measured|assessed|recruited|retrieved|extracted|identified)',
      // "with and without pre-training" compares, it negates nothing.
      'with(?: and| or)(?: one| those)? without',
      'without (?:and|or) with',
    ]),
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
      `(?<!\\p{L})(?:[Dd]eğil\\p{L}*|[Yy]ok(?:tur|tu|lu[kğ]\\p{L}*)?|[Hh]iç\\p{L}*|[Aa]sla|\\p{Ll}{2,}m[ae]z\\p{L}*|\\p{L}\\p{Ll}+(?:m[ae]d[ıi]|m[ae]m[ıi]ş|m[ae]y[ae]n|m[ae]m[ae](?:k|s[ıi])|m[ıiuü]yor|m[ae]m[ae]l[ıi]|m[ae]y[ae]c[ae]k|m[ae]y[ae]bil|m[ae]s[ae]|m[ae]y[ıi]p|m[ae]ks[ıi]z[ıi]n)\\p{L}*)(?!\\p{L})`,
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
      // "doğru değildir" (is not right) often comes back as "yanlıştır" (is wrong).
      'yanlış\\p{L}*',
      'hatalı\\p{L}*',
    ]),
    hedge: words(TR_HEDGE),
    // "olup olmadığı" is "whether or not"; "yok etmek" is "to destroy". Litotes say something
    // positive ("azımsanmayacak sıklıkta" is "quite often", "yadsınamaz" is "undeniable").
    ignore: words([
      'olup olma\\p{L}*',
      'yok (?:et|ed|ol|say)\\p{L}*',
      'her şeyden önce',
      'azımsan(?:a)?ma\\p{L}*',
      'küçümsen(?:e)?me\\p{L}*',
      'yadsınama\\p{L}*',
      'göz ardı edil(?:e)?me\\p{L}*',
    ]),
    weakHedge: words([...TR_HEDGE, ...TR_WEAK_HEDGE]),
    quantifiers: {
      // Not "tümce" (sentence), "tamamlanmış" (completed) or "bütünleşik" (integrated).
      'all/every': words([
        'tüm(?:ü\\p{L}*|den)?',
        'bütün(?:ü\\p{L}*)?',
        'her',
        'hepsi\\p{L}*',
        'daima',
        'tamam(?:en|ı\\p{L}*)',
      ]),
      most: words(['çoğu\\p{L}*', 'çoğunluk\\p{L}*', 'büyük ölçüde', 'büyük kısm\\p{L}*']),
      some: words(['bazı\\p{L}*', 'bazen', 'kısmen', 'birkaç']),
      few: words(['az sayıda', 'nadiren']),
    },
  },
  de: cues({
    ignore: [
      'vor allem',
      'oder nicht',
      'nicht nur',
      // "nicht allein … sondern" is "not only … but"; "nicht allein" alone is "not alone".
      'nicht (?:allein|bloß|lediglich|einzig)(?=[^.;]*sondern)',
    ],
    negation: ['nicht', 'kein\\p{L}*', 'nie', 'niemals', 'nichts', 'niemand', 'ohne', 'weder'],
    soft: [
      'ausgeschlossen',
      'ausschl\\p{L}*',
      'verboten\\p{L}*',
      'fehl\\p{L}*',
      'mangel\\p{L}*',
      'unzureichend\\p{L}*',
      'unmöglich\\p{L}*',
      'un\\p{L}{4,}',
    ],
    hedge: [
      'möglicherweise',
      'vermutlich',
      'wahrscheinlich',
      'eventuell',
      'vielleicht',
      'schein(?:t|en)',
      'könnten?',
      'dürften?',
      'deute[nt] darauf hin',
      'legen? nahe',
      'lässt vermuten',
      'potenziell',
      'tendier\\p{L}*',
    ],
    weak: [
      'kann',
      'können',
      'möglich\\p{L}*',
      'potenziell\\p{L}*',
      'wohl',
      'fast',
      'nahezu',
      'anscheinend',
      'offenbar',
      'denkbar',
      // "dürfte … zurückzuführen sein" comes back as "mag … liegen".
      'mag',
      'mögen',
    ],
    all: ['alle[nmrs]?', 'jede[nmrs]?', 'immer', 'stets', 'gesamte\\p{L}*', 'sämtliche\\p{L}*'],
    most: ['meist\\p{L}*', 'Mehrheit', 'überwiegend', 'größtenteils'],
    some: ['einige\\p{L}*', 'manche\\p{L}*', 'mehrere\\p{L}*', 'teilweise', 'manchmal'],
    few: ['(?<!einige )wenige\\p{L}*', 'selten', 'Minderheit'],
  }),
  fr: cues({
    ignore: [
      'non[ -]gouvernemental\\p{L}*',
      'sans but lucratif',
      'sans doute',
      'avant tout',
      'ou non',
      'non seulement',
      // "ne … que" is "only": "ne repose que sur" = "relies only on".
      "n(?:e\\s+|[’'])\\p{L}+\\s+que",
      // Also a few words on ("ne prendre en compte que Paris"), and "ne … plus que" (now only).
      "n(?:e\\s+|[’'])(?:(?!pas|jamais|rien|guère|point)\\p{L}+[\\s’']+){1,4}qu(?:e|[’']\\p{L}+)",
      "n(?:e\\s+|[’'])\\p{L}+\\s+plus\\s+qu(?:e|[’']\\p{L}+)",
      // An expletive "ne" negates nothing: "avant qu'un projet ne soit proposé", "plus
      // qu'elle ne l'est déjà".
      `(?<=(?:avant|à moins|de peur|de crainte) qu(?:e\\s|[’'])[^.;:!?]{0,80}?)ne(?=\\s)${NOT_PAS}`,
      `(?<=(?:plus|moins|davantage|mieux|autrement)\\s[^.;:!?]{0,60}?(?<!\\p{L})qu(?:e\\s|[’'])\\s*(?:\\p{L}+\\s+)?)ne(?=\\s)${NOT_PAS}`,
    ],
    // Written negation always has "ne"/"n'": "pas" alone is also a step, "rien" a trifle.
    negation: ['ne', "n[’']\\p{L}+", 'aucun\\p{L}*', 'sans', 'ni', 'non pas'],
    soft: [
      'indépend\\p{L}*',
      'exclu\\p{L}*',
      'interdit\\p{L}*',
      'déconseill\\p{L}*',
      'manqu\\p{L}*',
      'absen\\p{L}*',
      'insuffisan\\p{L}*',
      'impossibl\\p{L}*',
      'in(?:adapt|capab|exact|valide|correct)\\p{L}*',
      // "ne pas en tenir compte" comes back as "l'ignorer", "n'est pas surveillé" as "faute de".
      'ignor\\p{L}*',
      "faute d(?:e|[’']\\p{L}+)",
      "à défaut d(?:e|[’']\\p{L}+)",
      // "ne résiste pas à l'analyse" ↔ "est erronée".
      'erron\\p{L}*',
    ],
    hedge: [
      'pourraient',
      'pourrait',
      'probablement',
      'peut-être',
      'possiblement',
      'vraisemblablement',
      'éventuellement',
      'sembl\\p{L}*',
      'suggère(?:nt)?',
      'laisse(?:nt)? penser',
      'tend(?:ent)? à',
      'potentiellement',
    ],
    weak: [
      'peu(?:t|vent)',
      // "Il nous semble nécessaire" ↔ "nous estimons nécessaire".
      'estim\\p{L}*',
      'à (?:mon|notre) avis',
      'selon nous',
      'possible\\p{L}*',
      'potentiel\\p{L}*',
      'probable\\p{L}*',
      'apparemment',
      'presque',
      'quasi\\p{L}*',
    ],
    all: ['tous', 'toutes?', 'tout', 'chaque', 'toujours', 'enti(?:er|ère)s?'],
    most: ['la plupart', 'majorité', 'majoritairement'],
    some: ['certain(?:e?s)', 'quelques', 'plusieurs', 'partiellement', 'parfois'],
    few: ['peu de', 'rarement', 'minorité'],
  }),
  es: cues({
    // A non-governmental or non-profit organisation negates nothing.
    ignore: [
      'sobre todo',
      'o no',
      'no s[oó]lo',
      'no gubernamental\\p{L}*',
      'sin (?:fines|ánimo) de lucro',
      // "However", "no doubt": nothing negated.
      'sin embargo',
      'sin duda',
      // "No obstante" is "nevertheless".
      'no obstante',
    ],
    negation: [
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
    ],
    soft: [
      'exclu\\p{L}*',
      // "no se conoce" (is not known) ↔ "se desconoce" (is unknown).
      'desconoc\\p{L}*',
      'prohibid\\p{L}*',
      'falta\\p{L}*',
      'ausen\\p{L}*',
      'insuficient\\p{L}*',
      'imposibl\\p{L}*',
      'inadecuad\\p{L}*',
    ],
    hedge: [
      'podrían?',
      'posiblemente',
      'probablemente',
      'quizás?',
      'tal vez',
      'parec\\p{L}*',
      'sugier\\p{L}*',
      'potencialmente',
      'tiende[n]? a',
    ],
    weak: [
      'pued\\p{L}*',
      'posible\\p{L}*',
      'potencial\\p{L}*',
      'probable\\p{L}*',
      'aparentemente',
      'casi',
    ],
    all: ['tod[oa]s?', 'cada', 'siempre', 'enter[oa]s?'],
    most: ['la mayoría', 'mayoritariamente', 'mayormente'],
    some: ['algun[oa]s', 'algún', 'varios', 'varias', 'parcialmente', 'a veces'],
    few: ['poc[oa]s', 'raramente', 'rara vez', 'minoría'],
  }),
  it: cues({
    ignore: [
      'o meno',
      'non solo',
      'non[ -]governativ\\p{L}*',
      'non[ -]profit',
      'senza scopo di lucro',
      'senza dubbio',
      // "non ultimo" is "not least"; "istituzionali e non" is "institutional and others".
      'non ultim\\p{L}*',
      '(?<=\\p{L}\\s)e non(?=\\s*[–—,;)])',
    ],
    negation: ['non', 'mai', 'nessun\\p{L}*', 'niente', 'nulla', 'senza', 'né'],
    soft: [
      'esclu\\p{L}*',
      'vietat\\p{L}*',
      'mancan\\p{L}*',
      'assen\\p{L}*',
      'inadeguat\\p{L}*',
      'insufficient\\p{L}*',
      'impossibil\\p{L}*',
      'incapac\\p{L}*',
    ],
    hedge: [
      'potrebbe(?:ro)?',
      'possibilmente',
      'probabilmente',
      'forse',
      'sembr\\p{L}*',
      'suggerisc\\p{L}*',
      'potenzialmente',
      'tend(?:e|ono) a',
    ],
    weak: [
      'può',
      'possono',
      'possibil\\p{L}*',
      'potenzial\\p{L}*',
      'probabil\\p{L}*',
      'apparentemente',
      'quasi',
    ],
    all: ['tutt[ioae]', 'ogni', 'sempre', 'inter[oa]'],
    most: ['la maggior parte', 'maggioranza', 'perlopiù', 'prevalentemente'],
    some: ['alcun[ie]', 'diversi', 'diverse', 'parzialmente', 'talvolta', 'a volte'],
    few: ['poch[ie]', 'raramente', 'minoranza'],
  }),
  pt: cues({
    ignore: [
      'acima de tudo',
      'ou não',
      'não só',
      'não apenas',
      'não[ -]governamenta\\p{L}*',
      'sem fins lucrativos',
      'sem dúvida',
      // "Não obstante" is "nevertheless", "sem prejuízo" "without affecting", "enquanto não"
      // "until", "s/n" an address without a house number.
      'não obstante',
      'sem prejuízo',
      'enquanto não',
      's/(?:n|não)',
    ],
    negation: ['não', 'nunca', 'nenhum\\p{L}*', 'nada', 'ninguém', 'sem', 'nem', 'jamais'],
    soft: [
      'exclu\\p{L}*',
      'proibid\\p{L}*',
      'falta\\p{L}*',
      'ausên\\p{L}*',
      'insuficient\\p{L}*',
      'impossív\\p{L}*',
      'inadequad\\p{L}*',
      // "meses sem educação formal" ↔ "meses de privação da educação formal".
      'privaç(?:ão|ões)',
    ],
    hedge: [
      'poderi(?:a|am)',
      'possivelmente',
      'provavelmente',
      'talvez',
      'parec\\p{L}*',
      'suger\\p{L}*',
      'potencialmente',
      'tende[m]? a',
    ],
    weak: [
      'pode[m]?',
      'possíve(?:l|is)',
      'potencia\\p{L}*',
      'prováve\\p{L}*',
      'aparentemente',
      'quase',
    ],
    all: ['tod[oa]s?', 'cada', 'sempre', 'inteir[oa]s?'],
    most: ['a maioria', 'maioria', 'majoritariamente'],
    some: ['algu(?:ns|mas)', 'vários', 'várias', 'parcialmente', 'às vezes'],
    few: ['pouc[oa]s', 'raramente', 'minoria'],
  }),
  nl: cues({
    ignore: [
      'al dan niet',
      'of niet',
      'niet alleen',
      // "niet zomaar … maar" is "not only … but"; "niet meer dan één uur" is "at most an hour".
      'niet (?:enkel|slechts|zomaar)(?=[^.;]*maar)',
      'niet (?:meer|minder|langer|vaker) dan',
    ],
    negation: ['niet(?!-)', 'niét', 'g[eé][eé]n', 'nooit', 'niets', 'niemand', 'zonder', 'noch'],
    soft: [
      'uitgesloten',
      'uitsluit\\p{L}*',
      'niet-\\p{L}+',
      'on(?!der|t|ze|s|geveer)\\p{L}{4,}',
      'ontbre\\p{L}*',
      'gebrek\\p{L}*',
      'onmogelijk\\p{L}*',
      'onvoldoende',
      'ongeschikt\\p{L}*',
      // "het is af te raden" (inadvisable) ↔ "het is niet aan te raden".
      'af te raden',
      'afgeraden',
      'ontraden',
    ],
    hedge: [
      'mogelijk',
      'waarschijnlijk',
      'misschien',
      'wellicht',
      'vermoedelijk',
      'lijk(?:t|en)',
      'zou(?:den)? kunnen',
      'suggere(?:ert|ren)',
      'potentieel',
    ],
    weak: ['kan', 'kunnen', 'mogelijk\\p{L}*', 'potentiële', 'bijna'],
    all: ['alle', 'elk\\p{L}*', 'ieder\\p{L}*', 'altijd', 'geheel'],
    most: ['meeste', 'meerderheid', 'grotendeels', 'overwegend'],
    some: ['sommige', 'enkele', 'verscheidene', 'verschillende', 'gedeeltelijk', 'soms'],
    few: ['weinig\\p{L}*', 'zelden', 'minderheid'],
  }),
  pl: cues({
    ignore: ['przede wszystkim', 'czy nie', 'nie tylko'],
    negation: ['nie', 'nigdy', 'żad(?:en|n\\p{L}*)', 'nic', 'nikt', 'bez', 'ani'],
    soft: [
      'zamiast',
      'nie(?!któr|mal|wiel|zbędn|zwykl|mniej|dawn)\\p{L}{4,}',
      'wyklucz\\p{L}*',
      'brak\\p{L}*',
      'niemożliw\\p{L}*',
      'niewystarczając\\p{L}*',
    ],
    hedge: [
      'prawdopodobnie',
      'być może',
      'wydaj[ąe] się',
      'sugeruj\\p{L}*',
      'potencjalnie',
      'mógłby',
      'mogł(?:aby|oby|yby|iby)',
    ],
    weak: [
      'sugerow\\p{L}*',
      'może',
      'mogą',
      'możliw\\p{L}*',
      'potencjaln\\p{L}*',
      'prawie',
      'niemal',
    ],
    all: ['wszyst\\p{L}*', 'każd\\p{L}*', 'zawsze', 'cał(?:y|a|e|ego|ej|kowicie)'],
    most: ['większość', 'większości', 'przeważnie', 'głównie'],
    some: ['niektór\\p{L}*', 'kilk(?:a|u)', 'częściowo', 'czasami'],
    few: ['niewiel\\p{L}*', 'rzadko', 'mniejszość'],
  }),
  cs: cues({
    ignore: ['především', 'či ne', 'nejen'],
    // Verb negation is a prefix; the common forms are listed ("ne" + any word would take
    // "nejvíce", most).
    negation: [
      'ne',
      'nikdy',
      'žádn\\p{L}*',
      'nic',
      'nikdo',
      'bez',
      'ani',
      'není',
      'nejsou',
      'neby(?:l|la|lo|ly|li)',
      'nemá(?:me|te|j[íi])?',
      'nemůže',
      'nemohou',
      'nelze',
      'neexistuje',
      'nejde',
      'nikoli(?:v)?',
    ],
    soft: [
      'ne(?!j|bo|ž)\\p{L}{4,}',
      'vylouč\\p{L}*',
      'chyb\\p{L}*',
      'nedostat\\p{L}*',
      'nemožn\\p{L}*',
      // "a ne jako Luther" ↔ "spíše než Luther".
      'spíše než',
      'místo',
    ],
    hedge: ['pravděpodobně', 'možná', 'snad', 'zřejmě', 'patrně', 'zdá se', 'mohl[aoiy]? by'],
    // "Zdá se mi" ↔ "podle mého názoru", "se domnívá" ↔ "věřil": a view, not a fact.
    weak: [
      'může',
      'mohou',
      'mož\\p{L}*',
      'potenciál\\p{L}*',
      'téměř',
      'věř\\p{L}*',
      'domnív\\p{L}*',
      'podle (?:mého|našeho|jeho|jejich) názoru',
    ],
    all: ['všechn\\p{L}*', 'všech', 'každ\\p{L}*', 'vždy'],
    most: ['většin\\p{L}*', 'převážně'],
    some: ['někter\\p{L}*', 'několik', 'částečně', 'někdy'],
    few: ['málo', 'zřídka', 'menšin\\p{L}*'],
  }),
  ro: cues({
    // "nu presupune doar … ci și" is "not only … but also".
    ignore: ['mai ales', 'sau nu', 'nu numai', 'nu doar', 'nu (?:\\p{L}+\\s+){1,2}(?:doar|numai)'],
    // "nefiind" (not being): a negated gerund.
    negation: [
      'nu',
      'nefiind',
      'niciodată',
      'niciun\\p{L}*',
      'nicio',
      'nimic',
      'nimeni',
      'fără',
      'nici',
    ],
    soft: ['exclu\\p{L}*', 'lips\\p{L}*', 'imposibil\\p{L}*', 'insuficient\\p{L}*'],
    hedge: [
      'probabil',
      'posibil',
      'poate că',
      'ar putea',
      'ar fi putut',
      'par(?:e)? să',
      'sugerează',
      'potențial',
    ],
    weak: ['poate', 'pot', 'posibil\\p{L}*', 'aproape', 'ar'],
    all: ['toț[ia]', 'toate', 'tot', 'fiecare', 'întotdeauna', 'mereu'],
    most: ['majoritatea', 'cei mai mulți', 'în mare parte'],
    some: ['unii', 'unele', 'câțiva', 'câteva', 'parțial', 'uneori'],
    few: ['puțin\\p{L}*', 'rareori', 'minoritate\\p{L}*'],
  }),
  hu: cues({
    ignore: ['mindenekelőtt', 'vagy sem', 'nemcsak', 'nem csak'],
    negation: [
      'nem',
      'nincs\\p{L}*',
      'sosem',
      'soha',
      'semmi\\p{L}*',
      'senki\\p{L}*',
      'nélkül',
      'sem',
    ],
    soft: [
      'kizár\\p{L}*',
      'nem ?paraméteres\\p{L}*',
      'hiány\\p{L}*',
      'lehetetlen\\p{L}*',
      'elégtelen\\p{L}*',
    ],
    hedge: [
      'valószínűleg',
      'talán',
      'esetleg',
      'feltehetően',
      'feltételezhetően',
      'lehetséges',
      'úgy tűnik',
      'arra utal',
    ],
    weak: ['lehet\\p{L}*', 'szinte', 'majdnem', 'potenciális\\p{L}*'],
    all: ['minden\\p{L}*', 'összes\\p{L}*', 'mindig', 'egész'],
    most: ['legtöbb\\p{L}*', 'többség\\p{L}*', 'nagyrészt', 'túlnyomó\\p{L}*'],
    some: ['néhány', 'egyes', 'bizonyos', 'részben', 'néha'],
    few: ['kevés', 'kevesen', 'ritkán', 'kisebbség\\p{L}*'],
  }),
  sv: cues({
    ignore: ['framför allt', 'eller inte', 'inte bara'],
    negation: ['inte', 'ej', 'ingen', 'inget', 'inga', 'aldrig', 'ingenting', 'utan', 'varken'],
    soft: [
      'utesl\\p{L}*',
      'brist\\p{L}*',
      'saknas',
      'sakna\\p{L}*',
      'omöjlig\\p{L}*',
      'otillräcklig\\p{L}*',
    ],
    hedge: [
      'möjligen',
      'troligen',
      'troligtvis',
      'sannolikt',
      'kanske',
      'förmodligen',
      'verkar',
      'tycks',
      'tyder på',
      'skulle kunna',
    ],
    weak: ['kan', 'kunna', 'möjlig\\p{L}*', 'potentiell\\p{L}*', 'nästan'],
    all: ['alla', 'allt', 'varje', 'alltid', 'hela'],
    most: ['de flesta', 'flesta', 'majoritet\\p{L}*', 'övervägande'],
    some: ['några', 'vissa', 'flera', 'delvis', 'ibland'],
    few: ['få', 'sällan', 'minoritet\\p{L}*'],
  }),
  ru: cyrillicNe(
    cues({
      ignore: [
        'или нет',
        'не только',
        // A bound, not a negation: "не менее 1,69" is "at least 1.69".
        'не (?:менее|более)',
        // "несколько меньше" is "somewhat less", "все еще" "still": no quantity.
        'н(?:ескольк|емног)о(?=\\s+(?:ещ[её]\\s+)?\\p{L}+(?:ее|ей|ше|же)(?![\\p{L}\\p{M}]))',
        'вс[её] ещ[её]',
      ],
      negation: ['нет', 'ни', 'никогда', 'ничего', 'никто', 'без', 'нельзя'],
      soft: [
        'не(?!котор|скольк|мног|обходим|давн)\\p{L}{4,}',
        'исключ\\p{L}*',
        'отсутств\\p{L}*',
        'недостат\\p{L}*',
        'невозможн\\p{L}*',
        'неспособн\\p{L}*',
        'вместо',
        'отлича\\p{L}*',
        'вне',
      ],
      hedge: [
        'возможно',
        'вероятно',
        'по-видимому',
        'видимо',
        'предположительно',
        'может быть',
        'по всей видимости',
        'кажется',
        'позволя\\p{L}* предположить',
        'потенциально',
      ],
      weak: [
        'мож\\p{L}*',
        'мог\\p{L}*',
        'возможн\\p{L}*',
        'вероятн\\p{L}*',
        'потенциальн\\p{L}*',
        'почти',
      ],
      all: [
        'все',
        'всех',
        'всем',
        'всеми',
        'весь',
        'вся',
        'всё',
        'кажд\\p{L}*',
        'всегда',
        'целиком',
      ],
      most: ['большинств\\p{L}*', 'в основном', 'преимущественно'],
      some: ['некотор\\p{L}*', 'нескольк\\p{L}*', 'частично', 'иногда'],
      few: ['немног\\p{L}*', 'мало', 'редко', 'меньшинств\\p{L}*'],
    }),
  ),
  uk: cyrillicNe(
    cues({
      ignore: ['чи ні', 'не тільки', 'не лише', 'не (?:менше|більше)'],
      negation: ['немає', 'ні', 'ніколи', 'нічого', 'ніхто', 'без'],
      soft: [
        'не(?!обхідн|давн|зважаюч)\\p{L}{4,}',
        'виключ\\p{L}*',
        'відсутн\\p{L}*',
        'недостат\\p{L}*',
        'неможлив\\p{L}*',
        'замість',
        // "не схожий" ↔ "відрізняється" (differs), "не за фахом" ↔ "поза фахом".
        'відрізня\\p{L}*',
        'поза',
      ],
      hedge: [
        'можливо',
        'ймовірно',
        'імовірно',
        'мабуть',
        'напевно',
        'здається',
        'потенційно',
        'може бути',
      ],
      weak: ['мож\\p{L}*', 'ймовірн\\p{L}*', 'імовірн\\p{L}*', 'потенційн\\p{L}*', 'майже'],
      all: ['всі', 'усі', 'всіх', 'усіх', 'весь', 'вся', 'все', 'кожн\\p{L}*', 'завжди'],
      most: ['більшість', 'більшості', 'переважно', 'здебільшого'],
      some: ['деяк\\p{L}*', 'кілька', 'декілька', 'частково', 'іноді', 'інколи'],
      few: ['небагат\\p{L}*', 'мало', 'рідко', 'меншість'],
    }),
  ),
  bg: cyrillicNe(
    cues({
      ignore: ['преди всичко', 'или не', 'не само'],
      negation: ['ням\\p{L}*', 'нито', 'никога', 'нищо', 'никой', 'без'],
      soft: [
        'не(?!обходим|давн)\\p{L}{4,}',
        'изключ\\p{L}*',
        'липс\\p{L}*',
        'недостат\\p{L}*',
        'невъзможн\\p{L}*',
        'вместо',
      ],
      hedge: ['вероятно', 'възможно', 'може би', 'навярно', 'изглежда', 'потенциално'],
      weak: ['може', 'могат', 'мож\\p{L}*', 'възможн\\p{L}*', 'почти'],
      all: ['всички', 'всичк\\p{L}*', 'всеки', 'всяка', 'всяко', 'винаги'],
      most: ['повечето', 'мнозинство\\p{L}*', 'предимно'],
      some: ['някои', 'няколко', 'частично', 'понякога'],
      few: ['малко', 'рядко', 'малцинство\\p{L}*'],
    }),
  ),
  el: cues({
    ignore: ['ή όχι', 'όχι μόνο'],
    negation: [
      'δεν',
      'μην',
      'μη',
      'ποτέ',
      'κανένα\\p{L}*',
      'καμία',
      'κανείς',
      'τίποτα',
      'χωρίς',
      'ούτε',
    ],
    soft: [
      'αποκλε\\p{L}*',
      'εξαιρ\\p{L}*',
      'έλλειψη',
      'απουσία',
      'αδύνατ\\p{L}*',
      'ανεπαρκ\\p{L}*',
    ],
    hedge: [
      'πιθανώς',
      'πιθανόν',
      'ίσως',
      'ενδεχομένως',
      'φαίν(?:εται|ονται)',
      'θα μπορούσ(?:ε|αν)',
      'δυνητικά',
    ],
    weak: ['μπορ\\p{L}*', 'πιθαν\\p{L}*', 'δυνητικ\\p{L}*', 'σχεδόν'],
    all: ['όλ\\p{L}*', 'κάθε', 'πάντα', 'πάντοτε'],
    most: ['οι περισσότερ\\p{L}*', 'πλειονότητα', 'κυρίως'],
    some: ['ορισμέν\\p{L}*', 'μερικ\\p{L}*', 'κάποι\\p{L}*'],
    few: ['λίγ\\p{L}*', 'σπάνια', 'μειοψηφία'],
  }),
};

/**
 * "Не менш важливими" (no less important) came back as "en az önemli" (least important): the
 * negation of a comparative reverses it when lost, and is kept when it comes back as "at least
 * as" or "equally", which have no negation.
 */
const LITOTES: Record<string, [noLess: string, asMuch: string]> = {
  en: ['no less|not less', 'no less|not less|at least as|equally|just as'],
  uk: ['не менш\\p{L}*', 'не менш\\p{L}*|так(?:ий|а|е|і|ою|ими) ж|рівною мірою'],
  ru: [
    'не менее|не меньш\\p{L}*',
    'не менее|не меньш\\p{L}*|так(?:ой|ая|ое|ие|ими) же|в равной (?:мере|степени)',
  ],
  de: ['nicht weniger', 'nicht weniger|mindestens (?:genauso|ebenso)|genauso|ebenso|gleichermaßen'],
  fr: ['(?:non|pas) moins', '(?:non|pas) moins|au moins aussi|tout aussi|également'],
  es: ['no menos', 'no menos|al menos tan|igualmente|igual de'],
  it: ['non meno', 'non meno|almeno altrettanto|altrettanto|ugualmente'],
  pt: ['não menos', 'não menos|pelo menos tão|igualmente|tão … quanto'],
  tr: [
    '',
    'en az (?:\\p{L}+ )?kadar|bir o kadar|aynı (?:derecede|ölçüde)|eşit (?:derecede|ölçüde)',
  ],
};
for (const [lang, [noLess, asMuch]] of Object.entries(LITOTES)) {
  const c = CUES[lang];
  if (!c) continue;
  if (noLess) c.noLess = words([noLess]);
  c.asMuch = words([asMuch]);
}

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
  return (
    tokenize(tagged)
      .map((t) => (t.type === 'text' ? t.text : t.type === 'ph' ? ph(t.id) : ''))
      .join('')
      // A soft hyphen kept from a line break splits words ("nie\u00ad dokrwienia" is one word).
      .replace(/\u00ad\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

interface Difference {
  issue: string;
  severity: 'minor' | 'major';
  /** The back-translated sentence the difference was found in (long paragraphs). */
  sentence?: string;
}

/**
 * Cue differences between one source passage and its back-translation. `own` reads the source
 * when it is written in another language than the paper (an English quotation in a French one).
 */
function differences(
  sourceText: string,
  backText: string,
  cues: Cues,
  own: Cues = cues,
): Difference[] {
  const out: Difference[] = [];
  const clean = (t: string, c: Cues) => (c.ignore ? t.replace(c.ignore, ' ') : t);
  let source = clean(sourceText, own);
  let back = clean(backText, cues);
  // "No less" must come back as "no less" or "at least as"; then neither side is a negation.
  const noLess = !!own.noLess && has(own.noLess, source);
  const lostNoLess = noLess && !(cues.asMuch && has(cues.asMuch, back));
  if (own.noLess) source = source.replace(own.noLess, ' ');
  if (cues.asMuch) back = back.replace(cues.asMuch, ' ');
  if (lostNoLess) out.push({ issue: 'negation lost', severity: 'major' });
  const negSource = has(own.negation, source);
  const negBack = has(cues.negation, back);
  const soft =
    (!!own.softNegation && has(own.softNegation, source)) ||
    (!!cues.softNegation && has(cues.softNegation, back));
  if (negSource && !negBack && !soft && !lostNoLess)
    out.push({ issue: 'negation lost', severity: 'major' });
  if (!negSource && negBack && !soft) out.push({ issue: 'negation added', severity: 'major' });
  // Only a hedge that disappears is reported: one the back-translation adds is nearly always
  // paraphrase ("would have been unattainable" → "could not have been achieved").
  if (own.hedge && cues.weakHedge && has(own.hedge, source) && !has(cues.weakHedge, back))
    out.push({
      issue: 'hedging lost: the claim may read stronger than in the source',
      severity: 'major',
    });
  if (cues.quantifiers) {
    const classes = Object.entries(cues.quantifiers).map(
      ([k, re]) => [k, own.quantifiers?.[k] ?? re, re] as const,
    );
    const lost = classes.filter(([, s, b]) => has(s, source) && !has(b, back)).map(([k]) => k);
    const added = classes.filter(([, s, b]) => !has(s, source) && has(b, back)).map(([k]) => k);
    if (lost.length && added.length)
      out.push({
        issue: `quantifier changed: ${lost.join(', ')} → ${added.join(', ')}`,
        severity: 'major',
      });
  }
  return out;
}

/**
 * The language a passage is written in when it is clearly not the paper's (a quotation), read
 * from its function words; otherwise the paper's.
 */
function writtenIn(text: string, lang: string): string {
  const own = languageScore(text, lang);
  let best = lang;
  let score = 0;
  for (const l of Object.keys(CUES)) {
    const s = l === lang ? 0 : languageScore(text, l);
    if (s > score) [best, score] = [l, s];
  }
  return score >= 3 && score > 3 * own ? best : lang;
}

/** Stems of the longer words and the numbers of a sentence. */
function anchors(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/\p{N}/u.test(w)) out.add(w);
    else if (w.length >= 5) out.add(w.slice(0, 5));
  }
  return out;
}

/**
 * Two sentences about the same thing share a good part of their long words and numbers;
 * sentence pairs that do not were split differently and are not compared pairwise.
 */
function overlapping(a: string, b: string): boolean {
  const x = anchors(a);
  const y = anchors(b);
  if (x.size < 2 || y.size < 2) return true;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.3;
}

/**
 * Meaning differences between a source text and the back-translation of its translation.
 * Back-translation usually keeps the sentence count; then sentences are compared pairwise and
 * each finding names its sentence. Otherwise the whole passage is compared, which in a long
 * paragraph only reports a cue class that is missing everywhere on one side.
 */
export function compareMeaning(
  source: string,
  back: string,
  lang: string,
  /** The back-translation's language when it is not the source's (a second opinion in English). */
  backLang = lang,
): Difference[] {
  const cues = CUES[backLang];
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
      return r > 0.5 && r < 2 && overlapping(t, backSentences[i]!);
    });
  const own = CUES[writtenIn(source, lang)] ?? CUES[lang] ?? cues;
  if (!aligned) return differences(source, back, cues, own);
  const seen = new Set<string>();
  return sourceSentences.flatMap((sentence, i) =>
    differences(sentence, backSentences[i]!, cues, own)
      .filter((d) => !seen.has(d.issue) && seen.add(d.issue))
      .map((d) => ({ ...d, sentence: backSentences[i]!.trim() })),
  );
}

/** The back-translation came back in the source language (the translator did its work). */
export function inSourceLanguage(text: string, lang: string, targetLang: string): boolean {
  return functionWords(text, lang) >= functionWords(text, targetLang);
}

/** Findings for translated pairs, given the back-translation of each target. */
export function backTranslationFindings(
  pairs: FidelityPair[],
  back: string[],
  lang: string,
  targetLang: string,
): FidelityFinding[] {
  // A back-translation the translator left in the target language says nothing.
  const inSource = (t: string) => inSourceLanguage(t, lang, targetLang);
  return pairs.flatMap((p, i) => {
    const source = cueText(p.source, p.verbatim);
    // A passage of the source already in the target language (an English abstract in a Dutch
    // paper, a download stamp) was not translated from the source language.
    const comparable = inSource(back[i] ?? '') && inSource(source);
    return (comparable ? compareMeaning(source, back[i] ?? '', lang) : []).map((f) => ({
      id: p.id,
      issue: f.issue,
      severity: f.severity,
      backTranslation: f.sentence ?? back[i]!,
    }));
  });
}
