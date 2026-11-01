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
    // Names and figures kept in Latin letters in a Russian translation are no wrong script; the
    // source's own words left untranslated are.
    const ru = (s: string, t: string) =>
      validateTranslation({ source: s, target: t, sourceLang: 'en', targetLang: 'ru' }).map(
        (i) => i.code,
      );
    expect(
      ru(
        '(IW3C2), published under Creative Commons CC BY 4.0 License.',
        '(IW3C2), опубликовано под лицензией Creative Commons CC BY 4.0.',
      ),
    ).not.toContain('WRONG_LANGUAGE');
    expect(
      ru('(c) Pinterest — HR@10 on the test set', '(c) Pinterest — HR@10 на тестовом наборе'),
    ).not.toContain('WRONG_LANGUAGE');
    expect(ru('3.4 Fusion of GMF and MLP models', '3.4 Fusion of GMF and MLP models')).toContain(
      'WRONG_LANGUAGE',
    );
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
    // A small number the target writes in words, and a number word with no digits behind it.
    expect(
      validateTranslation({
        source: 'Ölçek 5 maddeden ve 2 alt boyuttan oluşmaktadır.',
        target: 'Die Skala besteht aus fünf Items und zwei Subdimensionen sowie drei Fragen.',
        sourceLang: 'tr',
        targetLang: 'de',
      }).filter((i) => i.code === 'NUMBER_MISMATCH'),
    ).toEqual([]);
    expect(
      validateTranslation({
        source: 'Ölçek 5 maddeden oluşmaktadır.',
        target: 'Die Skala besteht aus sechs Items.',
        sourceLang: 'tr',
        targetLang: 'de',
      }).map((i) => i.detail),
    ).toContain('missing 5');
    // "χ2" written "χ²", a year range written short, "null" and "eins".
    expect(
      validateTranslation({
        source:
          'Modelin χ2/sd değeri 1,17 olup 2013-2014 döneminde KMO değeri 0 ile 1 arasında değişmiştir.',
        target:
          'Der χ²/sd-Wert des Modells betrug 1,17; im Zeitraum 2013/14 lag der KMO-Wert zwischen null und eins.',
        sourceLang: 'tr',
        targetLang: 'de',
      }).filter((i) => i.code === 'NUMBER_MISMATCH'),
    ).toEqual([]);
    // "c.f. Theorem 3.1" ends no sentence: one sentence in, one out.
    expect(
      validateTranslation({
        source:
          'We propose a new inequality (c.f. Theorem 3.1), which implies additivity for phase-covariant channels (c.f. Theorem 4.2) and all qubit channels (c.f. Theorem 5.2).',
        target:
          'Faz-kovaryant kanallar (bkz. Teorem 4.2) ve tüm kübit kanalları (bkz. Teorem 5.2) için toplamsallığı ima eden yeni bir eşitsizlik (bkz. Teorem 3.1) öneriyoruz.',
        sourceLang: 'en',
        targetLang: 'tr',
      }).map((i) => i.code),
    ).not.toContain('SENTENCE_LOST');
    // A Roman numeral in Cyrillic look-alike letters.
    expect(
      codes(
        'Міграційні кризи спіткали Європейський континент у ХХІ столітті.',
        'Migration crises struck the European continent in the 21st century.',
        'uk',
      ),
    ).toEqual([]);
    // A date with its month in words.
    expect(
      codes(
        'Журнал включено до переліку наказом № 241 від 09.03.2016 р. та оновлено.',
        'The journal was included in the list by order No. 241 of 9 March 2016 and updated.',
        'uk',
      ),
    ).toEqual([]);
    expect(
      codes('Наказ від 09.03.2016 р. діє.', 'The order of 9 March 2018 is in force.', 'uk'),
    ).toEqual(['missing 2016; unexpected 2018']);
    // A decimal without its leading zero; a decade in words gains its century.
    expect(
      codes(
        'We evaluate mAP @ IoU = .5:.95 and report p < .05 for every model.',
        'Her model için mAP @ IoU = 0,5:0,95 değerlendiriyor ve p < 0,05 bildiriyoruz.',
        'en',
      ),
    ).toEqual([]);
    expect(
      codes(
        'Az angolszász szakirodalomban a negyvenes évektől terjed el a módszer.',
        'In the Anglo-Saxon literature the method spread from the 1940s onwards.',
        'hu',
      ),
    ).toEqual([]);
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

  it('notices a sentence the engine left out, not two sentences made one', () => {
    const codes = (source: string, target: string) =>
      validateTranslation({ source, target, sourceLang: 'en', targetLang: 'tr' }).map(
        (i) => i.code,
      );
    const source =
      'Smith et al. measured the effect in 2019. The results were significant (p < 0,01). ' +
      'However, the sample was small. Further work is needed. Fig. 2 shows the data.';
    expect(
      codes(
        source,
        'Smith ve ark. etkiyi 2019 yılında ölçtü. Sonuçlar anlamlıydı (p < 0,01). Şekil 2 verileri gösteriyor.',
      ),
    ).toContain('SENTENCE_LOST');
    expect(
      codes(
        source,
        'Smith ve ark. etkiyi 2019 yılında ölçtü ve sonuçlar anlamlıydı (p < 0,01). Ancak örneklem küçüktü. Daha fazla çalışma gerekiyor. Şekil 2 verileri gösteriyor.',
      ),
    ).not.toContain('SENTENCE_LOST');
    // A note of short pieces the engine joins is no lost sentence.
    expect(
      validateTranslation({
        source:
          'Paris Data. Données : Linéaire de voies. Consulté et téléchargé le 21 novembre 2021. Paris Data. Données : Dénominations des voies.',
        target:
          'Paris Verileri: Yol uzunluğu. 21 Kasım 2021 tarihinde erişildi ve indirildi. Paris Verileri: Yol adları.',
        sourceLang: 'fr',
        targetLang: 'tr',
      }).map((i) => i.code),
    ).not.toContain('SENTENCE_LOST');
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
