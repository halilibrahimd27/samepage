import { describe, expect, it } from 'vitest';
import { CAPTION } from '../../src/core/references';
import type { BlockIR, SpanIR } from '../../src/core/ir/types';
import {
  equationBlock,
  equationLike,
  mathFragments,
  mathLike,
} from '../../src/pdf/analyze/analyze';

describe('mathFragments', () => {
  it('recognises formula pieces set in a text font, not words or labels', () => {
    // Sub-figure marks ("a) b)") stay as they are too.
    for (const t of [
      'O m m',
      'T T',
      'j j j',
      '(W',
      'n z Max w x wx Min wx w x',
      'm j mj j',
      'a) b)',
      'τ exp',
      '�exp',
      'max|',
      '|Opm|',
    ])
      expect(mathFragments(t), t).toBe(true);
    for (const t of ['Да Нет', 'Table 1', 'Fig. 3', 'The', '1.2', 'et al.', 'Results'])
      expect(mathFragments(t), t).toBe(false);
  });

  it('recognises short equations, not sentences with a relation sign', () => {
    for (const t of ['Prev = 3.940⋅Fn', '; Φ = cos−1R −Prev R', 'HT = 1,75⋅250 3,809', 'P='])
      expect(equationLike(t), t).toBe(true);
    for (const t of ['p = 0.05 was considered significant', 'Total = 100 students', 'Results'])
      expect(equationLike(t), t).toBe(false);
  });

  it('reads a subscript set apart as part of an equation, not of a word', () => {
    const font = {
      name: 'Georgia-Italic',
      family: 'serif' as const,
      bold: false,
      italic: true,
      isMath: false,
    };
    const span = (text: string, x: number, size = 10, isMath = false): SpanIR => ({
      text,
      bbox: { x0: x, y0: 100, x1: x + 6 * text.length, y1: 112 },
      font: { ...font, isMath },
      size,
      color: [0, 0, 0],
    });
    // F_head = E − E_r1 − E_r2 [1], as the Spanish microtunnelling paper sets it.
    const spans = [
      span('F', 50),
      span('head', 56, 7),
      span(' =', 80, 10, true),
      span(' E', 92),
      span(' −', 104, 10, true),
      span('E', 116),
      span('r', 122, 7),
      span('1', 126, 7),
      span(' \t', 130),
      span('[1]', 300),
    ];
    const block = (s: SpanIR[]): BlockIR => ({
      id: 'p0-b0',
      bbox: { x0: 50, y0: 100, x1: 320, y1: 112 },
      role: 'body',
      translatable: true,
      lines: [{ bbox: { x0: 50, y0: 100, x1: 320, y1: 112 }, baseline: 110, spans: s }],
      align: 'left',
      direction: [1, 0],
      columnIndex: 0,
      readingOrder: 0,
    });
    expect(equationLike('Fhead = E −Er1 [1]')).toBe(false);
    expect(equationBlock(block(spans))).toBe(true);
    // A sentence keeps its words whatever its spans.
    expect(equationBlock(block([span('Total', 50), span(' = 100 students', 80)]))).toBe(false);
  });

  it('recognises lines of mathematics in a text font', () => {
    for (const t of [
      '4L Bh −D R(g)h',
      '〈u,v〉g dVg g dVg',
      '2(n −1)dd∗−n',
      'n D R(g)∗TrB∗div = c(n −2)',
    ])
      expect(mathLike(t), t).toBe(true);
    for (const t of ['Fig. 2', 'Age (y)', 'The results', 'PCA analysis + clustering'])
      expect(mathLike(t), t).toBe(false);
  });

  it('tells captions from sentences that refer to a figure or table', () => {
    for (const t of [
      'Tablo 1: Anlam kayması türlerinin dağılımı.',
      'Şekil 1. Tümce uzunluğuna göre terim tutarlılığı',
      'Table 1 Characteristics of the patients',
      'Fig. 2 a) Overview',
      'Fig 1. The triple burial of Dolní Věstonice',
      'Abb. 2 Aufbau des Versuchs',
      'Рис. 1. Схема',
      'Tablo 1.2. Bulgular',
      'TABLE 1',
    ])
      expect(CAPTION.test(t), t).toBe(true);
    for (const t of [
      'Tablo 1’de görüldüğü üzere tümcelerin %87,4’ünde',
      "Tablo 12'de verilmiştir",
      'Şekil 1, terim tutarlılığının azaldığını göstermektedir.',
      'Table 2 shows the results',
      'Fig 2 shows the ratio',
      'Tablo 1 incelendiğinde',
      'Abbildung 1 zeigt',
      'Рис. 1 демонстрирует',
    ])
      expect(CAPTION.test(t), t).toBe(false);
  });
});
