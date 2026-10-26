import { describe, expect, it } from 'vitest';
import { backTranslationFindings, compareMeaning } from '../../src/core/validate/meaning';

const issues = (source: string, back: string, lang: string) =>
  compareMeaning(source, back, lang).map((f) => `${f.severity}: ${f.issue.split(':')[0]}`);

describe('back-translation meaning check', () => {
  it('flags lost negation, hedging and changed quantifiers in English', () => {
    expect(
      issues(
        'These results suggest that the method may improve accuracy in most cases.',
        'These results show that the method improves accuracy in all cases.',
        'en',
      ),
    ).toEqual(['major: hedging lost', 'major: quantifier changed']);
    expect(
      issues(
        'The model did not converge after 100 epochs.',
        'The model converged after 100 epochs.',
        'en',
      ),
    ).toEqual(['major: negation lost']);
  });

  it('catches a hedged finding stated as fact (ensemble-learning paper, Google)', () => {
    expect(
      issues(
        'The results suggest that our approach effectively detects a considerable number of malicious packages.',
        'The results reveal that our approach effectively detects a significant number of malicious packages.',
        'en',
      ),
    ).toEqual(['major: hedging lost']);
  });

  it('accepts paraphrases that keep the meaning', () => {
    expect(
      issues(
        'The model failed to converge within 100 epochs of training.',
        'The model did not converge within 100 epochs of training.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'This approach may be applied to all datasets considered here.',
        'This approach can be applied to every dataset considered here.',
        'en',
      ),
    ).toEqual([]);
    // Real cases from papers: a proposal is not a hedge, "a few" is "some", lexical negation.
    expect(
      issues(
        'Several methods such as bandit have been suggested for detecting suspicious packages.',
        'Several methods such as bandit have been proposed for detecting suspicious packages.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'Moreover, a few of metadata-related features are explored in this context.',
        'In addition, some metadata-related features were examined in this context.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'It is impractical, even infeasible, to manually extract information at this scale.',
        'Manually extracting information at this scale is impractical, even impossible.',
        'en',
      ),
    ).toEqual([]);
    expect(
      issues(
        'The package is missing license type uniformity in the three core positions.',
        'The package does not provide standardization of license types in the three main positions.',
        'en',
      ),
    ).toEqual([]);
    // Too short to judge (headings, table cells).
    expect(issues('Not significant', 'Significant', 'en')).toEqual([]);
  });

  it('reads Turkish negation and hedging suffixes, not names or nouns', () => {
    expect(
      issues(
        'Bu sonuçlar yöntemin doğruluğu artırabileceğini göstermektedir.',
        'Bu sonuçlar yöntemin doğruluğu artırdığını göstermektedir.',
        'tr',
      ),
    ).toEqual(['major: hedging lost']);
    expect(
      issues(
        'Model 100 epoktan sonra bile yakınsamadı.',
        'Model 100 epoktan sonra bile yakınsadı.',
        'tr',
      ),
    ).toEqual(['major: negation lost']);
    expect(
      issues(
        'Yılmaz ve arkadaşları bu denemede yeni bir yöntem önerdi.',
        'Yılmaz ve arkadaşları bu denemede yeni bir yöntem önerdi.',
        'tr',
      ),
    ).toEqual([]);
  });

  it('attaches the back-translation to each finding', () => {
    const findings = backTranslationFindings(
      [{ id: 's1', source: 'The effect was <t1>not</t1> significant in ⟦F1⟧ cases.', target: '…' }],
      ['The effect was significant in these cases.'],
      'en',
    );
    expect(findings).toEqual([
      {
        id: 's1',
        issue: 'negation lost',
        severity: 'major',
        backTranslation: 'The effect was significant in these cases.',
      },
    ]);
  });
});
