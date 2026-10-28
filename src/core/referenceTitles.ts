import type { LangPair } from '../engines/types';
import { shortTextLanguage } from './detectLanguage';
import type { SegmentOutcome } from './pipeline/translate';
import { plainText, tokenize } from './segment/codec';

/**
 * Reference titles translated in brackets (P9.6, APA 7 §9.38): the entry stays in its
 * language and the title's translation follows it — "Makine çevirisi [Machine translation]."
 */

export interface ReferenceTitle {
  /** The title as written, without the period that ends it. */
  title: string;
  /** Plain-text offset where the bracket goes: before the ending period, after "?" or "!". */
  insertAt: number;
}

/** "(2019). ", "(2019a). ", "(n.d.). ", "(t.y.). ", "(2020, March 3). " */
const YEAR =
  /\((?:\d{4}[a-z]?|n\.\s?d\.|t\.\s?y\.|b\.\s?t\.|s\.\s?d\.|o\.\s?J\.)(?:,[^)]{1,40})?\)\.?\s+/gu;
/** A title ends at a sentence end before the source ("Journal", "In A. Editor", a number). */
const TITLE_END = /[.?!](?=\s+[\p{Lu}\p{N}("“«[]|\s*$)/u;
const QUOTED = /[“"«„]([^”"»“„]{8,400}?)[”"»“]/gu;

/** A title whose translation is there already: "Başlık [Title]." or "Başlık. [Title]". */
const translated = (plain: string, t: ReferenceTitle) =>
  /\]\s*$/.test(t.title) || /^\s*\[/.test(plain.slice(t.insertAt));

/** Titles of the entries in a reference text: after the year (APA, Harvard), else in quotes. */
export function referenceTitles(plain: string): ReferenceTitle[] {
  const found: ReferenceTitle[] = [];
  for (const m of plain.matchAll(YEAR)) {
    const start = m.index + m[0].length;
    const end = TITLE_END.exec(plain.slice(start));
    if (!end) continue;
    const mark = plain[start + end.index]!;
    const title = plain.slice(start, start + end.index + (mark === '.' ? 0 : 1)).trim();
    const insertAt = start + end.index + (mark === '.' ? 0 : 1);
    if (title.length >= 3 && title.length <= 400 && /\p{L}{2}/u.test(title))
      found.push({ title, insertAt });
  }
  if (found.length) return found.filter((t) => !translated(plain, t));
  for (const m of plain.matchAll(QUOTED)) {
    const title = m[1]!.trim().replace(/[,.;:]+$/u, '');
    if (/\p{L}{2}/u.test(title)) found.push({ title, insertAt: m.index + m[0].length });
  }
  return found.filter((t) => !translated(plain, t));
}

/**
 * Whether a title gets its translation in brackets: written in another language than the
 * paper's target. English titles are left alone in papers not written in English (APA's rule
 * is for English-language papers; English is the shared language of science elsewhere).
 */
export function wantsBracket(title: string, pair: LangPair): boolean {
  const lang = shortTextLanguage(title, pair.source);
  if (!lang || lang === pair.target) return false;
  return pair.target === 'en' || lang !== 'en';
}

const markupOf = (t: ReturnType<typeof tokenize>[number]) =>
  t.type === 'text'
    ? t.text
    : t.type === 'open'
      ? `<${t.id}>`
      : t.type === 'close'
        ? `</${t.id}>`
        : `⟦${t.id}⟧`;

/**
 * Inserts text into tagged text at a plain-text offset; at the end of a formatted run (an
 * italic book title) it goes after the run, so the bracket keeps the plain style (APA).
 */
export function insertAtPlain(tagged: string, offset: number, insertion: string): string {
  let out = '';
  let seen = 0;
  let pending = false;
  let inserted = false;
  for (const t of tokenize(tagged)) {
    if (pending && t.type !== 'close') {
      out += insertion;
      pending = false;
      inserted = true;
    }
    if (t.type === 'text' && !inserted && !pending) {
      if (seen + t.text.length > offset) {
        const k = offset - seen;
        out += t.text.slice(0, k) + insertion + t.text.slice(k);
        inserted = true;
      } else {
        out += t.text;
        pending = seen + t.text.length === offset;
      }
      seen += t.text.length;
      continue;
    }
    out += markupOf(t);
  }
  return pending ? out + insertion : out;
}

/** The entry with each title's translation in brackets; `translations[i]` for `titles[i]`. */
export function bracketTitles(
  tagged: string,
  titles: ReferenceTitle[],
  translations: (string | null)[],
): string {
  let out = tagged;
  // From the end, so earlier offsets stay valid.
  for (let i = titles.length - 1; i >= 0; i--) {
    const text = translations[i]
      ?.replace(/<\/?t\d+>|[⟦⟧]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.]$/u, '');
    if (text) out = insertAtPlain(out, titles[i]!.insertAt, ` [${text}]`);
  }
  return out;
}

/** Titles of a tagged reference entry that get their translation in brackets. */
export function titlesToTranslate(tagged: string, pair: LangPair): ReferenceTitle[] {
  return referenceTitles(plainText(tagged)).filter((t) => wantsBracket(t.title, pair));
}

/**
 * A reference entry's outcome from its titles' translations: the entry with the brackets, the
 * titles' issues and findings kept for the report. Null when no title was translated.
 */
export function bracketedOutcome(
  tagged: string,
  titles: ReferenceTitle[],
  outcomeOf: (title: string) => SegmentOutcome | undefined,
): SegmentOutcome | null {
  const outcomes = titles.map((t) => outcomeOf(t.title));
  const translations = outcomes.map((o) => (o && !o.untranslated ? plainText(o.text) : null));
  if (translations.every((t) => t === null)) return null;
  return {
    id: '',
    text: bracketTitles(tagged, titles, translations),
    untranslated: false,
    cached: outcomes.every((o) => o?.cached),
    attempts: 0,
    issues: outcomes.flatMap((o) => o?.issues ?? []),
    notes: ['reference-titles'],
    findings: outcomes.flatMap((o) => o?.findings ?? []),
  };
}
