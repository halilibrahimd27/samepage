import { describe, expect, it } from 'vitest';
import {
  abstractStart,
  findPaperParts,
  keywordList,
  wordCount,
  type DocParagraph,
} from '../../src/core/abstract';

const body = (text: string, extra: Partial<DocParagraph> = {}): DocParagraph => ({
  text,
  role: 'body',
  size: 10,
  page: 0,
  ...extra,
});
const heading = (text: string, extra: Partial<DocParagraph> = {}): DocParagraph =>
  body(text, { role: 'heading', ...extra });

const EN =
  'We study the effect of temperature on the strength of concrete that contains oyster shell ' +
  'powder. The results show that the strength decreases when the share of the powder is above ' +
  'ten percent, and that it is not affected below that.';
const EN2 =
  'In addition, we discuss the limits of the method and the ways in which it could be used in ' +
  'practice by engineers who design buildings near the sea.';
const TR =
  'Bu çalışmada sıcaklığın istiridye kabuğu tozu içeren betonun dayanımı üzerindeki etkisi ' +
  'incelenmiştir. Sonuçlar, tozun oranı yüzde onun üzerinde olduğunda dayanımın azaldığını ve ' +
  'bu oranın altında ise bir değişiklik olmadığını göstermektedir.';
const RU =
  'В работе исследуется влияние температуры на прочность бетона, который содержит порошок из ' +
  'раковин устриц. Результаты показывают, что прочность снижается, если доля порошка больше ' +
  'десяти процентов, и что она не меняется при меньшей доле.';

describe('abstract detection', () => {
  it('recognises abstract headings and inline abstracts in many languages', () => {
    expect(abstractStart('Abstract')).toBe('');
    expect(abstractStart('ÖZET')).toBe('');
    expect(abstractStart('Öz')).toBe('');
    expect(abstractStart('A B S T R A C T')).toBe('');
    expect(abstractStart('2. Zusammenfassung:')).toBe('');
    expect(abstractStart('Abstract—We propose a method.')).toBe('We propose a method.');
    expect(abstractStart('Аннотация. В работе исследуется')).toBe('В работе исследуется');
    expect(abstractStart('ABSTRACT This paper studies')).toBe('This paper studies');
    expect(abstractStart('Abstract algebra is a field of mathematics.')).toBeNull();
    expect(abstractStart('Summary statistics are given in Table 2.')).toBeNull();
  });

  it('reads keyword lists, one keyword per line included', () => {
    expect(keywordList({ text: 'Keywords: concrete; oyster shell' })).toBe(
      'concrete; oyster shell',
    );
    expect(keywordList({ text: 'Index Terms—deep learning, CNN' })).toBe('deep learning, CNN');
    expect(keywordList({ text: 'Anahtar Kelimeler: beton, sıcaklık' })).toBe('beton, sıcaklık');
    expect(keywordList({ text: 'Ключевые слова: бетон, температура' })).toBe('бетон, температура');
    expect(
      keywordList({
        text: 'Keywords Concrete Oyster shell Temperature',
        lines: ['Keywords', 'Concrete', 'Oyster shell', 'Temperature'],
      }),
    ).toBe('Concrete; Oyster shell; Temperature');
    expect(keywordList({ text: 'The key results are listed below.' })).toBeNull();
  });

  it('counts words as journals do', () => {
    expect(wordCount('Bu çalışmada  yüzde 10 — ve (n = 25).')).toBe(7);
  });

  it('finds title, abstract and keywords of a Springer-style paper', () => {
    const parts = findPaperParts(
      [
        body('Journal of Building Engineering 45 (2024) 1–12', { role: 'header', size: 8 }),
        heading('Oyster shell powder in structural concrete', { size: 16 }),
        body('Ayşe Yılmaz, John Smith and Maria Rossi', { size: 11 }),
        body('Department of Civil Engineering, Ege University, İzmir', { size: 9 }),
        heading('Abstract', { size: 11 }),
        body(EN),
        body(EN2),
        body('Keywords: concrete · oyster shell · temperature'),
        heading('1 Introduction', { size: 11 }),
        body('Concrete is the most used building material in the world today.'),
      ],
      'en',
    );
    expect(parts).toEqual({
      title: 'Oyster shell powder in structural concrete',
      abstract: [EN, EN2],
      keywords: 'concrete · oyster shell · temperature',
      lang: 'en',
      otherAbstracts: [],
    });
  });

  it('reads an IEEE inline abstract and index terms', () => {
    const parts = findPaperParts(
      [
        heading('Oyster Shell Powder in Structural Concrete', { size: 24 }),
        body('A. Yılmaz, J. Smith and M. Rossi', { size: 11 }),
        body(`Abstract—${EN}`, { size: 9 }),
        body('Index Terms—concrete, oyster shell, temperature', { size: 9 }),
        heading('I. INTRODUCTION'),
        body('Concrete is the most used building material in the world today.'),
      ],
      'en',
    );
    expect(parts?.title).toBe('Oyster Shell Powder in Structural Concrete');
    expect(parts?.abstract).toEqual([EN]);
    expect(parts?.keywords).toBe('concrete, oyster shell, temperature');
  });

  it('chooses the abstract in the source language of a bilingual DergiPark paper', () => {
    const paras = [
      heading('İstiridye kabuğu tozunun yapısal betonda kullanımı', { size: 14 }),
      body('Ayşe Yılmaz, Mehmet Kaya', { size: 10 }),
      heading('Öz'),
      body(TR),
      body('Anahtar Kelimeler: beton, istiridye kabuğu, sıcaklık'),
      heading('Oyster shell powder in structural concrete', { size: 14 }),
      heading('Abstract'),
      body(EN),
      body('Keywords: concrete, oyster shell, temperature'),
      heading('1. Giriş'),
      body('Beton bugün dünyada en çok kullanılan yapı malzemesidir.'),
    ];
    expect(findPaperParts(paras, 'tr')).toEqual({
      title: 'İstiridye kabuğu tozunun yapısal betonda kullanımı',
      abstract: [TR],
      keywords: 'beton, istiridye kabuğu, sıcaklık',
      lang: 'tr',
      otherAbstracts: ['en'],
    });
    expect(findPaperParts(paras, 'en')).toEqual({
      title: 'Oyster shell powder in structural concrete',
      abstract: [EN],
      keywords: 'concrete, oyster shell, temperature',
      lang: 'en',
      otherAbstracts: ['tr'],
    });
  });

  it('finds keywords before the abstract (Elsevier article info column)', () => {
    const parts = findPaperParts(
      [
        heading('Oyster shell powder in structural concrete', { size: 17 }),
        body('A R T I C L E I N F O', { role: 'label', size: 8 }),
        body('Keywords Concrete Oyster shell Temperature', {
          size: 8,
          lines: ['Keywords:', 'Concrete', 'Oyster shell', 'Temperature'],
        }),
        heading('A B S T R A C T', { size: 8 }),
        body(EN),
        heading('1. Introduction'),
      ],
      'en',
    );
    expect(parts?.keywords).toBe('Concrete; Oyster shell; Temperature');
    expect(parts?.abstract).toEqual([EN]);
  });

  it('reads a Russian inline abstract and skips page furniture inside it', () => {
    const parts = findPaperParts(
      [
        heading('Влияние температуры на прочность бетона', { size: 14 }),
        body(`Аннотация. ${RU}`),
        body('12', { role: 'page-number' }),
        body('Ключевые слова: бетон, температура, прочность'),
        heading('Введение'),
      ],
      'ru',
    );
    expect(parts).toMatchObject({
      title: 'Влияние температуры на прочность бетона',
      abstract: [RU],
      keywords: 'бетон, температура, прочность',
    });
  });

  it('returns null without an abstract, and works without font sizes (DOCX)', () => {
    expect(
      findPaperParts([heading('Symmetric polynomials'), body(EN), body(EN2)], 'en'),
    ).toBeNull();
    const docx = (text: string, role: DocParagraph['role'] = 'body'): DocParagraph => ({
      text,
      role,
    });
    expect(
      findPaperParts(
        [
          docx('Oyster shell powder in structural concrete', 'heading'),
          docx('Ayşe Yılmaz, John Smith'),
          docx('Abstract', 'heading'),
          docx(EN),
          docx('Keywords: concrete; oyster shell'),
        ],
        'en',
      ),
    ).toMatchObject({ title: 'Oyster shell powder in structural concrete', abstract: [EN] });
  });

  it('stops at the introduction when no heading separates it', () => {
    const parts = findPaperParts(
      [heading('Abstract'), body(EN), body('1. Introduction'), body(EN2)],
      'en',
    );
    expect(parts?.abstract).toEqual([EN]);
  });

  it('takes the unlabelled abstract before the keywords, past a side box', () => {
    const parts = findPaperParts(
      [
        heading('Oyster shell powder in structural concrete', { size: 14 }),
        body('Received 19.3.26, accepted 20.7.26.'),
        body(EN),
        body('1 University of Udine, Department of Economics', { role: 'label' }),
        body('E-mail: someone@example.org', { role: 'label' }),
        body('Keywords: concrete, oyster shell'),
        heading('1 Introduction'),
      ],
      'en',
    );
    expect(parts).toMatchObject({
      title: 'Oyster shell powder in structural concrete',
      abstract: [EN],
      keywords: 'concrete, oyster shell',
    });
  });

  it('splits unlabelled lead paragraphs before the introduction by language', () => {
    const paras = [
      heading('Binalarda bir kum ikamesi olarak istiridye kabuğu tozu ve beton', { size: 18 }),
      heading('Oyster shell powder as a substitute for the sand in concrete', { size: 18 }),
      heading('Ayşe Yılmaz, Bundesanstalt für Wasserbau', { size: 14 }),
      body(TR),
      body(EN),
      heading('1 Giriş', { size: 14 }),
    ];
    expect(findPaperParts(paras, 'tr')).toMatchObject({
      title: 'Binalarda bir kum ikamesi olarak istiridye kabuğu tozu ve beton',
      abstract: [TR],
      otherAbstracts: ['en'],
    });
    expect(findPaperParts(paras, 'en')).toMatchObject({
      title: 'Oyster shell powder as a substitute for the sand in concrete',
      abstract: [EN],
    });
  });

  it('keeps structured-abstract headings and skips side notes in smaller type', () => {
    const parts = findPaperParts(
      [
        heading('Oyster shell powder in structural concrete', { size: 16 }),
        heading('Abstract', { size: 14 }),
        heading('Background', { size: 11.5 }),
        body(EN),
        body('Citation: Yılmaz A (2026) Oyster shell powder. PLOS One 21(10): e0360759.', {
          size: 8,
        }),
        heading('Doreen Müller', { size: 12 }),
        heading('Results', { size: 11.5 }),
        body('Page 2 of 14 Yılmaz et al. BMC Public Health (2026) 26:102', { size: 8, page: 1 }),
        body('The strength decreased when the share of the powder was above ten percent and', {
          page: 1,
        }),
        body('(44.4% vs. 17.1%; P = 0.013).', { role: 'formula', page: 1 }),
        heading('Introduction', { size: 11, page: 1 }),
      ],
      'en',
    );
    expect(parts?.abstract).toEqual([
      'Background',
      EN,
      'Results',
      'The strength decreased when the share of the powder was above ten percent and (44.4% vs. 17.1%; P = 0.013).',
    ]);
  });

  it('joins keyword lines split by the layout', () => {
    const parts = findPaperParts(
      [
        heading('Öz'),
        body(TR),
        body('Anahtar kelimeler: Tek modlu statik itme analizi, Performans analizi, Deprem'),
        body('güvenliği.'),
        heading('Determining the Seismic Performance of a New Building', { size: 14 }),
      ],
      'tr',
    );
    expect(parts?.keywords).toBe(
      'Tek modlu statik itme analizi, Performans analizi, Deprem güvenliği.',
    );
    const label = findPaperParts(
      [
        heading('Öz'),
        body(TR),
        heading('Anahtar kelimeler', { size: 9 }),
        body('Kesirli Mertebeden', { size: 9 }),
        body('Pseudo Hiperbolik Denklem; Sonlu Fark Metodu; Nümerik', { size: 9 }),
        body('Çözüm; Kararlılık.', { size: 9 }),
        heading('Numerical Solutions of Fractional Equations', { size: 16 }),
      ],
      'tr',
    );
    expect(label?.keywords).toBe(
      'Kesirli Mertebeden Pseudo Hiperbolik Denklem; Sonlu Fark Metodu; Nümerik Çözüm; Kararlılık.',
    );
  });
});
