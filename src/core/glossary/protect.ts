import { tokenize } from '../segment/codec';
import type { GlossaryEntry } from '../validate/validate';

export interface Protected {
  text: string;
  /** Target text for ⟦G1⟧, ⟦G2⟧, … (or ⟦D1⟧, …) */
  targets: string[];
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
export function protectTerms(
  tagged: string,
  glossary: GlossaryEntry[],
  sourceLang: string,
): Protected {
  const entries = glossary
    .filter((g) => g.source.trim() && g.target.trim())
    .sort((a, b) => b.source.length - a.source.length || a.source.localeCompare(b.source));
  if (entries.length === 0) return { text: tagged, targets: [] };
  const targets: string[] = [];
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
          const needle = e.source.toLocaleLowerCase(sourceLang);
          if (lower.startsWith(needle, i)) {
            let end = i + needle.length;
            while (end < text.length && /\p{L}/u.test(text[end]!)) end++; // attached suffix
            targets.push(e.target);
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
  return { text, targets };
}

const TAGS = '(?:\\s|<\\/?t\\d+>)*';
const CITATION = new RegExp(`\\[${TAGS}\\d+(?:${TAGS}[,–-]${TAGS}\\d+)*${TAGS}\\]`, 'g');

/**
 * Freezes every number and citation of a segment as ⟦D1⟧, ⟦D2⟧, … for a retry after an engine changed one
 * (machine translators turn the elided year "17—" into "2017"). restoreTerms(…, 'D') puts the
 * numbers back exactly as written.
 */
export function protectNumbers(tagged: string): Protected {
  const targets: string[] = [];
  const freeze = (n: string) => {
    targets.push(n);
    return `⟦D${targets.length}⟧`;
  };
  // Bracketed citations ("[38,58]", "[<t4>42</t4>]") are frozen whole, tags included, so no
  // bracket can go astray; restoring puts back the exact source text.
  const text = tokenize(tagged.replace(CITATION, freeze))
    .map((t) => markup(t, (s) => s.replace(/\d+(?:[.,]\d+)*/g, freeze)))
    .join('');
  return { text, targets };
}

/**
 * Replaces ⟦Gn⟧ (or ⟦Dn⟧) with their targets; returns null when a protected term went missing.
 */
export function restoreTerms(translated: string, targets: string[], kind = 'G'): string | null {
  for (let n = 1; n <= targets.length; n++) {
    if (translated.split(`⟦${kind}${n}⟧`).length !== 2) return null;
  }
  return translated.replace(
    new RegExp(`⟦${kind}(\\d+)⟧`, 'g'),
    (m, n: string) => targets[Number(n) - 1] ?? m,
  );
}
