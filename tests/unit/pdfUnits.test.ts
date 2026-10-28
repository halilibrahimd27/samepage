import { describe, expect, it } from 'vitest';
import type { BlockIR, PageIR, SpanIR } from '../../src/core/ir/types';
import { buildPdfUnits } from '../../src/pdf/typeset/segments';

const font = (name: string, isMath = false): SpanIR['font'] => ({
  name,
  family: 'serif',
  bold: false,
  italic: false,
  isMath,
});
const span = (text: string, x: number, math = false): SpanIR => ({
  text,
  bbox: { x0: x, y0: 90, x1: x + 6 * text.length, y1: 102 },
  font: math ? font('LMMathItalic10-Regular', true) : font('LMRoman10-Regular'),
  size: 10,
  color: [0, 0, 0],
  baseline: 100,
});
const block = (id: string, lines: SpanIR[][]): BlockIR => ({
  id,
  bbox: { x0: 50, y0: 90, x1: 300, y1: 90 + 14 * lines.length },
  role: 'body',
  translatable: true,
  lines: lines.map((spans, i) => ({
    bbox: { x0: 50, y0: 90 + 14 * i, x1: 300, y1: 102 + 14 * i },
    baseline: 100 + 14 * i,
    spans: spans.map((s) => ({ ...s, baseline: 100 + 14 * i })),
  })),
  align: 'left',
  direction: [1, 0],
  columnIndex: 0,
  readingOrder: 0,
});
const page = (blocks: BlockIR[]): PageIR => ({
  index: 0,
  width: 595,
  height: 842,
  rotation: 0,
  blocks,
  images: [],
  vectors: [],
  columns: [],
});

describe('PDF translation units', () => {
  it('keeps a number whole when its decimal separator is set in a math font', () => {
    // LaTeX's $\kappa = 0{,}81$: κ and the comma come from the math font, the digits do not.
    const [unit] = buildPdfUnits([
      page([
        block('p0-b0', [
          [
            span('Uyum katsayısı ', 50),
            span('κ', 140, true),
            span(' = 0', 146),
            span(',', 170, true),
            span('81', 174),
            span(' olarak hesaplanmıştır.', 186),
          ],
        ]),
      ]),
    ]);
    expect(unit!.encoded.source).toBe('Uyum katsayısı ⟦F1⟧ = 0,81 olarak hesaplanmıştır.');
  });

  it('leaves the spaces around a formula to the text, also at a line end', () => {
    const [unit] = buildPdfUnits([
      page([
        block('p0-b0', [
          [span('kesinlik', 50), span(' P', 98, true), span(' ve duyarlılık', 110)],
          [span('R', 50, true)],
          [span('değerleri.', 50)],
        ]),
      ]),
    ]);
    expect(unit!.encoded.source).toBe('kesinlik ⟦F1⟧ ve duyarlılık ⟦F2⟧ değerleri.');
    expect(unit!.encoded.placeholders.map((p) => p.text)).toEqual(['P', 'R']);
  });

  it('keeps a unit’s exponent in the text and the space after a mark at a line end', () => {
    const sup = (text: string, x: number): SpanIR => ({
      ...span(text, x),
      size: 6,
      bbox: { x0: x, y0: 88, x1: x + 4, y1: 95 },
    });
    const raised = (b: BlockIR, line: number, at: number) => {
      b.lines[line]!.spans[at]!.baseline = b.lines[line]!.baseline - 4;
      return b;
    };
    const b = raised(
      raised(
        block('p0-b0', [
          [span('Yoğunluk 7800 kg/m', 50), sup('3', 160)],
          [span('olarak alınır, bkz. Ek', 50), sup('1', 190)],
          [span('Bu değer sabittir.', 50)],
        ]),
        0,
        1,
      ),
      1,
      1,
    );
    const [unit] = buildPdfUnits([page([b])]);
    expect(unit!.encoded.source).toBe(
      'Yoğunluk 7800 kg/m³ olarak alınır, bkz. Ek⟦N1⟧ Bu değer sabittir.',
    );
  });

  it('drops hyphenation at line ends but keeps a word’s own hyphen', () => {
    const [unit] = buildPdfUnits([
      page([
        block('p0-b0', [
          [span('Bu yöntem ge-', 50)],
          [span('lişmiş bir Von-', 50)],
          [span('Neumann analizidir.', 50)],
        ]),
      ]),
    ]);
    expect(unit!.encoded.source).toBe('Bu yöntem gelişmiş bir Von-Neumann analizidir.');
  });
});
