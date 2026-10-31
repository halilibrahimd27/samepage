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

describe('composeAccents', () => {
  it('puts an accent a font draws apart back on its letter ("z" + raised "." → "ż")', async () => {
    const { composeAccents } = await import('../../src/pdf/analyze/blocks');
    const ch = (c: string, x0: number, x1: number, y = 100) => ({
      c,
      x: x0,
      y,
      bbox: { x0, y0: y - 10, x1, y1: y + 2 },
      font: 'DilleniaUPC',
      size: 12,
      color: [0, 0, 0] as [number, number, number],
    });
    const chars = [
      ch('R', 0, 8),
      ch('ó', 8, 14),
      ch('z', 14, 20),
      ch('.', 15, 18, 94),
      ch('a', 20, 26),
    ];
    expect(
      composeAccents(chars)
        .map((c) => c.c)
        .join('')
        .normalize('NFC'),
    ).toBe('Róża');
    // A full stop on the line after a word stays one.
    const end = [ch('a', 0, 6), ch('.', 6, 9)];
    expect(composeAccents(end).map((c) => c.c)).toEqual(['a', '.']);
  });
});
