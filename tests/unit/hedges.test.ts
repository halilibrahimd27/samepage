import { describe, expect, it } from 'vitest';
import { softenClaims } from '../../src/core/pipeline/hedges';

describe('softenClaims', () => {
  it('puts back "suggests" that Google wrote as "shows" in Turkish', () => {
    expect(
      softenClaims(
        'Dit suggereert dat logopedisten slechts een deel van de methodieken benutten.',
        'Bu, konuşma terapistlerinin yöntemlerin yalnızca bir kısmını kullandığını göstermektedir.',
        'nl',
        'tr',
      ),
    ).toBe(
      'Bu, konuşma terapistlerinin yöntemlerin yalnızca bir kısmını kullandığını düşündürmektedir.',
    );
    expect(
      softenClaims(
        'Several studies suggested positive results (Grigos et al., 2010).',
        'Çeşitli çalışmalar olumlu sonuçlar olduğunu (Grigos vd., 2010) gösterdi.',
        'en',
        'tr',
      ),
    ).toBe('Çeşitli çalışmalar olumlu sonuçlar olduğunu (Grigos vd., 2010) düşündürdü.');
  });

  it('only in the sentence that suggests, and not where the source also shows', () => {
    expect(
      softenClaims(
        'Table 2 shows that the effect is large. This suggests that training helps.',
        'Tablo 2 etkinin büyük olduğunu göstermektedir. Bu, eğitimin yardımcı olduğunu göstermektedir.',
        'en',
        'tr',
      ),
    ).toBe(
      'Tablo 2 etkinin büyük olduğunu göstermektedir. Bu, eğitimin yardımcı olduğunu düşündürmektedir.',
    );
    expect(
      softenClaims(
        'We suggest a new method and show that it is faster.',
        'Yeni bir yöntem öneriyor ve daha hızlı olduğunu gösteriyoruz.',
        'en',
        'tr',
      ),
    ).toBe('Yeni bir yöntem öneriyor ve daha hızlı olduğunu gösteriyoruz.');
    // "Suggest" as "propose": no clause shown, nothing to change.
    expect(
      softenClaims('We suggest a new method.', 'Yeni bir yöntem öneriyoruz.', 'en', 'tr'),
    ).toBe('Yeni bir yöntem öneriyoruz.');
    expect(softenClaims('This suggests a link.', 'This shows a link.', 'en', 'de')).toBe(
      'This shows a link.',
    );
  });
});
