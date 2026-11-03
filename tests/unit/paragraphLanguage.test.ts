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

describe('a paper in another language than the one given', () => {
  it('sends its short lines in the language of its paragraphs', async () => {
    const { translateSegments } = await import('../../src/core/pipeline/translate');
    const { createPseudoEngine } = await import('../../src/engines/pseudo');
    const pseudo = createPseudoEngine({ factor: 1, substitute: true });
    const sent: string[] = [];
    const engine = {
      ...pseudo,
      translate: (
        batch: Parameters<typeof pseudo.translate>[0],
        ctx: Parameters<typeof pseudo.translate>[1],
        signal: AbortSignal,
      ) => {
        for (const s of batch) sent.push(`${ctx.pair.source}: ${s.text}`);
        return pseudo.translate(batch, ctx, signal);
      },
    };
    const body =
      'Penelitian ini bertujuan untuk menganalisis pengaruh pemasaran terhadap minat kunjungan ulang wisatawan di kota ini.';
    await translateSegments({
      engine,
      segments: [
        ...[1, 2, 3, 4, 5, 6].map((k) => ({ id: `p${k}`, text: body, role: 'body' as const })),
        {
          id: 'label',
          text: '1 = sangat tidak dikenal; 5 = sangat dikenal',
          role: 'table-cell' as const,
        },
      ],
      ctx: { pair: { source: 'en', target: 'tr' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(sent).toContain('id: 1 = sangat tidak dikenal; 5 = sangat dikenal');
  });
});

describe('a label of one word', () => {
  it('is read in the sense of the sentence after it', async () => {
    const { translateSegments } = await import('../../src/core/pipeline/translate');
    const { createPseudoEngine } = await import('../../src/engines/pseudo');
    const pseudo = createPseudoEngine({ factor: 1, substitute: false });
    const answers: Record<string, string> = {
      KUR: 'CURE',
      'Geliştirici paketi kurar; bağımlılıklar otomatik iner.':
        'The developer installs the package; dependencies are downloaded automatically.',
      'Kur: Geliştirici paketi kurar; bağımlılıklar otomatik iner.':
        'Installation: The developer installs the package; dependencies are downloaded automatically.',
    };
    const engine = {
      ...pseudo,
      translate: (batch: Parameters<typeof pseudo.translate>[0]) =>
        Promise.resolve(batch.map((s) => ({ id: s.id, text: answers[s.text] ?? s.text }))),
    };
    const outcomes = await translateSegments({
      engine,
      segments: [
        { id: 'label', text: 'KUR', role: 'label' },
        {
          id: 'body',
          text: 'Geliştirici paketi kurar; bağımlılıklar otomatik iner.',
          role: 'body',
        },
      ],
      ctx: { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(outcomes[0]!.text).toBe('INSTALLATION');
  });
});
