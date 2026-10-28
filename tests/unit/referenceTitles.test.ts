import { describe, expect, it } from 'vitest';
import { shortTextLanguage } from '../../src/core/detectLanguage';
import {
  bracketTitles,
  insertAtPlain,
  referenceTitles,
  wantsBracket,
} from '../../src/core/referenceTitles';

const trEn = { source: 'tr', target: 'en' };

describe('reference titles in brackets (P9.6)', () => {
  it('finds the title after the year (APA) and puts the bracket before its period', () => {
    const entry =
      'Kaya, Z. ve Demir, A. (2019). Makine çevirisinde anlam kayması. Dil Dergisi, 12(3), 45–67.';
    const [t] = referenceTitles(entry);
    expect(t!.title).toBe('Makine çevirisinde anlam kayması');
    expect(bracketTitles(entry, [t!], ['Meaning shift in machine translation.'])).toBe(
      'Kaya, Z. ve Demir, A. (2019). Makine çevirisinde anlam kayması [Meaning shift in machine translation]. Dil Dergisi, 12(3), 45–67.',
    );
  });

  it('keeps the bracket out of an italic book title', () => {
    const tagged = 'Yılmaz, A. (2020). <t1>Akademik yazım</t1>. Ankara: Nobel.';
    const titles = referenceTitles('Yılmaz, A. (2020). Akademik yazım. Ankara: Nobel.');
    expect(bracketTitles(tagged, titles, ['Academic writing'])).toBe(
      'Yılmaz, A. (2020). <t1>Akademik yazım</t1> [Academic writing]. Ankara: Nobel.',
    );
  });

  it('handles question titles, quoted titles and several entries in one block', () => {
    const q = referenceTitles('Ak, B. (2018). Çeviri nedir? Çeviri Dergisi, 3, 1–9.');
    expect(q.map((t) => t.title)).toEqual(['Çeviri nedir?']);
    const quoted = '[1] A. Kaya, “Derin öğrenme ile çeviri,” Dergi, vol. 2, 2019.';
    const [t] = referenceTitles(quoted);
    expect(t!.title).toBe('Derin öğrenme ile çeviri');
    expect(quoted.slice(0, t!.insertAt).endsWith('”')).toBe(true);
    const two = referenceTitles(
      'Ak, B. (2018). Birinci başlık. Dergi, 1. Can, C. (2019b). İkinci başlık. Dergi, 2.',
    );
    expect(two.map((x) => x.title)).toEqual(['Birinci başlık', 'İkinci başlık']);
    // Already translated: left alone.
    expect(referenceTitles('Ak, B. (2018). Başlık burada [Title here]. Dergi, 1.')).toEqual([]);
  });

  it('brackets titles in another language than the target, not English ones elsewhere', () => {
    expect(wantsBracket('Makine çevirisinde anlam kayması', trEn)).toBe(true);
    expect(wantsBracket('Neural machine translation of rare words', trEn)).toBe(false);
    expect(wantsBracket('Übersetzung und Bedeutung', trEn)).toBe(true);
    expect(wantsBracket('Машинный перевод научных текстов', trEn)).toBe(true);
    // A Turkish paper: English sources stay as they are.
    expect(
      wantsBracket('Neural machine translation of rare words', { source: 'en', target: 'tr' }),
    ).toBe(false);
    // Nothing tells: no bracket.
    expect(wantsBracket('Statistical Machine Translation', trEn)).toBe(false);
    expect(shortTextLanguage('Akademik yazım', 'tr')).toBe('tr');
  });

  it('inserts at plain-text offsets across markup', () => {
    expect(insertAtPlain('a<t1>bc</t1>d', 3, '+')).toBe('a<t1>bc</t1>+d');
    expect(insertAtPlain('a<t1>bc</t1>d', 2, '+')).toBe('a<t1>b+c</t1>d');
    expect(insertAtPlain('ab ⟦U1⟧ cd', 5, '+')).toBe('ab ⟦U1⟧ c+d');
  });
});
