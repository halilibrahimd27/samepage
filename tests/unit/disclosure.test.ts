import { describe, expect, it } from 'vitest';
import { aiDisclosure } from '../../src/core/disclosure';

describe('AI-use statement for the journal', () => {
  it('is written in the manuscript’s language and names the engine and the languages', () => {
    const en = aiDisclosure('browser', { source: 'tr', target: 'en' });
    expect(en.lang).toBe('en');
    expect(en.text).toContain(
      'with Google Translate to translate the manuscript from Turkish into English',
    );
    expect(en.text).toContain('take full responsibility for the content of the publication');

    const tr = aiDisclosure('chrome-builtin', { source: 'en', target: 'tr' });
    expect(tr.lang).toBe('tr');
    expect(tr.text).toContain('makaleyi İngilizceden Türkçeye çevirmek için');
    expect(tr.text).toContain('Google Chrome’un yerleşik çevirmeni');
  });

  it('puts Turkish case endings after the language names by vowel harmony', () => {
    expect(aiDisclosure('anthropic', { source: 'de', target: 'tr' }).text).toContain(
      'makaleyi Almancadan Türkçeye',
    );
    expect(aiDisclosure('anthropic', { source: 'ru', target: 'tr' }).text).toContain(
      'makaleyi Rusçadan Türkçeye',
    );
  });

  it('falls back to English for other manuscript languages', () => {
    const de = aiDisclosure('browser', { source: 'tr', target: 'de' });
    expect(de.lang).toBe('en');
    expect(de.text).toContain('from Turkish into German');
  });
});
