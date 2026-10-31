import { describe, expect, it } from 'vitest';
import type { BlockIR, PageIR, SpanIR } from '../../src/core/ir/types';
import { decode } from '../../src/core/segment/codec';
import { layoutUnit } from '../../src/pdf/typeset/layout';
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

  it('reads lines set a hair apart in size as one style, without tags', () => {
    const at = (s: SpanIR, size: number) => ({ ...s, size });
    const [unit] = buildPdfUnits([
      page([
        block('p0-b0', [
          [at(span('Austriackie strajki przyczyniły się ', 50), 10.3)],
          [at(span('do reformy wyborczej. Masowym strajkom ', 50), 10.2)],
          [at(span('udało się wzmocnić organizację.', 50), 10.3)],
        ]),
      ]),
    ]);
    expect(unit!.encoded.source).not.toContain('<t');
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

  it('marks a display formula inside a chained sentence and keeps the text around it', () => {
    const before = block('p0-b0', [[span('Von-Neumann yöntemi kullanılırsa', 50)]]);
    const after = block('p0-b1', [[span('elde edilir.', 50)]]);
    before.chain = { paragraphId: 'p0-b0', index: 0, next: 'p0-b1' };
    after.chain = { paragraphId: 'p0-b0', index: 1, afterFormula: true };
    const [unit] = buildPdfUnits([page([before, after])]);
    expect(unit!.encoded.source).toBe('Von-Neumann yöntemi kullanılırsa ⟦I1⟧ elde edilir.');
    const runs = decode('Taking the method, ⟦I1⟧ is obtained.', unit!.encoded);
    const measurer = { width: (t: string) => t.length * 5, covers: () => true } as never;
    const layouts = layoutUnit('u', [before, after], runs, unit!.encoded.baseStyle, measurer, {
      sizeFactor: () => 1,
    });
    const text = (k: number) =>
      layouts[k]!.lines.flatMap((l) => l.runs.map((r) => r.text)).join(' ');
    // The text after the formula stays after it, in the next box, though the first had room.
    expect(text(0)).toBe('Taking the method,');
    expect(text(1)).toBe('is obtained.');
  });

  it('lets the text flow on when keeping it after the formula would cost room', () => {
    const before = block('p0-b0', [[span('Von-Neumann yöntemi kullanılırsa', 50)]]);
    // A narrow box after the formula: one short line.
    const after = block('p0-b1', [[span('elde edilir.', 50)]]);
    after.bbox = { ...after.bbox, x1: 110 };
    after.lines[0]!.bbox = { ...after.lines[0]!.bbox, x1: 110 };
    before.chain = { paragraphId: 'p0-b0', index: 0, next: 'p0-b1' };
    after.chain = { paragraphId: 'p0-b0', index: 1, afterFormula: true };
    const [unit] = buildPdfUnits([page([before, after])]);
    const measurer = { width: (t: string) => t.length * 5, covers: () => true } as never;
    const lay = (target: string) =>
      layoutUnit(
        'u',
        [before, after],
        decode(target, unit!.encoded),
        unit!.encoded.baseStyle,
        measurer,
        {
          sizeFactor: () => 1,
        },
      );
    const text = (l: ReturnType<typeof lay>, k: number) =>
      l[k]!.lines.flatMap((x) => x.runs.map((r) => r.text)).join(' ');
    // Fits after the formula: kept there.
    expect(text(lay('Taking the method, ⟦I1⟧ is obtained.'), 1)).toBe('is obtained.');
    // Does not fit there: the first box's room is used instead of shrinking the text.
    const flowed = lay('Taking the method, ⟦I1⟧ is obtained as shown.');
    expect(text(flowed, 0)).toBe('Taking the method, is obtained as shown.');
    expect(flowed.some((l) => l.overflow)).toBe(false);
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
