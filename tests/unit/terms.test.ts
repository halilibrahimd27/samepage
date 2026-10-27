import { describe, expect, it } from 'vitest';
import { suggestTerms } from '../../src/core/glossary/detect';
import { protectTerms } from '../../src/core/glossary/protect';

describe('glossary suggestions from the document', () => {
  const paragraphs = [
    {
      text: 'We scanned every package with bandit and safety before the analysis.',
      mono: ['bandit', 'safety', 'pip install -r requirements.txt', 'PyPI'],
    },
    { text: 'The bandit tool reports 12 issues; the Semgrep tool reports none.' },
    { text: 'The analysis tool and our proposed tool are described in Section 3.' },
    { text: 'Differences were statistically significant (95% confidence intervals).' },
    { text: 'A random forest and a support vector machine were trained on the test set.' },
    { text: 'The test settings are listed in Table 2.' },
  ];

  it('keeps code-font words and tool names, and offers field terms with translations', () => {
    const found = suggestTerms(paragraphs, 'en', 'tr');
    expect(found.map((s) => [s.source, s.target, s.reason])).toEqual([
      ['bandit', 'bandit', 'code'],
      ['safety', 'safety', 'code'],
      ['Semgrep', 'Semgrep', 'tool'],
      ['confidence interval', 'güven aralığı', 'stats'],
      ['statistically significant', 'istatistiksel olarak anlamlı', 'stats'],
      ['random forest', 'rastgele orman', 'cs'],
      ['support vector machine', 'destek vektör makinesi', 'cs'],
      ['test set', 'test kümesi', 'cs'],
    ]);
    expect(found.find((s) => s.source === 'bandit')?.count).toBe(2);
    // "test settings" is not the term "test set".
    expect(found.find((s) => s.source === 'test set')?.count).toBe(1);
  });

  it('leaves out terms already in the glossary and pairs without a known translation', () => {
    const found = suggestTerms(paragraphs, 'en', 'tr', [{ source: 'Bandit', target: 'bandit' }]);
    expect(found.some((s) => s.source === 'bandit')).toBe(false);
    expect(
      suggestTerms(paragraphs, 'en', 'uk').every((s) => s.reason === 'code' || s.reason === 'tool'),
    ).toBe(true);
  });

  it('finds Turkish terms with case endings', () => {
    const found = suggestTerms(
      [{ text: 'Makine öğrenmesinin ve derin öğrenmeye dayalı yöntemlerin karşılaştırması.' }],
      'tr',
      'en',
    );
    expect(found.map((s) => s.target)).toEqual(['deep learning', 'machine learning']);
  });
});

describe('glossary term protection', () => {
  it('does not take a longer word for the term outside agglutinative languages', () => {
    const glossary = [{ source: 'test set', target: 'test kümesi' }];
    expect(protectTerms('The test settings and the test sets.', glossary, 'en').text).toBe(
      'The test settings and the ⟦G1⟧.',
    );
    expect(
      protectTerms(
        'Test kümelerindeki sonuçlar',
        [{ source: 'test küme', target: 'test set' }],
        'tr',
      ).text,
    ).toBe('⟦G1⟧ sonuçlar');
  });
});
