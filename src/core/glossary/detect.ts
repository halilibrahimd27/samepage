import type { GlossaryEntry } from '../validate/validate';
import { FIELD_TERMS, type Field } from './fields';

/**
 * Glossary suggestions from the document itself (P8.2): words set in a code font and tool
 * names stay as they are ("bandit" became "haydut"), field terms get their established
 * translation. Nothing is applied until the user accepts it.
 */

/** A paragraph's text and the pieces of it set in a code (monospace) font. */
export interface TermText {
  text: string;
  mono?: string[];
}

export type TermReason = 'code' | 'tool' | Field;

export interface TermSuggestion extends GlossaryEntry {
  reason: TermReason;
  /** Occurrences in the document. */
  count: number;
}

const MAX_SUGGESTIONS = 40;

/** Nouns that name software in the source language, after the name ("the bandit tool"). */
const TOOL_AFTER: Record<string, string> = {
  en: 'tool|tools|library|framework|toolkit|linter|scanner|plugin|compiler|parser|software|platform|api',
  tr: 'aracı|aracını|aracıyla|araçları|kütüphanesi|kütüphanesini|paketi|paketini|çerçevesi|yazılımı|eklentisi',
  de: 'Tool|Werkzeug|Bibliothek|Paket|Framework',
};
/** "a tool called X", "the library X". */
const TOOL_BEFORE: Record<string, string> = {
  en: '(?:tool|library|package|framework|toolkit|linter|scanner|plugin)s?\\s+(?:called|named)',
};
/** Words in front of "tool" that describe it rather than name it. */
const GENERIC = new Set(
  (
    'a an the this that these those our their its new existing same other such each any some ' +
    'popular open source open-source free commercial proprietary custom simple standard main ' +
    'first second following above proposed used static dynamic automated automatic analysis ' +
    'security testing test detection learning machine deep data web online research software ' +
    'statistical external internal modern classical common well-known widely known useful ' +
    'powerful python java javascript language programming development design modelling modeling ' +
    'simulation measurement evaluation visualization visualisation management search every all ' +
    'several many various multiple malicious benign suspicious vulnerable target given specific ' +
    'single whole entire original final resulting corresponding previous latest current recent'
  ).split(' '),
);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The term in running text: any spacing or hyphenation, and a short ending ("intervals"). */
function termPattern(term: string): RegExp {
  const body = term
    .split(/[\s-]+/)
    .map(escape)
    .join('[\\s\\u2010\\u2011-]+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}\\p{L}{0,3}(?![\\p{L}\\p{N}])`, 'giu');
}

const countIn = (texts: string[], re: RegExp) =>
  texts.reduce((n, t) => n + (t.match(re)?.length ?? 0), 0);

/** A code-font piece worth keeping: a word or short name, not code and not a number. */
function codeWord(piece: string): string | null {
  const t = piece.trim().replace(/^[("'`]+|[)"'`.,;:]+$/g, '');
  if (t.length < 2 || t.length > 40 || !/\p{L}/u.test(t)) return null;
  // URLs and DOIs are kept by the encoder already.
  if (/:\/\/|^www\.|^https?$|^doi\b/i.test(t)) return null;
  if (t.split(/\s+/).length > 3 || /[=(){}[\];<>]/.test(t)) return null;
  // All capitals (acronyms) and identifiers with digits, underscores or inner capitals are
  // already kept by the engines and the encoder.
  if (t === t.toUpperCase() || /[_\d]|[a-z][A-Z]/.test(t)) return null;
  return t;
}

export function suggestTerms(
  paragraphs: TermText[],
  source: string,
  target: string,
  known: GlossaryEntry[] = [],
): TermSuggestion[] {
  const texts = paragraphs.map((p) => p.text);
  const have = new Set(known.map((k) => k.source.trim().toLocaleLowerCase(source)));
  const found = new Map<string, TermSuggestion>();
  const add = (term: string, translation: string, reason: TermReason) => {
    const key = term.toLocaleLowerCase(source);
    if (have.has(key) || found.has(key)) return;
    const count = countIn(texts, termPattern(term));
    if (count > 0) found.set(key, { source: term, target: translation, reason, count });
  };

  // Words set in a code font: commands, packages, tools.
  const code = new Map<string, number>();
  for (const p of paragraphs) {
    for (const piece of p.mono ?? []) {
      const w = codeWord(piece);
      if (w) code.set(w, (code.get(w) ?? 0) + 1);
    }
  }
  for (const w of [...code.keys()].sort()) add(w, w, 'code');

  // Names in front of "tool", "library" … (or after "a tool called").
  const after = TOOL_AFTER[source];
  const before = TOOL_BEFORE[source];
  const names = new Set<string>();
  const name = '([\\p{L}][\\p{L}\\p{N}.+-]{1,30})';
  const patterns = [
    ...(after ? [new RegExp(`(?<![\\p{L}\\p{N}])${name}\\s+(?:${after})(?![\\p{L}])`, 'gu')] : []),
    ...(before ? [new RegExp(`(?:${before})\\s+${name}`, 'giu')] : []),
  ];
  for (const t of texts) {
    for (const re of patterns) {
      for (const m of t.matchAll(re)) {
        const n = m[1]!.replace(/[.-]+$/, '');
        const initial = /(?:^|[.!?:]\s*)$/u.test(t.slice(0, m.index).trimEnd());
        if (n.length < 3 || GENERIC.has(n.toLocaleLowerCase(source)) || n === n.toUpperCase())
          continue;
        // A name looks like one: inner capitals or punctuation ("sklearn.svm", "Scikit-learn"),
        // or a capital inside a sentence where nouns are not capitalised anyway.
        const shaped = /\.\p{L}|\p{Ll}\p{Lu}/u.test(n);
        const proper = /^\p{Lu}/u.test(n) && !initial && source !== 'de';
        if (shaped || proper) names.add(n);
      }
    }
  }
  for (const n of [...names].sort()) add(n, n, 'tool');

  // Field terms with an established translation in the target language.
  for (const term of FIELD_TERMS) {
    const words = term as Partial<Record<string, string>>;
    const from = words[source];
    const to = words[target];
    if (from && to) add(from, to, term.field);
  }

  const order: TermReason[] = [
    'code',
    'tool',
    'stats',
    'medicine',
    'cs',
    'engineering',
    'chemistry',
  ];
  return [...found.values()]
    .sort(
      (a, b) =>
        order.indexOf(a.reason) - order.indexOf(b.reason) ||
        b.count - a.count ||
        a.source.localeCompare(b.source),
    )
    .slice(0, MAX_SUGGESTIONS);
}
