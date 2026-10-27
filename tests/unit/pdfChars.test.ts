import { describe, expect, it } from 'vitest';
import { restoreChar } from '../../src/pdf/engine/extract';

describe('restoreChar', () => {
  it('restores math letters truncated by MuPDF.js and STIX calligraphic capitals', () => {
    expect(restoreChar(String.fromCharCode(0xd441), 'CambriaMath')).toBe('𝑁');
    expect(restoreChar('', 'STIXMathCalligraphy-Regu')).toBe('ℒ');
    expect(restoreChar('', 'STIXMathCalligraphy-Regu')).toBe('𝒜');
    expect(restoreChar('', 'STIXMathCalligraphy-Regu')).toBe('𝒵');
    // Private use characters of other fonts mean something else.
    expect(restoreChar('', 'Wingdings')).toBe('');
    expect(restoreChar('a', 'STIXGeneral')).toBe('a');
    // Word's symbol fonts.
    expect(restoreChar('\uf0b7', 'Symbol')).toBe('•');
    expect(restoreChar('\uf061', 'SymbolMT')).toBe('α');
    expect(restoreChar('\uf0fc', 'Wingdings-Regular')).toBe('✓');
    expect(restoreChar('\uf0b7', 'Calibri')).toBe('\uf0b7');
    expect(restoreChar('\uf8f3', 'CMEX10')).toBe('⎩');
    expect(restoreChar('\uf02d', 'SymbolMT')).toBe('−');
    expect(restoreChar('\uf02a', 'TimesNewRoman')).toBe('*');
    expect(restoreChar('\uf6d9', 'Times')).toBe('©');
  });
});
