import { describe, expect, it } from 'vitest';
import { paragraphLanguage } from '../../src/core/detectLanguage';

describe('the language of a paragraph', () => {
  it('reads another writing system at once', () => {
    expect(paragraphLanguage('الكلمات المفتاحية: الشعر العربي، السيرة النبوية', 'en')).toBe('ar');
    expect(paragraphLanguage('این پژوهش نشان می‌دهد که', 'en')).toBe('fa');
    expect(paragraphLanguage('Результаты исследования показали, что', 'en')).toBe('ru');
    expect(paragraphLanguage('本研究の目的は', 'en')).toBe('ja');
  });

  it('tells an abstract in another language by its words', () => {
    expect(
      paragraphLanguage(
        'Bu çalışmada pandemi öncesi ve pandemi döneminde gençlerin fiziksel aktivite düzeyleri ile egzersiz motivasyonları karşılaştırılmıştır.',
        'en',
      ),
    ).toBe('tr');
    expect(
      paragraphLanguage(
        'The aim of this study is to compare the physical activity levels of young people before and during the pandemic.',
        'tr',
      ),
    ).toBe('en');
  });

  it('tells a language that is not offered as a source', () => {
    expect(
      paragraphLanguage(
        'Penelitian ini bertujuan untuk menganalisis pengaruh event marketing dan experiential marketing terhadap minat kunjungan ulang wisatawan di Opi Mall.',
        'en',
      ),
    ).toBe('id');
    expect(
      paragraphLanguage(
        'Aquest estudi analitza els canvis en la població i la seva relació amb els serveis públics de la ciutat.',
        'es',
      ),
    ).toBe('ca');
  });

  it('keeps close languages to the document’s', () => {
    expect(
      paragraphLanguage(
        'Studien visar att arbetsmiljön har förbättrats under det senaste decenniet och att det finns skillnader mellan branscherna.',
        'sv',
      ),
    ).toBeNull();
    expect(
      paragraphLanguage(
        'La planificación de la enseñanza sobre medidas de tendencia central es una tarea compleja para los profesores en formación.',
        'es',
      ),
    ).toBeNull();
  });

  it('leaves the source language, names, figures and formulas alone', () => {
    expect(
      paragraphLanguage(
        'The groups were similar in terms of mean age and of the scores they had.',
        'en',
      ),
    ).toBeNull();
    expect(paragraphLanguage('α β γ δ', 'en')).toBeNull();
    expect(paragraphLanguage('Smith J, Müller K, Özdemir A', 'en')).toBeNull();
    expect(paragraphLanguage('p < 0.05; n = 120', 'tr')).toBeNull();
  });
});
