import { describe, expect, it } from 'vitest';
import { CAPTION } from '../../src/core/references';
import type { BlockIR, SpanIR } from '../../src/core/ir/types';
import type { RawLine, RawPage } from '../../src/pdf/extract/raw';
import {
  analyzeDocument,
  blockText,
  equationBlock,
  equationLike,
  mathFragments,
  mathLike,
  monoProse,
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
    for (const t of [
      'p = 0.05 was considered significant',
      'Total = 100 students',
      'Results',
      'then we have χmax(A ⊗M) = χmax(A) + χmax(M).',
    ])
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
    for (const t of ['Fig. 2', 'Age (y)', 'The results', 'PCA analysis + clustering', '2 · KUR'])
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

describe('text in a typewriter font', () => {
  it('reads labels as language and code as code', () => {
    for (const t of ['TEMEL', 'BİLMEN GEREKEN', '1. HAFTA', 'Uzun ömürlü anahtar yerine OIDC'])
      expect(monoProse(t), t).toBe(true);
    for (const t of [
      'requests',
      '$ git log -p',
      'uses: actions/checkout@v4',
      'x = 1',
      'pull_request',
    ])
      expect(monoProse(t), t).toBe(false);
  });

  it("translates a code listing's comments in words, not its code", () => {
    const line = (y: number, text: string): RawLine => ({
      bbox: { x0: 60, y0: y, x1: 60 + 6 * text.length, y1: y + 10 },
      dir: [1, 0],
      wmode: 0,
      chars: [...text].map((c, i) => ({
        c,
        x: 60 + 6 * i,
        y: y + 8,
        bbox: { x0: 60 + 6 * i, y0: y, x1: 66 + 6 * i, y1: y + 10 },
        font: 'JetBrainsMono-Regular',
        size: 9,
        color: [0, 0, 0] as [number, number, number],
      })),
    });
    const lines = [
      line(100, '$ git log -p --all -S AKIA | head'),
      line(112, '# gecmisin tamaminda arar, saldirgan da boyle arar'),
      line(124, '# v4.1.7'),
    ];
    const page: RawPage = {
      index: 0,
      width: 600,
      height: 800,
      rotation: 0,
      blocks: [{ bbox: { x0: 60, y0: 100, x1: 400, y1: 134 }, lines }],
      images: [],
      vectors: [],
      links: [],
      fonts: {},
    };
    const [p] = analyzeDocument([page]);
    const of = (t: string) => p!.blocks.find((b) => blockText(b).includes(t))!;
    expect(of('git log').translatable).toBe(false);
    expect(of('gecmisin').translatable).toBe(true);
    expect(of('v4.1.7').translatable).toBe(false);
  });

  it('translates a paragraph drawn twice over itself once, and erases the other copy', () => {
    const line = (y: number, x0: number, text: string): RawLine => ({
      bbox: { x0, y0: y, x1: x0 + 6 * text.length, y1: y + 12 },
      dir: [1, 0],
      wmode: 0,
      chars: [...text].map((c, i) => ({
        c,
        x: x0 + 6 * i,
        y: y + 10,
        bbox: { x0: x0 + 6 * i, y0: y, x1: x0 + 6 * (i + 1), y1: y + 12 },
        font: 'Poppins-Regular',
        size: 11,
        color: [1, 1, 1] as [number, number, number],
      })),
    });
    // The same bullet set twice, wrapped differently, the copies a few points apart.
    const a = [
      line(283, 74, 'Her bulguyu düzeltmeye çalışma, önce gerçekten'),
      line(298, 74, 'çağrılan kod yolundakilere bak.'),
    ];
    const b = [
      line(304, 74, 'Her bulguyu düzeltmeye çalışma, önce'),
      line(319, 74, 'gerçekten çağrılan kod yolundakilere bak.'),
    ];
    const page: RawPage = {
      index: 0,
      width: 960,
      height: 540,
      rotation: 0,
      blocks: [
        { bbox: { x0: 74, y0: 283, x1: 360, y1: 310 }, lines: a },
        { bbox: { x0: 74, y0: 300, x1: 330, y1: 345 }, lines: b },
      ],
      images: [],
      vectors: [],
      links: [],
      fonts: {},
    };
    const [p] = analyzeDocument([page]);
    const copies = p!.blocks.filter((x) => blockText(x).includes('bulguyu'));
    expect(copies).toHaveLength(1);
    expect(copies[0]!.extraRedact?.length).toBe(2);
  });

  it('joins a chapter’s large first letter to its words, with its opening quote', () => {
    const line = (y: number, x0: number, text: string, size = 10): RawLine => ({
      bbox: { x0, y0: y, x1: x0 + 5 * text.length, y1: y + size * 1.2 },
      dir: [1, 0],
      wmode: 0,
      chars: [...text].map((c, i) => ({
        c,
        x: x0 + 5 * i * (size / 10),
        y: y + size,
        bbox: { x0: x0 + 5 * i, y0: y, x1: x0 + 5 * (i + 1), y1: y + size * 1.2 },
        font: 'MinionPro-Regular',
        size,
        color: [0, 0, 0] as [number, number, number],
      })),
    });
    const body = (y: number) =>
      line(y, 31, 'It is the running text of the novel, on over the whole line');
    const chapter = (letter: string, rest: string): RawPage => ({
      index: 0,
      width: 322,
      height: 484,
      rotation: 0,
      blocks: [
        { bbox: { x0: 31, y0: 105, x1: 50, y1: 141 }, lines: [line(105, 31, letter, 28.5)] },
        // Two lines beside the letter, the paragraph ends there.
        {
          bbox: { x0: 51, y0: 110, x1: 272, y1: 135 },
          lines: [line(110, 51, rest), line(122, 51, 'was from my own Elizabeth:')],
        },
        { bbox: { x0: 31, y0: 150, x1: 320, y1: 200 }, lines: [body(150), body(162), body(174)] },
      ],
      images: [],
      vectors: [],
      links: [],
      fonts: {},
    });
    const first = (letter: string, rest: string) =>
      blockText(
        analyzeDocument([chapter(letter, rest)])[0]!.blocks.find((b) =>
          blockText(b).includes('Elizabeth'),
        )!,
      );
    expect(first('O', 'n my return, I found the following letter from my')).toMatch(
      /^On my return/u,
    );
    expect(first('‘I', 't is with considerable difficulty that I remember')).toMatch(
      /^‘It is with/u,
    );
  });
});
