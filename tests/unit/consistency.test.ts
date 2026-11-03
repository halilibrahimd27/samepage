import { describe, expect, it } from 'vitest';
import { confirmVariance, termVariance } from '../../src/core/glossary/consistency';

/** A paper's paragraphs: the term in eight, rendered one way in five and another in three. */
function paper() {
  const pairs: { id: string; source: string; target: string }[] = [];
  const agree = [
    [
      'We compare feature selection methods on six datasets.',
      'Altı veri kümesinde öznitelik seçimi yöntemlerini karşılaştırıyoruz.',
    ],
    [
      'Feature selection removes redundant inputs early.',
      'Öznitelik seçimi gereksiz girdileri erkenden çıkarır.',
    ],
    [
      'The cost of feature selection grows with the sample.',
      'Öznitelik seçiminin maliyeti örneklemle birlikte artar.',
    ],
    [
      'After feature selection the classifier is retrained.',
      'Öznitelik seçiminden sonra sınıflandırıcı yeniden eğitilir.',
    ],
    [
      'Stable feature selection matters for clinicians.',
      'Kararlı öznitelik seçimi klinisyenler için önemlidir.',
    ],
  ];
  const differ = [
    [
      'Our feature selection keeps eleven variables.',
      'Bizim özellik seçimimiz on bir değişkeni tutar.',
    ],
    [
      'Without feature selection accuracy drops sharply.',
      'Özellik seçimi olmadan doğruluk keskin biçimde düşer.',
    ],
    ['Feature selection was repeated in each fold.', 'Özellik seçimi her katmanda tekrarlandı.'],
  ];
  for (const [source, target] of [...agree, ...differ])
    pairs.push({ id: `p${pairs.length}`, source: source!, target: target! });
  const filler = [
    ['The hospital records cover twelve years.', 'Hastane kayıtları on iki yılı kapsıyor.'],
    [
      'Patients were enrolled between spring and autumn.',
      'Hastalar ilkbahar ile sonbahar arasında kaydedildi.',
    ],
    ['Missing values were imputed by the median.', 'Eksik değerler medyanla tamamlandı.'],
    ['Ethics approval was granted by the board.', 'Etik onay kurul tarafından verildi.'],
    [
      'Three nurses annotated every discharge letter.',
      'Üç hemşire her taburcu mektubunu işaretledi.',
    ],
    ['Code and data are available on request.', 'Kod ve veriler istek üzerine sağlanır.'],
    ['Limitations are discussed in the last section.', 'Sınırlılıklar son bölümde tartışılıyor.'],
    ['Funding came from a regional programme.', 'Finansman bölgesel bir programdan geldi.'],
    ['Results agree with an earlier cohort.', 'Sonuçlar daha önceki bir kohortla uyumludur.'],
    [
      'The authors declare no conflict of interest.',
      'Yazarlar çıkar çatışması olmadığını beyan eder.',
    ],
    ['Statistical tests were two-sided.', 'İstatistiksel testler iki yönlüydü.'],
    ['Figures were drawn with open software.', 'Şekiller açık yazılımla çizildi.'],
  ];
  for (const [source, target] of filler)
    pairs.push({ id: `p${pairs.length}`, source: source!, target: target! });
  // The rest of a paper: the term in a few of its paragraphs, not in a third of them.
  for (let k = 1; k <= 20; k++)
    pairs.push({
      id: `p${pairs.length}`,
      source: `Table ${k} lists the measurements of ward ${k}.`,
      target: `Tablo ${k}, ${k}. servisin ölçümlerini listeler.`,
    });
  return pairs;
}

describe('term consistency', () => {
  it('finds a term rendered two ways, with the paragraphs of each', () => {
    const [found] = termVariance(paper(), 'en', 'tr').filter((v) => v.term === 'feature selection');
    expect(found).toMatchObject({
      rendering: 'öznitelik seçimi',
      instead: 'özellik seçimi',
      agree: ['p0', 'p1', 'p2', 'p3', 'p4'],
      differ: ['p5', 'p6', 'p7'],
    });
  });

  it('leaves out a term the glossary already renders', () => {
    const glossary = [{ source: 'Feature selection', target: 'öznitelik seçimi' }];
    expect(termVariance(paper(), 'en', 'tr', glossary).map((v) => v.term)).not.toContain(
      'feature selection',
    );
  });

  it('shows a term only when the engine confirms both renderings', async () => {
    const candidates = termVariance(paper(), 'en', 'tr');
    const confirmed = await confirmVariance(candidates, 'en', 'tr', {
      forward: (texts) =>
        Promise.resolve(texts.map((t) => (t === 'feature selection' ? 'Özellik seçimi' : ''))),
      back: (texts) =>
        Promise.resolve(texts.map((t) => (/seçimi/u.test(t) ? 'feature selection' : 'other'))),
    });
    expect(confirmed.map((v) => v.term)).toEqual(['feature selection']);
    // The engine's own translation of the term is the form for the glossary.
    expect(confirmed[0]!.instead).toBe('özellik seçimi');
    // A phrase that only happened to come with the term, unlike the engine's translation of it.
    const unrelated = await confirmVariance(candidates, 'en', 'tr', {
      forward: (texts) => Promise.resolve(texts.map(() => 'hastane kayıtları')),
      back: (texts) => Promise.resolve(texts.map(() => 'hospital records')),
    });
    expect(unrelated).toEqual([]);
  });
});
