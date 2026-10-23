import { tokenize } from '../segment/codec';
import type { GlossaryEntry } from '../validate/validate';

export interface Protected {
  text: string;
  /** Target term for ⟦G1⟧, ⟦G2⟧, … */
  targets: string[];
}

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
    .map((t) =>
      t.type === 'text'
        ? protectText(t.text)
        : t.type === 'open'
          ? `<${t.id}>`
          : t.type === 'close'
            ? `</${t.id}>`
            : `⟦${t.id}⟧`,
    )
    .join('');
  return { text, targets };
}

/** Replaces ⟦Gn⟧ with glossary targets; returns null when a protected term went missing. */
export function restoreTerms(translated: string, targets: string[]): string | null {
  for (let n = 1; n <= targets.length; n++) {
    if (translated.split(`⟦G${n}⟧`).length !== 2) return null;
  }
  return translated.replace(/⟦G(\d+)⟧/g, (m, n: string) => targets[Number(n) - 1] ?? m);
}
