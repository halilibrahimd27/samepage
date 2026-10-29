import { tokenize } from '../segment/codec';
import type { GlossaryEntry } from '../validate/validate';

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

const KEYWORDS: Record<string, string> = {
  en: 'Keywords',
  tr: 'Anahtar kelimeler',
  de: 'Schlüsselwörter',
  fr: 'Mots-clés',
  es: 'Palabras clave',
  it: 'Parole chiave',
  pt: 'Palavras-chave',
  nl: 'Trefwoorden',
  pl: 'Słowa kluczowe',
  cs: 'Klíčová slova',
  ro: 'Cuvinte cheie',
  hu: 'Kulcsszavak',
  sv: 'Nyckelord',
  ru: 'Ключевые слова',
  uk: 'Ключові слова',
  bg: 'Ключови думи',
  el: 'Λέξεις-κλειδιά',
};

/** "Abstract" and "Keywords" as journals write them in `lang`. */
export const paperLabels = (lang: string) => ({
  abstract: ABSTRACT[lang] ?? ABSTRACT.en!,
  keywords: KEYWORDS[lang] ?? KEYWORDS.en!,
});

type Langs = Partial<Record<string, string>>;
/**
 * Structured-abstract and section headings that machine translation renders out of context
 * ("Background" → "Geçmiş", "Results" and "Conclusions" both → "Sonuçlar").
 */
const TERMS: Langs[] = [
  ABSTRACT,
  // DergiPark papers head their Turkish abstract "Öz" ("self" to an engine); OCR may drop the dots.
  { ...ABSTRACT, tr: 'Öz' },
  { ...ABSTRACT, tr: 'Oz' },
  {
    en: 'Background',
    tr: 'Arka plan',
    de: 'Hintergrund',
    fr: 'Contexte',
    es: 'Antecedentes',
    it: 'Contesto',
    pt: 'Contexto',
    ru: 'Предпосылки',
  },
  {
    en: 'Aims',
    tr: 'Amaçlar',
    de: 'Ziele',
    fr: 'Objectifs',
    es: 'Objetivos',
    it: 'Obiettivi',
    pt: 'Objetivos',
    ru: 'Цели',
  },
  {
    en: 'Objectives',
    tr: 'Amaçlar',
    de: 'Ziele',
    fr: 'Objectifs',
    es: 'Objetivos',
    it: 'Obiettivi',
    pt: 'Objetivos',
    ru: 'Цели',
  },
  {
    en: 'Objective',
    tr: 'Amaç',
    de: 'Ziel',
    fr: 'Objectif',
    es: 'Objetivo',
    it: 'Obiettivo',
    pt: 'Objetivo',
    ru: 'Цель',
  },
  {
    en: 'Method',
    tr: 'Yöntem',
    de: 'Methode',
    fr: 'Méthode',
    es: 'Método',
    it: 'Metodo',
    pt: 'Método',
    ru: 'Метод',
  },
  {
    en: 'Methods',
    tr: 'Yöntemler',
    de: 'Methoden',
    fr: 'Méthodes',
    es: 'Métodos',
    it: 'Metodi',
    pt: 'Métodos',
    ru: 'Методы',
  },
  {
    en: 'Results',
    tr: 'Bulgular',
    de: 'Ergebnisse',
    fr: 'Résultats',
    es: 'Resultados',
    it: 'Risultati',
    pt: 'Resultados',
    ru: 'Результаты',
  },
  {
    en: 'Conclusion',
    tr: 'Sonuç',
    de: 'Fazit',
    fr: 'Conclusion',
    es: 'Conclusión',
    it: 'Conclusione',
    pt: 'Conclusão',
    ru: 'Заключение',
  },
  {
    en: 'Conclusions',
    tr: 'Sonuçlar',
    de: 'Schlussfolgerungen',
    fr: 'Conclusions',
    es: 'Conclusiones',
    it: 'Conclusioni',
    pt: 'Conclusões',
    ru: 'Выводы',
  },
  {
    en: 'Article info',
    tr: 'Makale bilgisi',
    de: 'Artikelinformationen',
    fr: 'Informations sur l’article',
    es: 'Información del artículo',
    it: 'Informazioni sull’articolo',
    pt: 'Informações do artigo',
    ru: 'Информация о статье',
  },
  KEYWORDS,
  {
    // The running-number column of Slavic tables ("№ з/п" became "No. of the company").
    en: 'No.',
    tr: 'Sıra No.',
    de: 'Nr.',
    fr: 'N°',
    es: 'N.º',
    it: 'N.',
    pt: 'N.º',
    ru: '№ п/п',
    uk: '№ з/п',
    bg: '№ по ред',
  },
  {
    // A table's column group ("Overall" | "Per-class") became "Etraflı" (detailed).
    en: 'Overall',
    tr: 'Genel',
    de: 'Gesamt',
    fr: 'Global',
    es: 'Global',
    it: 'Complessivo',
    pt: 'Geral',
    ru: 'В целом',
  },
];

const REFERENCES: Langs = {
  en: 'References',
  tr: 'Kaynaklar',
  de: 'Literatur',
  fr: 'Références',
  es: 'Referencias',
  it: 'Bibliografia',
  pt: 'Referências',
  ru: 'Список литературы',
};
const ACKNOWLEDGEMENTS: Langs = {
  en: 'Acknowledgements',
  tr: 'Teşekkür',
  de: 'Danksagung',
  fr: 'Remerciements',
  es: 'Agradecimientos',
  it: 'Ringraziamenti',
  pt: 'Agradecimentos',
  ru: 'Благодарности',
};

/**
 * Section names that are everyday words elsewhere ("Giriş" is also an entrance or an input):
 * only applied to headings ("Giriş" → "Entrance" as a section title).
 */
const SECTION_TERMS: Langs[] = [
  {
    en: 'Introduction',
    tr: 'Giriş',
    de: 'Einleitung',
    fr: 'Introduction',
    es: 'Introducción',
    it: 'Introduzione',
    pt: 'Introdução',
    ru: 'Введение',
  },
  {
    en: 'Discussion',
    tr: 'Tartışma',
    de: 'Diskussion',
    fr: 'Discussion',
    es: 'Discusión',
    it: 'Discussione',
    pt: 'Discussão',
    ru: 'Обсуждение',
  },
  {
    en: 'Related Work',
    tr: 'İlgili Çalışmalar',
    de: 'Verwandte Arbeiten',
    fr: 'Travaux connexes',
    es: 'Trabajos relacionados',
    it: 'Lavori correlati',
    pt: 'Trabalhos relacionados',
    ru: 'Связанные работы',
  },
  {
    en: 'Literature Review',
    tr: 'Literatür Taraması',
    de: 'Literaturüberblick',
    fr: 'Revue de la littérature',
    es: 'Revisión de la literatura',
    it: 'Rassegna della letteratura',
    pt: 'Revisão da literatura',
    ru: 'Обзор литературы',
  },
  {
    en: 'Limitations',
    tr: 'Sınırlılıklar',
    de: 'Einschränkungen',
    fr: 'Limites',
    es: 'Limitaciones',
    it: 'Limitazioni',
    pt: 'Limitações',
    ru: 'Ограничения',
  },
  {
    en: 'Appendix',
    tr: 'Ek',
    de: 'Anhang',
    fr: 'Annexe',
    es: 'Apéndice',
    it: 'Appendice',
    pt: 'Apêndice',
    ru: 'Приложение',
  },
  REFERENCES,
  { ...REFERENCES, tr: 'Kaynakça' },
  ACKNOWLEDGEMENTS,
  { ...ACKNOWLEDGEMENTS, en: 'Acknowledgments' },
];

/**
 * Evaluation metrics that machine translation reads in their everyday sense when a table cell
 * holds the word alone ("Recall" → "Hatırlamak" instead of "Duyarlılık"). Only used when the
 * document names both metrics (see usesMetrics), so a psychology paper's "Recall" stays memory.
 */
const RECALL: Langs = {
  en: 'Recall',
  tr: 'Duyarlılık',
  de: 'Recall',
  fr: 'Rappel',
  es: 'Exhaustividad',
  it: 'Recall',
  pt: 'Revocação',
  ru: 'Полнота',
};
const PRECISION: Langs = {
  en: 'Precision',
  tr: 'Kesinlik',
  de: 'Präzision',
  fr: 'Précision',
  es: 'Precisión',
  it: 'Precisione',
  pt: 'Precisão',
  ru: 'Точность',
};
/** "F1-score" alone became "F1-Gol" (a football goal). */
const F1_SCORE: Langs = {
  en: 'F1-score',
  tr: 'F1 skoru',
  de: 'F1-Score',
  fr: 'score F1',
  es: 'puntuación F1',
  it: 'punteggio F1',
  pt: 'pontuação F1',
  ru: 'F1-мера',
};
const METRICS: Langs[] = [RECALL, PRECISION];
/** Terms looked up in metric documents (cells) and kept consistent in sentences (glossary). */
const METRIC_TERMS: Langs[] = [
  RECALL,
  PRECISION,
  F1_SCORE,
  { ...F1_SCORE, en: 'F1 score' },
  { ...F1_SCORE, en: 'F1-measure' },
];

/**
 * The metric terms as glossary entries, so that a sentence ("under precision (P), recall (R),
 * and F1 score") uses the same words as the table headers. Lower case, except German nouns
 * and "F1".
 */
export function metricGlossary(source: string, target: string): GlossaryEntry[] {
  return METRIC_TERMS.flatMap((t) => {
    const from = t[source];
    const to = t[target];
    if (!from || !to) return [];
    // "Kesinlik" → "kesinlik", but "F1 skoru" keeps its capital.
    const lower = target !== 'de' && /^\p{Lu}\p{Ll}+(?:\s|$)/u.test(to);
    return [
      { source: from, target: lower ? to.charAt(0).toLocaleLowerCase(target) + to.slice(1) : to },
    ];
  });
}

/** True when the document names both precision and recall in the source language. */
export function usesMetrics(texts: string[], source: string): boolean {
  const named = (t: Langs) => {
    const word = t[source]?.toLocaleLowerCase(source);
    return !!word && texts.some((x) => x.toLocaleLowerCase(source).includes(word));
  };
  return METRICS.every(named);
}

/**
 * A known heading term in the target language (letter case as in the source), or null. The
 * text must be the term alone, optionally followed by "." or ":" (kept by the caller). Letter-
 * spaced headings ("A B S T R A C T", "A R T I C L E  I N F O") match without their spaces.
 */
export function academicTerm(
  text: string,
  source: string,
  target: string,
  metrics = false,
  heading = false,
): string | null {
  const word = text.trim().replace(/[.:]$/u, '');
  const key = (w: string, lang: string) => w.replace(/\s+/gu, '').toLocaleLowerCase(lang);
  const terms = [...TERMS, ...(metrics ? METRIC_TERMS : []), ...(heading ? SECTION_TERMS : [])];
  for (const t of terms) {
    const from = t[source];
    const to = t[target];
    if (!from || !to || key(word, source) !== key(from, source)) continue;
    return word === word.toLocaleUpperCase(source) && /\p{L}{2}/u.test(word.replace(/\s+/gu, ''))
      ? to.toLocaleUpperCase(target)
      : to;
  }
  return null;
}

/**
 * The translated heading (any term above) with the source's markup and letter case, or null.
 * A unit in brackets may follow the term ("Recall (%)"); a section heading may be numbered
 * ("1 INTRODUCTION", "2.1. Related Work").
 */
export function academicHeading(
  tagged: string,
  source: string,
  target: string,
  metrics = false,
  heading = false,
): string | null {
  const tokens = tokenize(tagged);
  const texts = tokens.filter((t) => t.type === 'text' && t.text.trim());
  if (texts.length !== 1) return null;
  const number = heading ? String.raw`(?:\d{1,2}(?:\.\d{1,2})*\.?\s+)?` : '';
  const m = new RegExp(
    String.raw`^(\s*${number})([\p{L}№][\p{L}\d /-]*?)(\s*(?:\([^()\p{L}]{1,6}\))?\s*[:.]?\s*)$`,
    'u',
  ).exec((texts[0] as { text: string }).text);
  if (!m) return null;
  const term = academicTerm(m[2]!, source, target, metrics, heading);
  if (!term) return null;
  return tokens
    .map((t) => {
      if (t === texts[0]) return m[1]! + term + m[3]!;
      if (t.type === 'text') return t.text;
      if (t.type === 'ph') return `⟦${t.id}⟧`;
      return t.type === 'open' ? `<${t.id}>` : `</${t.id}>`;
    })
    .join('');
}

const NAME_WORD =
  /^(?:\p{Lu}[\p{L}'’-]*\.?|\p{Lu}\.(?:-?\p{Lu}\.)*|de|da|do|dos|van|von|der|den|del|della|di|du|la|le|bin|ibn|al|el|y)$/u;
const JOINER =
  /\s*(?:[,;&]|(?<![\p{L}\p{N}])(?:and|ve|und|et|y|e|i|и|і|та|και)(?![\p{L}\p{N}]))\s*/u;

/**
 * An author line ("Haya Samaana, Diego Elias Costa, Emad Shihab and Ahmad Abdellatif"): two or
 * more names of two to five capitalised words. Nothing to translate, and engines drop the commas
 * next to the affiliation marks. A list of single terms ("Precision, Recall") is not one.
 */
export function isNameList(text: string): boolean {
  const parts = text
    .split(JOINER)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((p) => {
    const words = p.split(/\s+/);
    return words.length >= 2 && words.length <= 5 && words.every((w) => NAME_WORD.test(w));
  });
}

/** Words of Title Case headings that are not names ("Related Work", "Materials And Methods"). */
const HEADING_WORD =
  /^(?:and|work|works|review|methods?|materials?|results?|discussion|background|analysis|study|conclusions?|theory|models?|data|related|literature|problem|statement|overview|preliminaries|motivation|approach|design|experiments?|evaluation|summary|notation|definitions?)$/iu;

/** One person's name ("Doreen Müller", "Dominik Graf von Stillfried"). */
export function isPersonName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((w) => NAME_WORD.test(w) && !HEADING_WORD.test(w.replace(/\.$/, '')))
  );
}
