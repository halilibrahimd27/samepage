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
  const words = new Set<string>();
  for (const tagged of documentTexts) {
    for (const text of textOf(tagged)) {
      const plain = text.replace(SOFT_HYPHEN, '').replace(HYPHENATED, ' ');
      for (const w of plain.matchAll(WORD)) words.add(w[0].toLowerCase());
    }
  }
  return (tagged) =>
    tokenize(tagged)
      .map((t) => {
        if (t.type === 'text') {
          return t.text
            .replace(SOFT_HYPHEN, '')
            .replace(HYPHENATED, (whole, a: string, b: string) =>
              words.has((a + b).toLowerCase()) ? a + b : whole,
            );
        }
        if (t.type === 'ph') return `⟦${t.id}⟧`;
        return t.type === 'open' ? `<${t.id}>` : `</${t.id}>`;
      })
      .join('');
}
