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

type Langs = Partial<Record<string, string>>;
/**
 * Structured-abstract and section headings that machine translation renders out of context
 * ("Background" → "Geçmiş", "Results" and "Conclusions" both → "Sonuçlar").
 */
const TERMS: Langs[] = [
  ABSTRACT,
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
  {
    en: 'Keywords',
    tr: 'Anahtar kelimeler',
    de: 'Schlüsselwörter',
    fr: 'Mots-clés',
    es: 'Palabras clave',
    it: 'Parole chiave',
    pt: 'Palavras-chave',
    ru: 'Ключевые слова',
  },
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
const METRICS: Langs[] = [RECALL, PRECISION];

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
): string | null {
  const word = text.trim().replace(/[.:]$/u, '');
  const key = (w: string, lang: string) => w.replace(/\s+/gu, '').toLocaleLowerCase(lang);
  for (const t of metrics ? [...TERMS, ...METRICS] : TERMS) {
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
 * A unit in brackets may follow the term ("Recall (%)").
 */
export function academicHeading(
  tagged: string,
  source: string,
  target: string,
  metrics = false,
): string | null {
  const tokens = tokenize(tagged);
  const texts = tokens.filter((t) => t.type === 'text' && t.text.trim());
  if (texts.length !== 1) return null;
  const m = /^(\s*)(\p{L}[\p{L} ]*?)(\s*(?:\([^()\p{L}]{1,6}\))?\s*[:.]?\s*)$/u.exec(
    (texts[0] as { text: string }).text,
  );
  if (!m) return null;
  const term = academicTerm(m[2]!, source, target, metrics);
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
