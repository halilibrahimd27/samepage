import { describe, expect, it } from 'vitest';
import { candidateValues, compareNumbers } from '../../src/core/validate/numbers';
import { validateTranslation, type ValidateInput } from '../../src/core/validate/validate';

const codes = (input: Partial<ValidateInput> & Pick<ValidateInput, 'source' | 'target'>) =>
  validateTranslation({ sourceLang: 'tr', targetLang: 'en', ...input }).map((i) => i.code);

describe('number matching', () => {
  it('accepts every valid locale interpretation', () => {
    expect(candidateValues('3,5')).toEqual([3.5]);
    expect(candidateValues('1.000')).toEqual(expect.arrayContaining([1, 1000]));
    expect(candidateValues('1.234,56')).toEqual([1234.56]);
    expect(candidateValues('1 234 567')).toEqual([1234567]);
    expect(candidateValues('2020')).toEqual([2020]);
  });

  it('matches tr ↔ en formats and reports changed values', () => {
    expect(
      compareNumbers('oran %12,5 ve 1.250 kişi (2020)', 'rate 12.5% and 1,250 people (2020)'),
    ).toEqual({
      missing: [],
      extra: [],
    });
    expect(compareNumbers('3,5 mg', '35 mg')).toEqual({ missing: ['3,5'], extra: ['35'] });
  });
});

describe('validateTranslation', () => {
  const source = 'Bu çalışmada <t1>yeni</t1> bir yöntem ⟦F1⟧ önerilmiştir [12].';

  it('passes a faithful translation', () => {
    expect(
      codes({ source, target: 'In this study a <t1>new</t1> method ⟦F1⟧ is proposed [12].' }),
    ).toEqual([]);
  });

  it('flags structural, numeric, citation and language problems', () => {
    expect(
      codes({ source, target: 'In this study a new method ⟦F1⟧ is proposed [12].' }),
    ).toContain('TAG_MISMATCH');
    expect(
      codes({ source, target: 'In this study a <t1>new</t1> method is proposed [12].' }),
    ).toContain('PLACEHOLDER_MISMATCH');
    expect(
      // Citations are checked as citations (not again as numbers).
      codes({ source, target: 'In this study a <t1>new</t1> method ⟦F1⟧ is proposed [13].' }),
    ).toContain('CITATION_MISMATCH');
    expect(codes({ source, target: source })).toContain('UNTRANSLATED');
    expect(
      codes({
        source,
        target: 'В этом исследовании предложен <t1>новый</t1> метод ⟦F1⟧ [12].',
        targetLang: 'en',
      }),
    ).toContain('WRONG_LANGUAGE');
    expect(
      codes({ source, target: 'Here is the translation: a <t1>new</t1> method ⟦F1⟧ [12].' }),
    ).toContain('CHATTER');
    expect(codes({ source, target: '' })).toEqual(['EMPTY']);
  });

  it('does not read citation spacing or placeholders as changed numbers', () => {
    const codes = (source: string, target: string) =>
      validateTranslation({ source, target, sourceLang: 'en', targetLang: 'tr' }).map(
        (i) => i.code,
      );
    expect(
      codes(
        'This is a stalled effort [3,5] in the housing sector of the country.',
        'Bu, ülkenin konut sektöründe durmuş bir çabadır [3, 5].',
      ),
    ).not.toContain('NUMBER_MISMATCH');
    expect(
      codes(
        'Six sensors with 2048⟦F1⟧ 2448 pixels resolution are used here.',
        'Burada 2048 ⟦F1⟧ 2448 piksel çözünürlüklü altı sensör kullanılır.',
      ),
    ).not.toContain('NUMBER_MISMATCH');
  });

  it('accepts sentences that start with "below" and formulas in math letters', () => {
    const codes = (source: string, target: string, sourceLang = 'en', targetLang = 'tr') =>
      validateTranslation({ source, target, sourceLang, targetLang }).map((i) => i.code);
    expect(
      codes(
        'The pseudo-code of the random graph generator is given below.',
        'Aşağıda rastgele grafik üretecinin sözde kodu verilmiştir.',
      ),
    ).toEqual([]);
    expect(codes('Some text here to translate.', 'Aşağıdaki çeviri: Bir metin.')).toContain(
      'CHATTER',
    );
    expect(codes('𝑝(𝑔) log 𝑝(𝑔) where 𝑔 ∈ 𝒢 (2.1)', '𝑝(𝑔) log 𝑝(𝑔) burada 𝑔 ∈ 𝒢 (2.1)')).toEqual(
      [],
    );
  });

  it('warns when a glossary term is not used', () => {
    const issues = validateTranslation({
      source: 'Derin öğrenme modelleri incelenmiştir.',
      target: 'Deep neural models were examined.',
      sourceLang: 'tr',
      targetLang: 'en',
      glossary: [{ source: 'derin öğrenme', target: 'deep learning' }],
    });
    expect(issues).toEqual([
      expect.objectContaining({ code: 'GLOSSARY_MISMATCH', severity: 'warning' }),
    ]);
  });
});
