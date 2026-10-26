import { functionWords } from '../detectLanguage';
import { plainText, tokenize } from '../segment/codec';
import { compareNumbers } from './numbers';

export type ValidationCode =
  | 'EMPTY'
  | 'TAG_MISMATCH'
  | 'PLACEHOLDER_MISMATCH'
  | 'NUMBER_MISMATCH'
  | 'CITATION_MISMATCH'
  | 'GLOSSARY_MISMATCH'
  | 'WRONG_LANGUAGE'
  | 'UNTRANSLATED'
  | 'CHATTER'
  | 'LENGTH_RATIO'
  | 'MEANING_DRIFT'
  | 'STYLE_APPROXIMATED'
  | 'PARTLY_UNTRANSLATED'
  | 'REVIEW_SUGGESTED'
  | 'REFUSED';

export interface ValidationIssue {
  code: ValidationCode;
  /** Errors trigger a retry; warnings are reported but the translation is kept. */
  severity: 'error' | 'warning';
  detail: string;
}

export interface GlossaryEntry {
  source: string;
  target: string;
  note?: string;
}

export interface ValidateInput {
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  glossary?: GlossaryEntry[];
  /** Off for the pseudo engine, whose output is intentionally not in the target language. */
  checkLanguage?: boolean;
}

const multiset = (items: string[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
};
const sameMultiset = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const ma = multiset(a);
  const mb = multiset(b);
  return [...ma].every(([k, v]) => mb.get(k) === v);
};

function checkTags(target: string): string | null {
  const stack: string[] = [];
  for (const t of tokenize(target)) {
    if (t.type === 'open') stack.push(t.id);
    if (t.type === 'close' && stack.pop() !== t.id) return `unbalanced </${t.id}>`;
  }
  return stack.length ? `unclosed <${stack[stack.length - 1]}>` : null;
}

const ids = (text: string, type: 'open' | 'ph') =>
  tokenize(text)
    .filter((t) => t.type === type)
    .map((t) => (t as { id: string }).id);

/** Bracketed numeric citations like [12], [3, 5], [7–9]. */
const CITATION_RE = /\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g;
const citations = (text: string) =>
  [...text.matchAll(CITATION_RE)].map((m) => m[0].replace(/\s+/g, '').replace('–', '-'));

const CHATTER_RE =
  /^\s*(?:here(?:'s| is) (?:the|your) translation|translation\s*:|sure[,!]|certainly[,!]|of course[,!]|i (?:have )?translated|aşağıda(?:ki)? (?:metnin )?çeviri|işte çeviri|çeviri\s*:|hier ist die übersetzung|übersetzung\s*:|вот перевод|перевод\s*:)/i;

const SCRIPT_RE = {
  cyrillic: /\p{Script=Cyrillic}/gu,
  greek: /\p{Script=Greek}/gu,
  latin: /\p{Script=Latin}/gu,
};
const scriptOf = (lang: string): keyof typeof SCRIPT_RE =>
  ['ru', 'uk', 'bg', 'sr', 'mk', 'be'].includes(lang)
    ? 'cyrillic'
    : lang === 'el'
      ? 'greek'
      : 'latin';
/** Letters outside Mathematical Alphanumeric Symbols ("𝑝", "𝐱" belong to no language). */
const NON_MATH_LETTER = /(?![\u{1d400}-\u{1d7ff}])\p{L}/gu;
function scriptRatio(text: string, script: keyof typeof SCRIPT_RE): number {
  const letters = text.match(NON_MATH_LETTER)?.length ?? 0;
  if (letters === 0) return 1;
  return (text.match(SCRIPT_RE[script])?.length ?? 0) / letters;
}

/** Letters that only occur in the source language's alphabet (used when scripts are equal). */
const DISTINCT_LETTERS: Record<string, RegExp> = {
  tr: /[ğışĞİŞ]/gu,
  de: /[ßäöü]/giu,
  pl: /[ąćęłńśźż]/giu,
  cs: /[ěřůčšžý]/giu,
  ro: /[ăâîșț]/giu,
  hu: /[őű]/giu,
};

/** Loose term presence: case-insensitive, tolerant to inflection by matching a stem. */
function containsTerm(text: string, term: string, lang: string): boolean {
  const hay = text.toLocaleLowerCase(lang);
  const needle = term.toLocaleLowerCase(lang).trim();
  if (!needle) return true;
  if (hay.includes(needle)) return true;
  const words = needle.split(/\s+/);
  return words.every((w) => {
    const stem = w.length > 5 ? w.slice(0, Math.ceil(w.length * 0.7)) : w;
    return hay.includes(stem);
  });
}

/** Runs every check of TRANSLATION.md §6 plus the fidelity checks of ADR-008. */
export function validateTranslation(input: ValidateInput): ValidationIssue[] {
  const { source, target, sourceLang, targetLang } = input;
  const issues: ValidationIssue[] = [];
  const err = (code: ValidationCode, detail: string) =>
    issues.push({ code, severity: 'error', detail });
  const warn = (code: ValidationCode, detail: string) =>
    issues.push({ code, severity: 'warning', detail });

  const srcPlain = plainText(source).trim();
  const tgtPlain = plainText(target).trim();
  if (!target.trim()) {
    if (source.trim()) err('EMPTY', 'translation is empty');
    return issues;
  }

  const tagProblem = checkTags(target);
  if (tagProblem) err('TAG_MISMATCH', tagProblem);
  else if (!sameMultiset(ids(source, 'open'), ids(target, 'open'))) {
    err(
      'TAG_MISMATCH',
      `expected tags {${ids(source, 'open').join(', ')}}, got {${ids(target, 'open').join(', ')}}`,
    );
  }
  if (!sameMultiset(ids(source, 'ph'), ids(target, 'ph'))) {
    err(
      'PLACEHOLDER_MISMATCH',
      `expected placeholders {${ids(source, 'ph').join(', ')}}, got {${ids(target, 'ph').join(', ')}}`,
    );
  }

  // Placeholders separate numbers ("2048⟦F1⟧2448" is two numbers, not "2048 2448"), and
  // bracketed citations are left to the citation check: engines write "[3,5]" as "[3, 5]",
  // which would otherwise read as the decimal 3,5 against two numbers.
  const forNumbers = (t: string) =>
    tokenize(t)
      .map((tok) => (tok.type === 'text' ? tok.text : tok.type === 'ph' ? ' | ' : ''))
      .join('')
      .replace(CITATION_RE, ' ');
  const nums = compareNumbers(forNumbers(source), forNumbers(target));
  if (nums.missing.length || nums.extra.length) {
    err(
      'NUMBER_MISMATCH',
      [
        nums.missing.length && `missing ${nums.missing.join(', ')}`,
        nums.extra.length && `unexpected ${nums.extra.join(', ')}`,
      ]
        .filter(Boolean)
        .join('; '),
    );
  }
  if (!sameMultiset(citations(srcPlain), citations(tgtPlain))) {
    err('CITATION_MISMATCH', `citations ${citations(srcPlain).join(' ')} must be kept exactly`);
  }

  if (CHATTER_RE.test(tgtPlain))
    err('CHATTER', 'translation starts with a comment instead of content');

  if (srcPlain.length >= 20) {
    const ratio = tgtPlain.length / srcPlain.length;
    if (ratio < 0.3 || ratio > 2.5)
      err('LENGTH_RATIO', `length ratio ${ratio.toFixed(2)} outside [0.3, 2.5]`);
  }

  if (input.checkLanguage !== false && sourceLang !== targetLang && srcPlain.length >= 20) {
    if (tgtPlain === srcPlain) {
      // Names, identifiers and figures legitimately stay the same.
      if (functionWords(srcPlain, sourceLang) > 0) {
        err('UNTRANSLATED', 'translation is identical to the source');
      } else {
        warn('UNTRANSLATED', 'kept as is (names, code or figures)');
      }
    }
    const script = scriptOf(targetLang);
    if (scriptRatio(tgtPlain, script) < 0.6) {
      err('WRONG_LANGUAGE', `expected ${script} script for ${targetLang}`);
    } else if (scriptOf(sourceLang) === script) {
      const distinct = DISTINCT_LETTERS[sourceLang];
      if (distinct && !DISTINCT_LETTERS[targetLang]) {
        const count = tgtPlain.match(distinct)?.length ?? 0;
        if (count >= 3 && count / tgtPlain.length > 0.01) {
          err('WRONG_LANGUAGE', `contains ${count} ${sourceLang}-specific letters`);
        }
      }
    }
  }

  for (const entry of input.glossary ?? []) {
    if (
      containsTerm(srcPlain, entry.source, sourceLang) &&
      !containsTerm(tgtPlain, entry.target, targetLang)
    ) {
      warn('GLOSSARY_MISMATCH', `"${entry.source}" should be translated as "${entry.target}"`);
    }
  }
  return issues;
}
