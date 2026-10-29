import { tokenize } from '../segment/codec';
import type { GlossaryEntry } from '../validate/validate';
import { BUILT_IN_NAMES } from './names';

export interface Protected {
  text: string;
  /** Target text for ⟦G1⟧, ⟦G2⟧, … (or ⟦D1⟧, …) */
  targets: string[];
  /** Per target: a built-in name, which keeps its case at a sentence start ("npm"). */
  exact?: boolean[];
}

/** A glossary entry, or a built-in name (`exact`: whole word, case-sensitive, never re-cased). */
export type ProtectEntry = GlossaryEntry & { exact?: boolean };

/**
 * The user's glossary plus the built-in software names; the user's entries win, so a name the
 * glossary already lists (in any case) is not protected a second time.
 */
export function withBuiltInNames(glossary: GlossaryEntry[]): ProtectEntry[] {
  const own = new Set(glossary.map((g) => g.source.trim().toLowerCase()));
  return [
    ...glossary,
    ...BUILT_IN_NAMES.filter((n) => !own.has(n.toLowerCase())).map((n) => ({
      source: n,
      target: n,
      exact: true,
    })),
  ];
}

/** Tagged text again, with `text` applied to the plain-text tokens. */
const markup = (t: ReturnType<typeof tokenize>[number], text: (s: string) => string) =>
  t.type === 'text'
    ? text(t.text)
    : t.type === 'open'
      ? `<${t.id}>`
      : t.type === 'close'
        ? `</${t.id}>`
        : `⟦${t.id}⟧`;

/**
 * Glossary term protection for engines that cannot follow a glossary (ADR-015): each source
 * term in plain text — including an attached suffix such as Turkish case endings — becomes
 * ⟦Gn⟧; restoreTerms() puts the glossary target in its place after translation.
 * Matching is case-insensitive with the source language's casing rules; longest terms first.
 */
/** Source languages whose case and possessive endings are attached to the term. */
const AGGLUTINATIVE = new Set(['tr', 'hu']);

export function protectTerms(
  tagged: string,
  glossary: ProtectEntry[],
  sourceLang: string,
): Protected {
  const entries = glossary
    .filter((g) => g.source.trim() && g.target.trim())
    .sort(
      (a, b) =>
        b.source.length - a.source.length ||
        Number(!!a.exact) - Number(!!b.exact) ||
        a.source.localeCompare(b.source),
    );
  if (entries.length === 0) return { text: tagged, targets: [] };
  const targets: string[] = [];
  const exact: boolean[] = [];
  const isLetter = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

  const protectText = (text: string): string => {
    const lower = text.toLocaleLowerCase(sourceLang);
    // Only proceed when lowercasing kept the length (true for the scripts we support).
    if (lower.length !== text.length) return text;
    let out = '';
    let i = 0;
    while (i < text.length) {
      let matched = false;
      if (!isLetter(text[i - 1])) {
        for (const e of entries) {
          if (e.exact) {
            // A name as written, standing alone: not "Javascript", "Pythonic", "Python3",
            // "GPT-3.5" (for GPT-3), "a.Python" or "user/Python".
            const next = text[i + e.source.length];
            const after = text[i + e.source.length + 1];
            if (
              !text.startsWith(e.source, i) ||
              /[./@_\\]/.test(text[i - 1] ?? '') ||
              isLetter(next) ||
              next === '_' ||
              (next && /[.,-]/.test(next) && /\d/.test(after ?? ''))
            )
              continue;
            targets.push(e.target);
            exact.push(true);
            out += `⟦G${targets.length}⟧`;
            i += e.source.length;
            matched = true;
            break;
          }
          const needle = e.source.toLocaleLowerCase(sourceLang);
          if (lower.startsWith(needle, i)) {
            let end = i + needle.length;
            while (end < text.length && /\p{L}/u.test(text[end]!)) end++; // attached suffix
            // A short ending only, except in languages that stack suffixes: "test set" is not
            // the start of "test settings".
            if (end - i - needle.length > (AGGLUTINATIVE.has(sourceLang) ? 12 : 3)) continue;
            targets.push(e.target);
            exact.push(false);
            out += `⟦G${targets.length}⟧`;
            i = end;
            matched = true;
            break;
          }
        }
      }
      if (!matched) out += text[i++];
    }
    return out;
  };

  const text = tokenize(tagged)
    .map((t) => markup(t, protectText))
    .join('');
  return { text, targets, exact };
}

const TAGS = '(?:\\s|<\\/?t\\d+>)*';
const CITATION = new RegExp(`\\[${TAGS}\\d+(?:${TAGS}[,–-]${TAGS}\\d+)*${TAGS}\\]`, 'g');

/** Languages that set a space (non-breaking) between a number and its percent sign. */
const SPACED_PERCENT = new Set(['de', 'fr', 'es', 'cs', 'sv', 'ru', 'uk', 'bg']);

/**
 * A percentage in the target language's order: Turkish writes the sign first ("%81"); a
 * Turkish source's "%81" becomes "81%" (or "81 %") elsewhere. Other spellings stay as written.
 */
export function percentFor(written: string, target: string): string {
  const m = /^([%‰])\s?(\d.*)$|^(\d.*?)\s?([%‰])$/u.exec(written);
  if (!m) return written;
  const [sign, number] = m[1] ? [m[1], m[2]!] : [m[4]!, m[3]!];
  if (target === 'tr') return sign + number;
  if (!m[1]) return written;
  return number + (SPACED_PERCENT.has(target) ? '\u00A0' : '') + sign;
}

/**
 * Freezes every number and citation of a segment as ⟦D1⟧, ⟦D2⟧, … for a retry after an engine changed one
 * (machine translators turn the elided year "17—" into "2017"). restoreTerms(…, 'D') puts the
 * numbers back exactly as written. A percent sign travels with its number ("81%" moved away
 * from 81 reads "Süre 81npm'de … yüzdesi"), in the target language's order.
 */
export function protectNumbers(tagged: string, target?: string): Protected {
  const targets: string[] = [];
  const freeze = (n: string) => {
    targets.push(target ? percentFor(n, target) : n);
    return `⟦D${targets.length}⟧`;
  };
  // Bracketed citations ("[38,58]", "[<t4>42</t4>]") are frozen whole, tags included, so no
  // bracket can go astray; restoring puts back the exact source text.
  const text = tokenize(tagged.replace(CITATION, freeze))
    .map((t) =>
      markup(t, (s) => s.replace(/[%‰]\s?\d+(?:[.,]\d+)*|\d+(?:[.,]\d+)*(?:\s?[%‰])?/g, freeze)),
    )
    .join('');
  return { text, targets };
}

/**
 * Replaces ⟦Gn⟧ (or ⟦Dn⟧) with their targets; returns null when a protected term went missing.
 */
export function restoreTerms(
  translated: string,
  targets: string[],
  kind = 'G',
  keepCase: boolean[] = [],
): string | null {
  for (let n = 1; n <= targets.length; n++) {
    if (translated.split(`⟦${kind}${n}⟧`).length !== 2) return null;
  }
  return translated.replace(new RegExp(`⟦${kind}(\\d+)⟧`, 'g'), (m, n: string, at: number) => {
    const t = targets[Number(n) - 1];
    if (t === undefined || keepCase[Number(n) - 1]) return t ?? m;
    // A term that opens a sentence starts with a capital ("kesinlik" → "Kesinlik ve …").
    const before = translated.slice(0, at).replace(/<\/?t\d+>/g, '');
    return /^\s*$|[.!?]\s+$/u.test(before) ? t.charAt(0).toLocaleUpperCase() + t.slice(1) : t;
  });
}
