import { tokenize } from './codec';

/**
 * Documents converted from PDF often keep the line-end hyphenation of the original inside the
 * words ("pack-ages", "ma-licious"); engines then translate the halves ("package ages"). A
 * hyphenated word is joined only when the joined form occurs elsewhere in the same document
 * ("packages"), so real compounds ("state-of-the-art", "machine-learning", "Mal-OSS") stay.
 */
const HYPHENATED = /(?<![\p{L}\p{N}\-‐])(\p{L}\p{Ll}+)[-‐](\p{Ll}{2,})(?![\p{L}\p{N}\-‐])/gu;
const WORD = /\p{L}+/gu;
/**
 * A soft hyphen (U+00AD) only marks where a word may break; PDFs keep it with the line break
 * ("po\u00ad tencjalnego", "be\u00ad währten"), and engines then translate two halves.
 */
const SOFT_HYPHEN = /\u00ad\s*(?=\p{L})|\u00ad/gu;

const textOf = (tagged: string) =>
  tokenize(tagged)
    .filter((t) => t.type === 'text')
    .map((t) => (t as { text: string }).text);

export interface Dehyphenator {
  (tagged: string): string;
}

export function createDehyphenator(documentTexts: string[]): Dehyphenator {
  const words = new Map<string, number>();
  const hyphenated = new Map<string, number>();
  const add = (map: Map<string, number>, w: string) => map.set(w, (map.get(w) ?? 0) + 1);
  for (const tagged of documentTexts) {
    for (const text of textOf(tagged)) {
      const plain = text
        .replace(SOFT_HYPHEN, '')
        .replace(HYPHENATED, (_w, a: string, b: string) => {
          add(hyphenated, (a + b).toLowerCase());
          return ' ';
        });
      for (const w of plain.matchAll(WORD)) add(words, w[0].toLowerCase());
    }
  }
  // Joined when the document writes the word whole at least as often ("sub-layer" six times and
  // "sublayer(x)" once stays "sub-layer").
  const whole = (a: string, b: string) => {
    const key = (a + b).toLowerCase();
    return (words.get(key) ?? 0) >= Math.max(1, hyphenated.get(key) ?? 0);
  };
  return (tagged) =>
    tokenize(tagged)
      .map((t) => {
        if (t.type === 'text') {
          return t.text
            .replace(SOFT_HYPHEN, '')
            .replace(HYPHENATED, (hyphen, a: string, b: string) => (whole(a, b) ? a + b : hyphen));
        }
        if (t.type === 'ph') return `⟦${t.id}⟧`;
        return t.type === 'open' ? `<${t.id}>` : `</${t.id}>`;
      })
      .join('');
}
