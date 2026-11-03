import type { GlossaryEntry } from '../validate/validate';

/**
 * Term consistency after a translation: a term that recurs in the source is usually rendered one
 * way, and the paragraphs that lack its usual rendering may say it another way ("feature" as
 * "öznitelik" here, "özellik" there). Candidates come from the text alone: the rendering is the
 * phrase of the translation that comes with the term far more often than without it, the other
 * one a phrase the differing paragraphs share. The engine then confirms both are renderings of
 * the term (`confirmVariance`). Nothing changes until the user makes one a glossary entry.
 */

/** A paragraph and its translation (plain text). */
export interface TermPair {
  id: string;
  source: string;
  target: string;
}

export interface TermVariance {
  /** The term as the source writes it most often. */
  term: string;
  /** Its usual rendering, as the translation writes it most often. */
  rendering: string;
  /** Paragraphs that render it so. */
  agree: string[];
  /** Paragraphs with the term but without that rendering. */
  differ: string[];
  /** What the differing paragraphs have instead. */
  instead: string;
}

const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
/** Candidates for the engine to confirm, and terms shown. */
const CANDIDATES = 30;
const MAX_TERMS = 12;

/**
 * A word's stem for counting: its first six letters, so that endings do not part one word in two
 * ("öznitelikleri" | "öznitelik", "features" | "feature") while different words stay apart
 * ("bağımlılık" | "bağımsız").
 */
const stem = (w: string) => (w.length > 4 && /[^s]s$/u.test(w) ? w.slice(0, -1) : w).slice(0, 6);

/** Languages whose words take few endings: a term is its word without the plural. */
const FEW_ENDINGS = new Set(['en', 'fr', 'es', 'it', 'pt', 'nl', 'sv', 'id', 'ro', 'ca']);

/**
 * A source word's stem: in a language of few endings the word itself, singular ("documented" is
 * not "document", "documentation" neither); in others its first letters, as `stem`.
 */
function sourceStem(w: string, lang: string): string {
  if (!FEW_ENDINGS.has(lang)) return stem(w);
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /[^s]s$/u.test(w)) return w.slice(0, -1);
  return w;
}

interface Gram {
  key: string;
  surface: string;
  /** Words of the gram are content words at both ends. */
  size: number;
}

/** The text's words, lower-cased, with their stems (`source`: as a term of the source). */
function wordsOf(text: string, lang: string, source = false): { word: string; stem: string }[] {
  return [...text.matchAll(WORD)].map((m) => {
    const word = m[0].toLocaleLowerCase(lang);
    return { word, stem: source ? sourceStem(word, lang) : stem(word) };
  });
}

/**
 * Function words, from the text itself (any language): the stems in the most paragraphs (in a
 * quarter of them at least), short ones in many, and one or two letters.
 */
function functionWords(texts: { stem: string; word: string }[][]): Set<string> {
  const df = new Map<string, number>();
  for (const ws of texts)
    for (const s of new Set(ws.map((w) => w.stem))) df.set(s, (df.get(s) ?? 0) + 1);
  const ranked = [...df].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = new Set(
    ranked
      .slice(0, 30)
      .filter(([, n]) => n >= 0.25 * texts.length)
      .map(([s]) => s),
  );
  for (const [s, n] of ranked) if (s.length <= 4 && n >= 0.2 * texts.length) out.add(s);
  for (const ws of texts) for (const w of ws) if (w.word.length <= 2) out.add(w.stem);
  return out;
}

/** The phrases of one to three words of a text that start and end on a content word. */
function gramsOf(
  ws: { word: string; stem: string }[],
  functions: Set<string>,
  minUnigram: number,
): Map<string, Gram> {
  const out = new Map<string, Gram>();
  for (let i = 0; i < ws.length; i++) {
    if (functions.has(ws[i]!.stem) || /^\p{N}+$/u.test(ws[i]!.word)) continue;
    for (let n = 1; n <= 3 && i + n <= ws.length; n++) {
      const last = ws[i + n - 1]!;
      if (functions.has(last.stem) || /^\p{N}+$/u.test(last.word)) continue;
      if (n === 1 && ws[i]!.word.length < minUnigram) continue;
      const part = ws.slice(i, i + n);
      const key = part.map((w) => w.stem).join(' ');
      if (!out.has(key)) out.set(key, { key, surface: part.map((w) => w.word).join(' '), size: n });
    }
  }
  return out;
}

/** One word with other endings: a long common start ("kümesini" | "kümelerini"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k >= Math.max(4, Math.min(a.length, b.length) - 4);
}

const mostCommon = (forms: string[]) => {
  const n = new Map<string, number>();
  for (const f of forms) n.set(f, (n.get(f) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
};

/** The form without an ending, for a glossary entry: the shortest ("katılım", not "katılımı"). */
const baseForm = (forms: string[]) =>
  [...new Set(forms)].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]!;

/**
 * Terms of the source rendered one way in most paragraphs and not in others, the most telling
 * first: those with more differing paragraphs, then longer terms. Terms of the glossary are left
 * out (they are rendered as it says).
 */
export function termVariance(
  pairs: TermPair[],
  sourceLang: string,
  targetLang: string,
  glossary: GlossaryEntry[] = [],
): TermVariance[] {
  const src = pairs.map((p) => wordsOf(p.source, sourceLang, true));
  const tgt = pairs.map((p) => wordsOf(p.target, targetLang));
  const srcFunctions = functionWords(src);
  const tgtFunctions = functionWords(tgt);
  const srcGrams = src.map((ws) => gramsOf(ws, srcFunctions, 5));
  const tgtGrams = tgt.map((ws) => gramsOf(ws, tgtFunctions, 3));
  const known = glossary.map((g) =>
    wordsOf(g.source, sourceLang, true)
      .map((w) => w.stem)
      .join(' '),
  );

  // Where each phrase of the translation occurs.
  const tgtIndex = new Map<string, Set<number>>();
  tgtGrams.forEach((grams, i) => {
    for (const key of grams.keys()) {
      if (!tgtIndex.has(key)) tgtIndex.set(key, new Set());
      tgtIndex.get(key)!.add(i);
    }
  });
  const formsIn = (grams: Map<string, Gram>[], key: string, at: Iterable<number>) =>
    [...at].flatMap((i) => (grams[i]!.has(key) ? [grams[i]!.get(key)!.surface] : []));
  const surfaceIn = (grams: Map<string, Gram>[], key: string, at: Iterable<number>) =>
    mostCommon(formsIn(grams, key, at));

  // Where each term of the source occurs: in three paragraphs at least, not in most.
  const srcIndex = new Map<string, number[]>();
  srcGrams.forEach((grams, i) => {
    for (const key of grams.keys()) {
      if (!srcIndex.has(key)) srcIndex.set(key, []);
      srcIndex.get(key)!.push(i);
    }
  });
  const found: (TermVariance & { size: number; keys: [string, string]; score: number })[] = [];
  for (const [key, at] of srcIndex) {
    if (at.length < 3 || at.length > 0.5 * pairs.length) continue;
    if (known.some((k) => k === key || ` ${k} `.includes(` ${key} `))) continue;
    const size = srcGrams[at[0]!]!.get(key)!.size;
    if (size === 1 && at.length < 4) continue;
    // Renderings: phrases found with the term in most of its paragraphs and rarely without it
    // (Dice), the closest first. The closest may be a word both renderings share ("seçimi" of
    // "öznitelik seçimi" and "özellik seçimi"): the next one tells them apart.
    const with_ = new Map<string, number>();
    for (const i of at) for (const t of tgtGrams[i]!.keys()) with_.set(t, (with_.get(t) ?? 0) + 1);
    const renderings = [...with_]
      .filter(([, n]) => n >= 2 && n >= 0.5 * at.length)
      .map(([t, n]) => ({
        key: t,
        dice: (2 * n) / (at.length + tgtIndex.get(t)!.size),
        size: tgtGrams[at.find((i) => tgtGrams[i]!.has(t))!]!.get(t)!.size,
      }))
      .filter((r) => r.dice >= 0.5)
      .sort((a, b) => b.dice - a.dice || b.size - a.size || a.key.localeCompare(b.key))
      .slice(0, 5);
    for (const best of renderings) {
      // A name kept as it is ("Python" as "Python") is no term to render.
      if (best.key === key) break;
      // A paragraph agrees when it has the rendering's words, whatever their endings
      // ("veri kümesini" | "veri kümelerini").
      const rendering = surfaceIn(tgtGrams, best.key, at).split(' ');
      const has = (i: number) => rendering.every((r) => tgt[i]!.some((w) => sameWord(r, w.word)));
      const agreeAt = at.filter(has);
      const differAt = at.filter((i) => !has(i));
      if (differAt.length < 2 || agreeAt.length < differAt.length) continue;
      // What the differing paragraphs say instead: a phrase in two of them at least, in none of
      // the agreeing ones and hardly anywhere else, not the rendering with other endings.
      // Without one the term was only put another way (or left out of a shorter sentence).
      const counts = new Map<string, number>();
      for (const i of differAt)
        for (const t of tgtGrams[i]!.keys()) counts.set(t, (counts.get(t) ?? 0) + 1);
      const agreeing = new Set(agreeAt);
      const other = [...counts]
        .filter(([t, n]) => n >= 2 && tgtIndex.get(t)!.size <= differAt.length + 1)
        .filter(([t]) => ![...tgtIndex.get(t)!].some((i) => agreeing.has(i)))
        .map(([t, n]) => ({ t, n, words: surfaceIn(tgtGrams, t, differAt).split(' ') }))
        .filter((o) => !o.words.every((v) => rendering.some((r) => sameWord(r, v))))
        .sort((a, b) => b.n - a.n || b.words.length - a.words.length || a.t.localeCompare(b.t));
      if (
        !other.length ||
        (other.length > 1 &&
          other[0]!.n === other[1]!.n &&
          other[0]!.words.length === other[1]!.words.length)
      )
        continue;
      const instead = other[0]!;
      // How likely a real pair of renderings: the rendering close to the term, the other phrase
      // found with it alone, the two sharing a word ("öznitelik seçimi" | "özellik seçimi").
      const shared = instead.words.some((v) => rendering.some((r) => sameWord(r, v)));
      const score =
        best.dice +
        instead.n / tgtIndex.get(instead.t)!.size +
        instead.n / differAt.length +
        (shared ? 1 : 0) +
        (size > 1 ? 0.5 : 0);
      found.push({
        term: baseForm(formsIn(srcGrams, key, at)),
        rendering: baseForm(formsIn(tgtGrams, best.key, agreeAt)),
        agree: agreeAt.map((i) => pairs[i]!.id),
        differ: differAt.map((i) => pairs[i]!.id),
        instead: baseForm(formsIn(tgtGrams, instead.t, differAt)),
        size,
        keys: [key, best.key],
        score,
      });
      break;
    }
  }
  // A shorter term inside a longer one that differs in the same paragraphs says nothing more.
  const kept = found.filter(
    (f) =>
      !found.some(
        (g) =>
          g !== f &&
          g.size > f.size &&
          ` ${g.keys[0]} `.includes(` ${f.keys[0]} `) &&
          f.differ.every((id) => g.differ.includes(id)),
      ),
  );
  // The likeliest first, for the engine to confirm; shown by the paragraphs that differ.
  return kept
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .slice(0, CANDIDATES)
    .sort(
      (a, b) =>
        b.differ.length - a.differ.length ||
        b.size - a.size ||
        b.agree.length - a.agree.length ||
        a.term.localeCompare(b.term),
    )
    .map(({ size: _, keys: __, score: ___, ...v }) => v);
}

/** The engine's word on a term and its renderings. */
export interface TermAsk {
  /** Texts into the target language. */
  forward(texts: string[]): Promise<string[]>;
  /** Texts back into the source language; absent when the engine cannot. */
  back?(texts: string[]): Promise<string[]>;
}

/**
 * The candidates whose two renderings the engine confirms: each is the engine's own translation
 * of the term, or translates back to it. A phrase that only happened to come with the term in a
 * few paragraphs ("period" → "between") is neither.
 */
export async function confirmVariance(
  candidates: TermVariance[],
  sourceLang: string,
  targetLang: string,
  ask: TermAsk,
): Promise<TermVariance[]> {
  if (!candidates.length) return [];
  const forward = await ask.forward(candidates.map((c) => c.term));
  const back = ask.back
    ? await ask.back(candidates.flatMap((c) => [c.rendering, c.instead]))
    : candidates.flatMap(() => ['', '']);
  const words = (text: string | undefined, lang: string) =>
    wordsOf(text ?? '', lang)
      .map((w) => w.word)
      .filter((w) => w.length >= 4);
  // Every long word of one phrase is a word of the other, endings aside.
  const within = (a: string[], b: string[]) =>
    a.length > 0 && a.every((x) => b.some((y) => sameWord(x, y)));
  return candidates
    .filter((c, i) => {
      const term = words(c.term, sourceLang);
      const own = words(forward[i], targetLang);
      // A rendering is the engine's own translation of the term, or comes back as the term
      // and nothing more ("insan müzisyenler" comes back as "human musicians").
      const renders = (phrase: string, k: number) => {
        const back_ = words(back[k], sourceLang);
        return (
          within(words(phrase, targetLang), own) || (within(term, back_) && within(back_, term))
        );
      };
      return renders(c.rendering, 2 * i) && renders(c.instead, 2 * i + 1);
    })
    .slice(0, MAX_TERMS)
    .map((c) => {
      // The engine's translation of the term alone has no ending ("insanlar", not
      // "insanları"): the form a glossary entry takes, for the rendering it is.
      const i = candidates.indexOf(c);
      const own = forward[i]?.trim().toLocaleLowerCase(targetLang) ?? '';
      const ownWords = words(own, targetLang);
      if (!own || own.split(/\s+/u).length > 5) return c;
      if (within(words(c.rendering, targetLang), ownWords)) return { ...c, rendering: own };
      if (within(words(c.instead, targetLang), ownWords)) return { ...c, instead: own };
      return c;
    });
}
