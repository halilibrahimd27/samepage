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

  it('flags a percent sign moved off its number', () => {
    const codes = (source: string, target: string) =>
      validateTranslation({ source, target, sourceLang: 'en', targetLang: 'tr' }).map(
        (i) => i.code,
      );
    const source = 'While 81% of the packages use hooks, only 5% and 1% do so, respectively.';
    expect(
      codes(
        source,
        "Süre 81npm'de paketlerin yüzdesi kanca kullanır, yalnızca 5% ve 1sırasıyla %.",
      ),
    ).toContain('NUMBER_MISMATCH');
    // Percentage points written as points are no lost percent sign.
    expect(
      validateTranslation({
        source: 'Mit 55,8 % liegt dieser Anteil fast 15 Prozentpunkte über der Studie (40,4 %).',
        target: '%55,8 ile bu oran, çalışmanın (%40,4) neredeyse 15 puan üzerindedir.',
        sourceLang: 'de',
        targetLang: 'tr',
      }).map((i) => i.code),
    ).not.toContain('NUMBER_MISMATCH');
    // Turkish order, a space or the word are all a percentage.
    expect(
      codes(source, 'Paketlerin %81’i kanca kullanırken yalnızca 5 % ve yüzde 1 bunu yapar.'),
    ).not.toContain('NUMBER_MISMATCH');
  });

  it('warns when brackets are lost or sentences run together', () => {
    const codes = (source: string, target: string) =>
      validateTranslation({ source, target, sourceLang: 'de', targetLang: 'en' }).map(
        (i) => i.code,
      );
    const source =
      'Der Unterschied ist signifikant (p < 0,01). Maschinelle Systeme sind schneller.';
    expect(
      codes(source, 'The difference is significant.p < 0,01Machine systems are faster.'),
    ).toContain('PUNCTUATION_CHANGED');
    expect(
      codes(source, 'The difference is significant (p < 0,01). Machine systems are faster.'),
    ).not.toContain('PUNCTUATION_CHANGED');
    // A plural in brackets becomes a plain plural.
    expect(
      validateTranslation({
        source: 'Usage of installation hook(s)',
        target: 'Kurulum kancalarının kullanımı',
        sourceLang: 'en',
        targetLang: 'tr',
      }).map((i) => i.code),
    ).not.toContain('PUNCTUATION_CHANGED');
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

  it('accepts passages already in the target language and foreign names', () => {
    const codes = (source: string, target: string, sourceLang: string, targetLang: string) =>
      validateTranslation({ source, target, sourceLang, targetLang }).map((i) => i.code);
    const english =
      'The paper concludes that this approach contributes to transparency in the city.';
    expect(codes(english, english, 'cs', 'en')).toEqual([]);
    // An address keeps its words; it is reported as kept, not as a failure.
    const address = '2 HPL Consulting, 4 rue du Fer à Cheval, 78100 Saint-Germain-en-Laye, France';
    expect(
      validateTranslation({
        source: address,
        target: address,
        sourceLang: 'fr',
        targetLang: 'en',
      }).map((i) => i.severity),
    ).toEqual(['info']);
    expect(
      codes(
        'HUDEČEK, Tomáš; DLOUHÝ, Martin. Hustota a struktura zástavby města.',
        'HUDEČEK, Tomáš; DLOUHÝ, Martin. Density and structure of the city fabric.',
        'cs',
        'en',
      ),
    ).toEqual([]);
  });

  it('reads spaces between numbers as thousands only before three digits, and Roman numerals', () => {
    const codes = (source: string, target: string) =>
      validateTranslation({ source, target, sourceLang: 'it', targetLang: 'en' }).map(
        (i) => i.code,
      );
    expect(
      codes(
        'Forest @ (2019) 16: 3-9   5 della rivista',
        'Forest @ (2019) 16: 3-9 5 of the journal',
      ),
    ).toEqual([]);
    expect(
      codes('Il costo è di 12 500 euro per ettaro.', 'The cost is 12,500 euros per hectare.'),
    ).toEqual([]);
    expect(
      codes(
        'Dalla fine del secolo XX sono state proposte formule.',
        'Since the end of the 20th century formulas have been proposed.',
      ),
    ).toEqual([]);
    expect(
      validateTranslation({
        source: 'Deux projets de délibération dans le XIe et le XVIIIe arrondissement.',
        target: '11. ve 18. bölgedeki iki taslak karar.',
        sourceLang: 'fr',
        targetLang: 'tr',
      }).map((i) => i.code),
    ).toEqual([]);
    expect(
      validateTranslation({
        source: 'Στην Α’ Γυμνασίου και στην Γ’ τάξη οι μαθητές μαθαίνουν τον αλγόριθμο.',
        target:
          'In the 1st grade of middle school and in the 3rd class students learn the algorithm.',
        sourceLang: 'el',
        targetLang: 'en',
      }).map((i) => i.code),
    ).toEqual([]);
  });

  it('accepts numbers written in words and thin-space thousands, per source language', () => {
    const codes = (source: string, target: string, sourceLang: string) =>
      validateTranslation({ source, target, sourceLang, targetLang: 'en' })
        .filter((i) => i.code === 'NUMBER_MISMATCH')
        .map((i) => i.detail);
    expect(
      codes(
        'A betegek négy csoportba sorolhatók a vizsgálatban.',
        'Patients can be divided into 4 groups in the study.',
        'hu',
      ),
    ).toEqual([]);
    expect(
      codes(
        'Teplota plazmatu (1 eV ~ 11\u2009604 K) je vysoká v tokamaku.',
        'Plasma temperature (1 eV ~ 11 604 K) is high in the tokamak.',
        'cs',
      ),
    ).toEqual([]);
    expect(
      codes(
        'V devadesátých letech se začal nitazen objevovat na trhu.',
        'In the 1990s nitazene began to appear on the market.',
        'cs',
      ),
    ).toEqual([]);
    expect(
      codes(
        'Kemény Péter: J. Chem. Phys. 2004, 121, 11599 Ref. 36      617 hivatkozás',
        'Péter Kemény: J. Chem. Phys. 2004, 121, 11599 Ref. 36 617 citations',
        'hu',
      ),
    ).toEqual([]);
    expect(
      codes(
        'A 90-es években a kvantumkémia gyorsan fejlődött.',
        'In the 1990s quantum chemistry developed rapidly.',
        'hu',
      ),
    ).toEqual([]);
    expect(
      codes(
        'La segunda transcurrió entre la década de los noventa y el siglo XXI.',
        'The second ran from the 1990s to the 21st century.',
        'es',
      ),
    ).toEqual([]);
    // A stray number is still reported ("on" is not a number word in English).
    expect(
      codes(
        'The effect depends on the dose given to the patients.',
        'The effect depends on the 10 doses given to the patients.',
        'en',
      ),
    ).toEqual(['unexpected 10']);
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
