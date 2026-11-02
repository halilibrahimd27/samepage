import { describe, expect, it } from 'vitest';
import { checkByBackTranslation } from '../../src/engines/chromeBuiltin';
import type { LangPair } from '../../src/engines/types';

/** A translator that knows a few sentences, each language pair apart. */
const bridge = (known: Record<string, Record<string, string>>) => ({
  availability: () => Promise.resolve('available' as const),
  translate: (pair: LangPair, texts: string[]) =>
    Promise.resolve(texts.map((t) => known[`${pair.source}>${pair.target}`]?.[t] ?? t)),
  backTranslate: (pair: LangPair, texts: string[]) =>
    Promise.resolve(texts.map((t) => known[`${pair.source}>${pair.target}`]?.[t] ?? t)),
});

const ctx = {
  pair: { source: 'de', target: 'tr' },
  glossary: [],
  numberLocalization: false,
};
const signal = new AbortController().signal;

describe('the meaning check asks again in English', () => {
  const paraphrase = {
    id: 'p1',
    source: 'Die Studie zeigt, dass externe Werkzeuge in diesem Fall entfallen.',
    target: 'Çalışma, bu durumda harici araçlara artık ihtiyaç duyulmadığını gösteriyor.',
  };
  const lost = {
    id: 'p2',
    source: 'Die Methode ist in dieser Form nicht zuverlässig genug.',
    target: 'Yöntem bu haliyle yeterince güvenilirdir.',
  };
  const known = {
    'tr>de': {
      [paraphrase.target]:
        'Die Studie zeigt, dass externe Werkzeuge in diesem Fall nicht mehr benötigt werden.',
      [lost.target]: 'Die Methode ist in dieser Form zuverlässig genug.',
    },
    'de>en': {
      [paraphrase.source]: 'The study shows that external tools are no longer needed in this case.',
      [lost.source]: 'The method is not reliable enough in this form.',
    },
    'tr>en': {
      [paraphrase.target]: 'The study shows that external tools are no longer needed in this case.',
      [lost.target]: 'The method is reliable enough in this form.',
    },
  };

  it('drops a finding the English versions do not share, keeps one they do', async () => {
    const { findings } = await checkByBackTranslation(
      bridge(known),
      [paraphrase, lost],
      ctx,
      signal,
    );
    expect(findings.map((f) => [f.id, f.issue])).toEqual([['p2', 'negation lost']]);
  });

  it('keeps the findings when the English versions cannot be had', async () => {
    const { findings } = await checkByBackTranslation(
      {
        ...bridge(known),
        backTranslate: (pair, texts) =>
          pair.target === 'en' ? Promise.resolve(null) : bridge(known).backTranslate(pair, texts),
      },
      [paraphrase, lost],
      ctx,
      signal,
    );
    expect(findings.map((f) => f.id).sort()).toEqual(['p1', 'p2']);
  });
});
