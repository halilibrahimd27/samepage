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

describe('tidyLine', () => {
  it('makes a giant blank at a line end a plain space, so the line keeps its own height', async () => {
    const { tidyLine } = await import('../../src/pdf/engine/extract');
    const ch = (c: string, x: number, size: number, bbox: [number, number, number, number]) => ({
      c,
      x,
      y: 348,
      bbox: { x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] },
      font: 'EBGaramond',
      size,
      color: [0, 0, 0] as [number, number, number],
    });
    // "Angeli." and two Calibri spaces of 1638 pt whose boxes cover the page.
    const line = {
      bbox: { x0: 189, y0: -881, x1: 942, y1: 757 },
      dir: [1, 0] as [number, number],
      wmode: 0,
      chars: [
        ch('i', 196, 11, [196, 337, 199, 351]),
        ch('.', 199, 11, [199, 337, 201, 351]),
        ch(' ', 201, 1638, [201, -881, 571, 757]),
        ch(' ', 571, 1638, [571, -881, 942, 757]),
      ],
    };
    tidyLine(line);
    expect(line.bbox.y0).toBeGreaterThan(330);
    expect(line.bbox.y1).toBeLessThan(360);
    expect(line.bbox.x1).toBeLessThan(600);
  });
});

describe('Windows-1251 read as Latin-1', () => {
  it('reads a misread Russian font as Cyrillic, and leaves French alone', async () => {
    const { fromCp1251, misreadCp1251, repairCp1251 } = await import('../../src/pdf/engine/cp1251');
    expect([...'ÀÍÒÈÊÐÈÇÈÑÍÛÅ'].map(fromCp1251).join('')).toBe('АНТИКРИЗИСНЫЕ');
    expect([...'ýêîíîìè÷åñêèõ ¹'].map(fromCp1251).join('')).toBe('экономических №');
    expect(misreadCp1251([...'ÀÍÒÈÊÐÈÇÈÑÍÛÅÌÅÐÎÏÐÈßÒÈß'])).toBe(true);
    expect(misreadCp1251([...'Démystifierleconceptdauthenticitéenévaluation'])).toBe(false);
    expect(repairCp1251('Ñåðèÿ «Ïðàâî». Démystifier le concept')).toBe(
      'Серия «Право». Démystifier le concept',
    );
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
    // TeX sets the accent first, on the baseline, and the letter under it next.
    const tex = [ch('l', 0, 3), ch('`', 4, 9), ch('e', 3, 9), ch('B', 9, 17), ch('¨', 18, 23)];
    tex.push(ch('u', 17, 23), ch('`', 23, 28), ch('a', 29, 35));
    expect(
      composeAccents(tex)
        .map((c) => c.c)
        .join('')
        .normalize('NFC'),
    ).toBe('lèBü`a');
  });
});
