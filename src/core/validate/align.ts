import { splitSentences } from '../../engines/plainText';

/**
 * Side-by-side review of a paragraph (P8.3): source, translation and back-translation, sentence
 * by sentence when they line up, with the words that differ between the source and the
 * back-translation marked. Both of those are in the source language, so a reader who does not
 * know the target language can still see where the meaning may have moved.
 */

export interface ReviewRow {
  source: string;
  target: string;
  back: string;
}

/** One row per sentence when all three texts have the same sentence count, else one row. */
export function reviewRows(source: string, target: string, back: string): ReviewRow[] {
  const s = splitSentences(source).map((x) => x.trim());
  const t = splitSentences(target).map((x) => x.trim());
  const b = splitSentences(back).map((x) => x.trim());
  if (s.length > 1 && s.length === t.length && s.length === b.length) {
    return s.map((x, i) => ({ source: x, target: t[i]!, back: b[i]! }));
  }
  return [{ source: source.trim(), target: target.trim(), back: back.trim() }];
}

export interface DiffToken {
  text: string;
  /** The other side has no matching word. */
  changed: boolean;
  /** A changed number (always worth a look). */
  number: boolean;
}

const keyOf = (word: string) => word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Same word, or the same stem of a long word ("results" / "result", "çalışmada" / "çalışmanın"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\p{N}/u.test(a) || /\p{N}/u.test(b)) return false;
  return a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6);
}

/** Longest common subsequence of word keys; marks the words outside it. */
function lcsMarks(a: string[], b: string[]): [boolean[], boolean[]] {
  const n = a.length;
  const m = b.length;
  const keepA = new Array<boolean>(n).fill(false);
  const keepB = new Array<boolean>(m).fill(false);
  if (n * m > 400_000) {
    // Very long paragraphs: a bag of words is enough to point at differences.
    const inB = new Set(b);
    const inA = new Set(a);
    a.forEach((w, i) => (keepA[i] = inB.has(w)));
    b.forEach((w, j) => (keepB[j] = inA.has(w)));
    return [keepA, keepB];
  }
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = sameWord(a[i]!, b[j]!)
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sameWord(a[i]!, b[j]!)) {
      keepA[i++] = true;
      keepB[j++] = true;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return [keepA, keepB];
}

function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0);
}

/** Words of the source and of the back-translation that the other side does not have. */
export function wordDiff(source: string, back: string): { source: DiffToken[]; back: DiffToken[] } {
  const ta = tokens(source);
  const tb = tokens(back);
  const wordsA = ta.map((t, i) => ({ i, key: keyOf(t) })).filter((w) => w.key);
  const wordsB = tb.map((t, i) => ({ i, key: keyOf(t) })).filter((w) => w.key);
  const [keepA, keepB] = lcsMarks(
    wordsA.map((w) => w.key),
    wordsB.map((w) => w.key),
  );
  const mark = (all: string[], words: { i: number; key: string }[], keep: boolean[]) => {
    const changed = new Set(words.filter((_, k) => !keep[k]).map((w) => w.i));
    return all.map((text, i) => ({
      text,
      changed: changed.has(i),
      number: changed.has(i) && /\p{N}/u.test(text),
    }));
  };
  return { source: mark(ta, wordsA, keepA), back: mark(tb, wordsB, keepB) };
}
