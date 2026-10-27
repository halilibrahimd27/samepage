import { detectLanguage, languageScore } from './detectLanguage';
import { isNameList, isPersonName } from './glossary/academic';
import type { Role } from './ir/types';
import { LANGUAGES } from './languages';
import { REFERENCES_HEADING } from './references';

/**
 * Title, abstract and keywords of a paper, for the "abstract only" mode: journals ask for the
 * abstract in a second language (DergiPark: Turkish and English), and translating these parts
 * alone is quicker and easier to review than the whole document.
 *
 * Papers label their abstract in many ways ("Abstract", "ÖZ", "Abstract—…", "РЕЗЮМЕ", a bold
 * run before the text) or not at all. Without a label, the paragraphs right before the keywords
 * line, or before the introduction, are taken. The UI shows what was found in editable fields.
 */

/** One paragraph of the document in reading order. */
export interface DocParagraph {
  text: string;
  role: Role;
  /** Main font size in points (PDF only). */
  size?: number;
  /** 0-based page (PDF only). */
  page?: number;
  /** The paragraph's lines (PDF only): keyword lists are often one keyword per line. */
  lines?: string[];
}

export interface PaperParts {
  title: string;
  abstract: string[];
  /** The keyword list without its label ("Keywords:"). */
  keywords: string;
  /** Language of the abstract, when it could be detected. */
  lang?: string;
  /** Languages of the document's other abstracts (a Turkish paper's English abstract). */
  otherAbstracts: string[];
}

const ABSTRACT_WORDS = [
  'abstract',
  'summary',
  'özet',
  'öz',
  'zusammenfassung',
  'kurzfassung',
  'abstrakt',
  'résumé',
  'resumen',
  'riassunto',
  'sommario',
  'sintesi',
  'resumo',
  'samenvatting',
  'streszczenie',
  'souhrn',
  'rezumat',
  'absztrakt',
  'összefoglaló',
  'összefoglalás',
  'kivonat',
  'sammanfattning',
  'аннотация',
  'резюме',
  'реферат',
  'анотація',
  'абстракт',
  'περ[ιί]ληψη',
].join('|');
const ABSTRACT_PREFIX = '(?:english|extended|genişletilmiş|erweiterte)\\s+';

const KEYWORD_WORDS = [
  'key\\s*-?\\s*words?',
  'index terms',
  'anahtar (?:kelime|sözcük)ler',
  'anahtar kavramlar',
  'schlüssel(?:wörter|begriffe)',
  'schlagwörter',
  'stichwörter',
  'mots[ -]clés?',
  'palabras[ -]claves?',
  'descriptores',
  'parole[ -]chiave',
  'palavras[ -]chave',
  'descritores',
  'unitermos',
  'trefwoorden',
  'sleutelwoorden',
  'słowa kluczowe',
  'klíčová slova',
  'kľúčové slová',
  'cuvinte[ -]cheie',
  'kulcsszavak',
  'nyckelord',
  'ключевые слова',
  'ключові слова',
  'ключови думи',
  'λ[εέ]ξεις[ -]κλειδι[αά]',
  'λ[εέ]ξεις ευρετηρ[ιί]ου',
].join('|');

/** "Abstract", "ÖZET", "2. Zusammenfassung:", "English abstract" alone. */
const ABSTRACT_HEAD = new RegExp(
  `^(?:(?:\\d+|[IVX]+)[.)]?\\s+)?(?:${ABSTRACT_PREFIX})?(?:${ABSTRACT_WORDS})\\s*[:.]?$`,
  'iu',
);
/** "Abstract—We study…", "Özet: Bu çalışmada…". */
const ABSTRACT_INLINE = new RegExp(
  `^(?:${ABSTRACT_WORDS})\\s*(?:[:.—–]|-\\s)\\s*(\\S[\\s\\S]*)$`,
  'iu',
);
/** "ABSTRACT This paper…", "Abstract Background Female students…" (a bold run before the text). */
const ABSTRACT_RUN = new RegExp(`^(${ABSTRACT_WORDS})\\s+(\\p{Lu}[\\s\\S]*)$`, 'iu');
const KEYWORDS = new RegExp(`^(?:${KEYWORD_WORDS})\\s*(?:[:.—–]|-\\s)?\\s*([\\s\\S]*)$`, 'iu');
/** The first section ("1. Introduction", "Giriş", "Введение"). */
const INTRODUCTION =
  /^(?:(?:\d+(?:\.\d+)*|[IVX]+)[.)]?\s*)?(?:introduction|giriş|einleitung|einführung|introducción|introduzione|introdução|inleiding|wstęp|wprowadzenie|úvod|introducere|bevezetés|bevezető|inledning|введение|вступ|увод|εισαγωγ[ηή])(?![\p{L}\p{N}])/iu;
/** Headings inside a structured abstract ("Background", "Gereç ve Yöntem", "Результаты"). */
const STRUCTURED = new RegExp(
  `^(?:${[
    'background',
    'context',
    'aims?',
    'objectives?',
    'purpose',
    'design',
    'setting',
    'participants',
    'interventions?',
    'measurements',
    '(?:materials? and )?methods?',
    'results?',
    'findings',
    'conclusions?',
    'discussion',
    'interpretation',
    'significance',
    'amaç(?:lar)?',
    '(?:gereç ve )?yöntem(?:ler)?',
    'bulgular',
    'sonuç(?:lar)?',
    'tartışma',
    'hintergrund',
    'ziel(?:e|setzung)?',
    'fragestellung',
    'methode[n]?',
    'ergebnisse',
    'schlussfolgerung(?:en)?',
    'diskussion',
    'fazit',
    'contexte',
    'objectifs?',
    'méthodes?',
    'résultats',
    'antecedentes',
    'objetivos?',
    'métodos?',
    'resultados',
    'conclusiones',
    'conclusões',
    'obiettivi?',
    'metodi',
    'risultati',
    'conclusioni',
    'цель',
    'методы',
    'результаты',
    'заключение',
    'выводы',
    'мета',
    'методи',
    'результати',
    'висновки',
    'cel',
    'metody',
    'wyniki',
    'wnioski',
    'bakgrund',
    'syfte',
    'metod',
    'resultat',
    'slutsats(?:er)?',
    'achtergrond',
    'doel',
    'resultaten',
    'conclusie',
    'célkitűzés',
    'módszer(?:ek)?',
    'eredmények',
    'következtetés(?:ek)?',
    'cíl',
    'výsledky',
    'závěr(?:y)?',
    'obiectiv(?:e)?',
    'metode',
    'rezultate',
    'concluzii',
    'σκοπ[οό]ς',
    'μ[εέ]θοδοι',
    'αποτελ[εέ]σματα',
    'συμπερ[αά]σματα',
    'цел',
    'резултати',
    'изводи',
  ].join('|')})\\s*[:.]?$`,
  'iu',
);
/** The first label of a structured abstract without a heading ("Bakgrund/Syfte: …"). */
const OPENING = new RegExp(
  `^(?:${[
    'background',
    'context',
    'aims?',
    'objectives?',
    'purpose',
    'bakgrund',
    'syfte',
    'amaç',
    'hintergrund',
    'ziel',
    'fragestellung',
    'contexte',
    'objectifs?',
    'antecedentes',
    'objetivos?',
    'obiettivi?',
    'contesto',
    'contexto',
    'achtergrond',
    'doel',
    'cel',
    'cíl',
    'obiectiv(?:e)?',
    'célkitűzés',
    'σκοπ[οό]ς',
    'цель(?: работы)?',
    'актуальность',
    'мета',
    'актуальність',
    'цел',
  ].join('|')})(?:\\s*\\/\\s*\\p{L}+)?\\s*[:.—–]\\s*\\S`,
  'iu',
);
/** Lines around the title that are not the title. */
const FRONT_MATTER =
  /doi|https?:|www\.|issn|\bvol(?:\.|ume)|©|e-?mail|@|journal|dergisi|zeitschrift|revue|revista|rivista|university|üniversitesi|universität|université|universidad|università|department|faculty|fakültesi|correspond|sorumlu yazar|open access|article info|research (?:article|paper)|original (?:article|research|paper)|review article|araştırma makalesi|derleme|artículo original|artigo original|articolo originale|article original|originalarbeit|praca oryginalna|původní práce|удк|\budc\b|\budk\b|\b(?:received|revised|accepted|published|submitted)\b|…\s*\d+$|geliş tarihi|kabul tarihi|eingegangen|recebido|recibido|ricevuto|reçu|došlo|поступила|надійшла/iu;
/** Roles that never belong to the title or the abstract. */
const SKIP: ReadonlySet<Role> = new Set(['header', 'footer', 'page-number', 'caption', 'code']);
/** Roles an abstract's text can have besides 'body' (small type, layout tables, side boxes). */
const TEXT: ReadonlySet<Role> = new Set(['body', 'footnote', 'table-cell', 'label', 'unknown']);
const MAX_ABSTRACT_WORDS = 700;
/** Text of the abstract: body-like roles, or a long "heading" (an abstract set in bold). */
const isText = (p: DocParagraph) =>
  TEXT.has(p.role) || (p.role === 'heading' && wordCount(p.text) >= 25);
/** Font sizes closer than this are the same type. */
const SAME_SIZE = 0.6;

const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
/** Word count as journals count it (tokens with a letter or digit). */
export const wordCount = (text: string) => wordsOf(text).length;

/** Collapses a letter-spaced heading ("A B S T R A C T"). */
const unspaced = (text: string) =>
  /^(?:\p{L} ){3,}\p{L}$/u.test(text) ? text.replace(/ /g, '') : text;
/** Drops the separator left after a label on its own line ("— L’exploration…"). */
const unlead = (text: string) => text.replace(/^[\s:.—–-]+/u, '');

/** Joins a paragraph and its continuation (a line split from it by the layout). */
function join(a: string, b: string): string {
  return /\p{L}-$/u.test(a) && /^\p{Ll}/u.test(b) ? a.slice(0, -1) + b : `${a} ${b}`;
}

/** The abstract's own text when `text` is an abstract heading ('' for a heading alone). */
export function abstractStart(text: string): string | null {
  const t = text.trim();
  if (ABSTRACT_HEAD.test(unspaced(t))) return '';
  const inline = ABSTRACT_INLINE.exec(t);
  if (inline) return inline[1]!.trim();
  const run = ABSTRACT_RUN.exec(t);
  if (run && (run[1] === run[1]!.toLocaleUpperCase() || wordCount(t) >= 30)) return run[2]!.trim();
  return null;
}

/** The keyword list when the paragraph starts with a keywords label ('' for the label alone). */
export function keywordList(p: Pick<DocParagraph, 'text' | 'lines'>): string | null {
  const m = KEYWORDS.exec(p.text.trim());
  if (!m) return null;
  const rest = unlead(m[1]!.trim());
  const lines = p.lines?.map((l) => l.trim()).filter(Boolean);
  // One keyword per line, without separators: keep them apart.
  if (lines && lines.length > 1 && !/[,;·•]/.test(rest)) {
    const items = lines.map((l) => unlead(KEYWORDS.exec(l)?.[1]?.trim() ?? l)).filter(Boolean);
    return items.join('; ');
  }
  return rest;
}

function isSectionStart(p: DocParagraph): boolean {
  const t = p.text.trim();
  if (REFERENCES_HEADING.test(t)) return true;
  return INTRODUCTION.test(t) && wordCount(t) <= 8;
}

/** The keyword list at `i` with lines the layout split from it ("…, Deprem" + "güvenliği."). */
function keywordsAt(paras: DocParagraph[], i: number): string | null {
  const first = keywordList(paras[i]!);
  if (first === null) return null;
  const size = paras[i]!.size;
  const items = first ? [first] : [];
  const text = () => (items.length ? items.reduce((a, b) => join(a, b)) : '');
  for (let k = i + 1; k < Math.min(paras.length, i + 12) && !/\.$/.test(text()); k++) {
    const q = paras[k]!;
    const t = q.text.trim();
    if (SKIP.has(q.role) || !t) continue;
    if (first && q.role === 'heading') break;
    if (abstractStart(t) !== null || keywordList(q) !== null || isSectionStart(q)) break;
    if (size !== undefined && q.size !== undefined && Math.abs(q.size - size) > SAME_SIZE) break;
    const n = wordCount(t);
    if (items.length ? n > 10 || /[.!?]\s+\p{Lu}/u.test(t) : n > 40) break;
    const last = items[items.length - 1];
    if (first && last !== undefined && !/[,;]$/.test(last) && !/^\p{Ll}/u.test(t)) break;
    items.push(t);
  }
  // A label on its own line with one keyword per line ("Λέξεις ευρετηρίου" + "Καρκίνος" …).
  if (!first && items.length > 1 && !items.some((t) => /[,;]/.test(t))) return items.join('; ');
  return items.length ? text() : '';
}

interface Found {
  /** First paragraph of the abstract (its heading, if it has one). */
  head: number;
  /** Index after the abstract. */
  end: number;
  body: string[];
  lang: string | undefined;
  /** Main font size of the abstract text. */
  size: number | undefined;
}

/** The size most of the text between `from` and `to` is set in. */
function mainSize(paras: DocParagraph[], from: number, to: number): number | undefined {
  const chars = new Map<number, number>();
  for (let i = from; i < to; i++) {
    const p = paras[i]!;
    if (p.size === undefined || !isText(p) || wordCount(p.text) < 5) continue;
    chars.set(p.size, (chars.get(p.size) ?? 0) + p.text.length);
  }
  return [...chars].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

const ends = (p: DocParagraph, page: number | undefined) =>
  keywordList(p) !== null ||
  abstractStart(p.text) !== null ||
  isSectionStart(p) ||
  (page !== undefined && p.page !== undefined && p.page > page + 1);

/** Adds a paragraph, or continues the last one when the layout split a sentence. */
function push(body: string[], text: string) {
  const last = body[body.length - 1];
  if (last !== undefined && !/[.!?:]$/.test(last) && /^\p{Ll}/u.test(text)) {
    body[body.length - 1] = join(last, text);
  } else body.push(text);
}

function found(head: number, end: number, body: string[], size?: number): Found {
  return { head, end, body, size, lang: detectLanguage(body.join(' '))?.lang };
}

/** The abstract after its heading (or after its label, when `first` is the inline text). */
function collect(paras: DocParagraph[], head: number, first: string): Found {
  const page = paras[head]!.page;
  let stop = head + 1;
  while (stop < Math.min(paras.length, head + 80) && !ends(paras[stop]!, page)) stop++;
  const size = mainSize(paras, first ? head : head + 1, stop);
  const fits = (p: DocParagraph) =>
    size === undefined || p.size === undefined || Math.abs(p.size - size) <= SAME_SIZE;
  const body: string[] = [];
  if (first) body.push(unlead(first));
  let words = wordCount(first);
  let end = stop;
  for (let j = head + 1; j < stop; j++) {
    const p = paras[j]!;
    const t = p.text.trim();
    if (SKIP.has(p.role) || !t) continue;
    if (p.role === 'formula') {
      // A sentence end the analysis took for a formula ("(44.4% vs. 17.1%; P = 0.013).").
      const last = body[body.length - 1];
      if (last && !/[.!?]$/.test(last) && /[.!?]$/.test(t) && fits(p)) {
        body[body.length - 1] = `${last} ${t}`;
      }
      continue;
    }
    if (p.role === 'heading' && !isText(p)) {
      if (STRUCTURED.test(t)) {
        body.push(t);
        continue;
      }
      // Before the text: the abstract's own title. Inside it: an author in a side column.
      if (!body.length || isPersonName(t)) continue;
      end = j;
      break;
    }
    if (!isText(p) || (size === undefined && p.role !== 'body' && p.role !== 'table-cell'))
      continue;
    if (!fits(p) || (!body.length && wordCount(t) < 8 && !STRUCTURED.test(t))) continue;
    // The same abstract in a second language follows without a heading.
    const lang = wordCount(t) >= 20 ? detectLanguage(t)?.lang : undefined;
    const bodyLang = body.length ? detectLanguage(body.join(' '))?.lang : undefined;
    if (lang && bodyLang && lang !== bodyLang && wordCount(body.join(' ')) >= 40) {
      end = j;
      break;
    }
    push(body, body.length ? t : unlead(t));
    words += wordCount(t);
    if (words >= MAX_ABSTRACT_WORDS) {
      end = j + 1;
      break;
    }
  }
  while (body.length && STRUCTURED.test(body[body.length - 1]!)) body.pop();
  return found(head, end, body, size);
}

/**
 * Unlabelled abstract: the paragraphs right before `anchor` (a keywords line or the
 * introduction), back to the authors, dates or title. Several languages make several abstracts.
 */
function collectBefore(paras: DocParagraph[], anchor: number): Found[] {
  let start = anchor - 1;
  // Side boxes (affiliations, e-mail) may sit between the abstract and its keywords.
  for (; start >= Math.max(0, anchor - 8); start--) {
    const p = paras[start]!;
    if (keywordList(p) !== null || abstractStart(p.text) !== null) return [];
    if (isText(p) && wordCount(p.text) >= 25) break;
    if (p.role === 'heading') return [];
  }
  if (start < Math.max(0, anchor - 8)) return [];
  const size = paras[start]!.size;
  const picked: number[] = [];
  let crossed = 0;
  for (let i = start; i >= 0; i--) {
    const p = paras[i]!;
    const t = p.text.trim();
    if (SKIP.has(p.role) || p.role === 'formula' || !t) continue;
    if (
      (p.role === 'heading' && !isText(p)) ||
      keywordList(p) !== null ||
      abstractStart(t) !== null
    )
      break;
    const same = size === undefined || p.size === undefined || Math.abs(p.size - size) <= SAME_SIZE;
    const n = wordCount(t);
    const next = picked.length ? paras[picked[0]!]!.text.trim() : '';
    // Running heads and licence lines where the abstract runs across a page break.
    if (/^\p{Ll}/u.test(next) && (!same || FRONT_MATTER.test(t)) && crossed++ < 4) continue;
    if (!same) {
      if (n < 8) continue;
      break;
    }
    if (!isText(p) || n < 8 || (n < 25 && FRONT_MATTER.test(t)) || isNameList(t)) break;
    picked.unshift(i);
  }
  if (!picked.length) return [];
  // Split by language (a German abstract followed by its English version).
  const out: Found[] = [];
  let run: number[] = [];
  let lang: string | undefined;
  const flush = () => {
    if (!run.length) return;
    const body: string[] = [];
    for (const i of run) push(body, paras[i]!.text.trim());
    out.push(found(run[0]!, run[run.length - 1]! + 1, body, size));
    run = [];
  };
  for (const i of picked) {
    const l = wordCount(paras[i]!.text) >= 20 ? detectLanguage(paras[i]!.text)?.lang : undefined;
    if (l && lang && l !== lang) flush();
    if (l) lang = l;
    run.push(i);
  }
  flush();
  return out;
}

/**
 * A line clearly in another language than `lang` (an English title under a German one). Short
 * lines share function words between languages, so only strong evidence counts.
 */
function foreign(text: string, lang: string): boolean {
  if (languageScore(text, lang) > 0) return false;
  return LANGUAGES.some((l) => l !== lang && languageScore(text, l) >= 1.5);
}

/** An author line ("F. Marangon1, S.", "Romana Jelínkováa, Petr Žujaa, …"). */
function authorish(text: string): boolean {
  const initials = text.match(/(?:^|\s)\p{Lu}\.(?=\s|$|-|,)/gu)?.length ?? 0;
  const marks = text.match(/\p{Ll}(?:\d+|[*†‡])(?=[,\s]|$)/gu)?.length ?? 0;
  if (initials >= 2 || marks >= 2 || (initials && marks)) return true;
  const bare = text.replace(/[*†‡\d]+/g, '');
  if (isNameList(bare)) return true;
  // "Name Surnamea, Name Surnameb, …": names with an affiliation letter glued on.
  const parts = bare.split(/\s*,\s*/).filter(Boolean);
  return parts.length >= 3 && parts.every((p) => isPersonName(p));
}

function titleIn(
  paras: DocParagraph[],
  from: number,
  to: number,
  abs: Found,
  lang: string,
): string {
  const page = paras[abs.head]?.page;
  const candidatesWith = (headers: boolean) => {
    const out: number[] = [];
    for (let i = from; i < to; i++) {
      const p = paras[i]!;
      const t = p.text.trim();
      const n = wordCount(t);
      if ((SKIP.has(p.role) && !(headers && p.role === 'header')) || p.role === 'formula') continue;
      if (n < 2 || n > 40) continue;
      if (page !== undefined && p.page !== undefined && (p.page > page || p.page < page - 1))
        continue;
      if (!/\p{L}{2}/u.test(t) || FRONT_MATTER.test(t) || keywordList(p) !== null) continue;
      // A Title Case title of four or five words looks like a name too.
      if (authorish(t) || (n <= 3 && isPersonName(t.replace(/[*†‡\d]+/g, '')))) continue;
      out.push(i);
    }
    return out;
  };
  const size = (i: number) => paras[i]!.size ?? 0;
  const largest = (pool: number[]) => pool.reduce((a, b) => (size(b) > size(a) ? b : a));
  const pick = (candidates: number[]) => {
    // Set larger than the text (or in capitals when everything has one size) …
    let pool = candidates.filter((i) => abs.size === undefined || size(i) > abs.size + SAME_SIZE);
    if (!pool.length && abs.size !== undefined) {
      pool = candidates.filter((i) => {
        const t = paras[i]!.text;
        return wordCount(t) >= 3 && t === t.toLocaleUpperCase() && /\p{Lu}{3}/u.test(t);
      });
    }
    if (!pool.length) return -1;
    // … in the wanted language when one of nearly the largest size is.
    const top = size(largest(pool));
    const own = pool.filter((i) => !foreign(paras[i]!.text, lang) && size(i) >= 0.75 * top);
    return largest(own.length ? own : pool);
  };
  let best = pick(candidatesWith(false));
  // A title repeated as the running head was taken for one.
  if (best < 0) best = pick(candidatesWith(true));
  if (best < 0) return '';
  let title = paras[best]!.text.trim();
  // A title set on several lines may come as consecutive paragraphs of the same size, with a
  // small label ("Nota Técnica") set beside it.
  let skipped = 0;
  for (let i = best + 1; i < to && size(best) > 0; i++) {
    const p = paras[i]!;
    const t = p.text.trim();
    if ((SKIP.has(p.role) && p.role !== 'header') || !t) continue;
    if (p.page !== paras[best]!.page) break;
    if (Math.abs(size(i) - size(best)) > 0.3) {
      if (skipped++ === 0 && wordCount(t) <= 2) continue;
      break;
    }
    if (FRONT_MATTER.test(t) || keywordList(p) !== null || authorish(t)) break;
    if (wordCount(title) + wordCount(t) > 50 || foreign(t, lang)) break;
    title = join(title, t);
  }
  return title;
}

function findKeywords(paras: DocParagraph[], abs: Found, from: number): string {
  // After the abstract (most layouts) …
  for (let i = abs.end; i < Math.min(paras.length, abs.end + 8); i++) {
    const p = paras[i]!;
    if (SKIP.has(p.role)) continue;
    const list = keywordsAt(paras, i);
    if (list !== null) return list;
    if (abstractStart(p.text) !== null || isSectionStart(p)) break;
  }
  // … or before it (Elsevier's "Article info" column).
  for (let i = abs.head - 1; i >= Math.max(from, abs.head - 30); i--) {
    if (abstractStart(paras[i]!.text) !== null) break;
    const list = keywordsAt(paras, i);
    if (list !== null) return list;
  }
  return '';
}

function labelled(paras: DocParagraph[]): Found[] {
  const out: Found[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]!;
    if (SKIP.has(p.role) || p.role === 'formula' || (out.length && i < out[out.length - 1]!.end))
      continue;
    const first = abstractStart(p.text);
    if (first === null) continue;
    const abs = collect(paras, i, first);
    if (abs.body.length) out.push(abs);
  }
  return out;
}

/** A structured abstract without a heading: from its first label ("Background: …") on. */
function opening(paras: DocParagraph[]): Found[] {
  const i = paras.findIndex(
    (p) => !SKIP.has(p.role) && OPENING.test(p.text.trim()) && wordCount(p.text) >= 15,
  );
  if (i < 0) return [];
  const abs = collect(paras, i, paras[i]!.text.trim());
  return abs.body.length ? [abs] : [];
}

function unlabelled(paras: DocParagraph[]): Found[] {
  const anchors = paras.flatMap((p, i) => (keywordList(p) !== null ? [i] : []));
  const found = anchors.flatMap((a) => collectBefore(paras, a));
  if (found.length) return found;
  const intro = paras.findIndex((p) => INTRODUCTION.test(p.text.trim()) && wordCount(p.text) <= 8);
  return intro > 0 ? collectBefore(paras, intro) : [];
}

/**
 * Title, abstract and keywords of the document, or null when it has no recognisable abstract.
 * With several abstracts (one per language) the one in `sourceLang` is chosen.
 */
export function findPaperParts(paras: DocParagraph[], sourceLang: string): PaperParts | null {
  let abstracts = labelled(paras);
  if (!abstracts.length) abstracts = opening(paras);
  if (!abstracts.length) abstracts = unlabelled(paras);
  if (!abstracts.length) return null;
  const chosen = abstracts.find((a) => a.lang === sourceLang) ?? abstracts[0]!;
  const index = abstracts.indexOf(chosen);
  const previous = abstracts[index - 1];
  // The part before this abstract that belongs to it: after the previous abstract's keywords.
  let from = 0;
  if (previous) {
    from = previous.end;
    for (let i = previous.end; i < chosen.head; i++) {
      if (keywordList(paras[i]!) !== null) {
        from = i + 1;
        break;
      }
    }
  }
  // The title in the document's language, also when its only abstract is in another one.
  const title =
    titleIn(paras, from, chosen.head, chosen, sourceLang) ||
    (from > 0 ? titleIn(paras, 0, abstracts[0]!.head, chosen, sourceLang) : '');
  const others = abstracts
    .filter((a) => a !== chosen && a.lang && a.lang !== chosen.lang)
    .map((a) => a.lang!);
  return {
    title,
    abstract: chosen.body,
    keywords: findKeywords(paras, chosen, from),
    ...(chosen.lang ? { lang: chosen.lang } : {}),
    otherAbstracts: [...new Set(others)],
  };
}
