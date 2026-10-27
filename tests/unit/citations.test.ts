import { describe, expect, it } from 'vitest';
import { localizeEtAl } from '../../src/core/glossary/citations';

describe('et al. in citations', () => {
  it('uses the target form in author–year and numbered citations', () => {
    expect(
      localizeEtAl('Smith et al. (2020) ve (Yılmaz ve diğerleri, 2019) bulmuştur.', 'tr'),
    ).toBe('Smith vd. (2020) ve (Yılmaz vd., 2019) bulmuştur.');
    expect(localizeEtAl('Как показали Smith et al. [12], метод устойчив.', 'ru')).toBe(
      'Как показали Smith и др. [12], метод устойчив.',
    );
    expect(localizeEtAl('As Yılmaz vd. (2021) and (Kaya and others 2018b) show.', 'en')).toBe(
      'As Yılmaz et al. (2021) and (Kaya et al. 2018b) show.',
    );
  });

  it('leaves the words alone outside citations', () => {
    const text = 'Patients and others in the ward were asked; Smith and others agreed.';
    expect(localizeEtAl(text, 'en')).toBe(text);
    expect(localizeEtAl('Elma, armut vd. meyveler', 'en')).toBe('Elma, armut vd. meyveler');
  });
});
