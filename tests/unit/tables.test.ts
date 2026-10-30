import { describe, expect, it } from 'vitest';
import { detectTables } from '../../src/pdf/analyze/tables';
import type { RawLine, RawPage } from '../../src/pdf/extract/raw';

type Cell = [x0: number, y0: number, x1: number, y1: number, text: string, size?: number];

const line = ([x0, y0, x1, y1, text, size = 9]: Cell): RawLine => ({
  bbox: { x0, y0, x1, y1 },
  dir: [1, 0],
  wmode: 0,
  // The characters fill the line's width.
  chars: [...text].map((c, i, all) => ({
    c,
    x: x0 + (i * (x1 - x0)) / all.length,
    y: y1 - 2,
    bbox: {
      x0: x0 + (i * (x1 - x0)) / all.length,
      y0,
      x1: x0 + ((i + 1) * (x1 - x0)) / all.length,
      y1,
    },
    font: 'Serif',
    size,
    color: [0, 0, 0] as [number, number, number],
  })),
});

const page = (cells: Cell[], rules: [number, number, number][]): RawPage => ({
  index: 2,
  width: 612,
  height: 792,
  rotation: 0,
  blocks: [{ bbox: { x0: 0, y0: 0, x1: 612, y1: 792 }, lines: cells.map(line) }],
  images: [],
  vectors: rules.map(([x0, y, x1]) => ({
    bbox: { x0, y0: y, x1, y1: y + 0.4 },
    isRectangle: true,
    isStroked: false,
    color: [0, 0, 0] as [number, number, number],
  })),
  links: [],
  fonts: {},
});

// Table 1 of an ACM paper: one rule, under the header row; the caption right below.
const HEADER: Cell[] = [
  [59, 274, 98, 283, 'Language'],
  [123, 274, 151, 283, 'Total #'],
  [161, 274, 195, 283, 'Filter by'],
  [213, 274, 247, 283, 'Filter by'],
  [108, 285, 151, 294, 'of samples'],
  [167, 285, 198, 294, 'version'],
  [207, 285, 247, 294, 'campaign'],
];
const DATA: Cell[] = [
  [59, 301, 96, 310, 'JavaScript'],
  [134, 301, 151, 310, '2071'],
  [181, 301, 198, 310, '1505'],
  [230, 301, 247, 310, '1408'],
  [59, 312, 85, 321, 'Python'],
  [139, 312, 151, 321, '273'],
  [185, 312, 198, 321, '225'],
  [235, 312, 247, 321, '133'],
];
const CAPTION: Cell = [
  54,
  323,
  296,
  332,
  'Table 1: Number of malicious samples remaining after ap-',
];
const RULE: [number, number, number] = [58, 297, 299];

describe('tables with a single rule', () => {
  it('finds the table under its caption, header and data rows included', () => {
    const [table] = detectTables(page([...HEADER, ...DATA, CAPTION], [RULE]));
    expect(table).toBeDefined();
    expect(table!.rect.y0).toBeLessThanOrEqual(274);
    expect(table!.rect.y1).toBeGreaterThanOrEqual(321);
    // The caption is not a row of the table.
    expect(table!.rect.y1).toBeLessThan(323);
  });

  it('needs a caption, and cells side by side', () => {
    expect(detectTables(page([...HEADER, ...DATA], [RULE]))).toEqual([]);
    // A footnote rule with its notes below: one line per row, no table.
    const notes: Cell[] = [
      [54, 690, 300, 698, '1 Commit 6d7d140168f80c048fc1622a4788b1f5c17af2d0'],
      [54, 699, 300, 707, '2 https://libraries.io/ and the Table 2 data'],
    ];
    expect(
      detectTables(page([[54, 670, 300, 679, 'Table 9 is below.'], ...notes], [[54, 686, 101]])),
    ).toEqual([]);
  });
});

describe('table columns', () => {
  it('keeps the columns under a header that spans a column group', async () => {
    const { analyzeDocument } = await import('../../src/pdf/analyze/analyze');
    const cells: Cell[] = [
      [115, 100, 195, 109, 'Mono-language'],
      [120, 112, 140, 121, 'Pr.'],
      [170, 112, 190, 121, 'Rec.'],
      [80, 128, 92, 137, 'DT'],
      [120, 128, 140, 137, '100.0'],
      [170, 128, 190, 137, '68.0'],
      [80, 140, 92, 149, 'RF'],
      [120, 140, 140, 149, '98.5'],
      [170, 140, 190, 149, '53.5'],
      [60, 160, 260, 169, 'Table 4: Results of the cross validation.'],
    ];
    const [pageIR] = analyzeDocument([page(cells, [[110, 124, 200]])]);
    const at = (t: string) =>
      pageIR!.blocks.find((b) => b.lines.some((l) => l.spans.map((s) => s.text).join('') === t))
        ?.tableCell;
    expect(at('Pr.')?.col).not.toBe(at('Rec.')?.col);
    expect(at('100.0')?.col).toBe(at('Pr.')?.col);
    // The group header starts in its first column and spans the group.
    expect(at('Mono-language')?.col).toBe(at('Pr.')?.col);
    expect(at('Mono-language')!.cellRect.x1).toBeGreaterThanOrEqual(at('Rec.')!.cellRect.x1);
  });
});

// One raw block per cell, as MuPDF delivers cells that are far apart.
const cellPage = (
  cells: Cell[],
  rules: [number, number, number][],
  fills: Cell[] = [],
): RawPage => {
  const p = page([], rules);
  p.blocks = cells.map((c) => ({
    bbox: { x0: c[0], y0: c[1], x1: c[2], y1: c[3] },
    lines: [line(c)],
  }));
  p.vectors.push(
    ...fills.map(([x0, y0, x1, y1]) => ({
      bbox: { x0, y0, x1, y1 },
      isRectangle: true,
      isStroked: false,
      color: [1, 1, 1] as [number, number, number],
    })),
  );
  return p;
};

describe('ruled grids drawn cell by cell', () => {
  // Three columns, rules per cell (touching or 3 pt apart), a filled rectangle per cell.
  const xs = [50, 150, 250, 350];
  const ys = [100, 114, 128, 142];
  const rules: [number, number, number][] = ys.flatMap((y) =>
    xs.slice(0, 3).map((x, i): [number, number, number] => [x + (i ? 3 : 0), y, xs[i + 1]!]),
  );
  const fills: Cell[] = ys
    .slice(0, 3)
    .flatMap((y, r) => xs.slice(0, 3).map((x, i): Cell => [x, y, xs[i + 1]!, ys[r + 1]!, '']));
  const cells: Cell[] = ys
    .slice(0, 3)
    .flatMap((y, r) =>
      xs.slice(0, 3).map((x, i): Cell => [x + 5, y + 2, x + 40, y + 11, `c${r}${i}`]),
    );

  it('is one multi-column table, not one strip per column', () => {
    const tables = detectTables(cellPage(cells, rules, fills));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.rect.x0).toBeLessThanOrEqual(50);
    expect(tables[0]!.rect.x1).toBeGreaterThanOrEqual(350);
  });

  it('joins column strips that touch side by side over the same rows', () => {
    const strips: Cell[] = [
      [60, 102, 90, 111, 'a'],
      [60, 116, 90, 125, 'b'],
      [160, 102, 190, 111, 'c'],
      [160, 116, 190, 125, 'd'],
    ];
    // A gap of 6 pt between the strips' rules is too wide to stitch, close enough to join.
    const joined = detectTables(
      cellPage(strips, [
        [50, 100, 150],
        [50, 114, 150],
        [50, 128, 150],
        [156, 100, 256],
        [156, 114, 256],
        [156, 128, 256],
      ]),
    );
    expect(joined).toHaveLength(1);
    expect(joined[0]!.rect.x1).toBeGreaterThanOrEqual(256);
    // Far apart (two tables in two page columns) they stay two.
    const apart = detectTables(
      cellPage(
        strips.map((c): Cell => (c[0] > 100 ? [c[0] + 50, c[1], c[2] + 50, c[3], c[4]] : c)),
        [
          [50, 100, 150],
          [50, 114, 150],
          [50, 128, 150],
          [200, 100, 300],
          [200, 114, 300],
          [200, 128, 300],
        ],
      ),
    );
    expect(apart).toHaveLength(2);
  });

  it('a caption inside the first row of a grid is not a row', () => {
    const cs: Cell[] = [
      [55, 83, 300, 92, 'Tab. 1 Results of the survey'],
      [60, 104, 90, 113, 'a'],
      [160, 104, 190, 113, 'b'],
      [60, 118, 90, 127, 'c'],
      [160, 118, 190, 127, 'd'],
    ];
    const [t] = detectTables(
      cellPage(cs, [
        [50, 80, 250],
        [50, 100, 250],
        [50, 114, 250],
        [50, 128, 250],
      ]),
    );
    expect(t!.rect.y0).toBeGreaterThanOrEqual(99);
  });
});

describe('tables found from their caption', () => {
  const caption: Cell = [54, 100, 250, 109, 'Table 3: Results per method'];
  const grid = (rows: string[][], x = [54, 150, 220], y0 = 118): Cell[] =>
    rows.flatMap((r, i) =>
      r.map((t, j): Cell => [x[j]!, y0 + i * 12, x[j]! + 8 * t.length, y0 + 9 + i * 12, t]),
    );

  it('finds an unruled table below its caption', () => {
    const rows = [
      ['Method', 'Acc', 'F1'],
      ['SVM', '0.81', '0.79'],
      ['CNN', '0.88', '0.85'],
      ['BERT', '0.91', '0.90'],
    ];
    const [t] = detectTables(cellPage([caption, ...grid(rows)], []));
    expect(t).toBeDefined();
    expect(t!.rect.y0).toBeGreaterThan(109);
    expect(t!.rect.y1).toBeGreaterThan(140);
  });

  it('stops at a paragraph line', () => {
    const rows = [
      ['Method', 'Acc', 'F1'],
      ['SVM', '0.81', '0.79'],
      ['CNN', '0.88', '0.85'],
    ];
    const para: Cell = [
      54,
      160,
      500,
      169,
      'The methods above were compared on the held-out split and the results are discussed in the next section.',
    ];
    const [t] = detectTables(cellPage([caption, ...grid(rows), para], []));
    expect(t!.rect.y1).toBeLessThan(160);
  });

  it('keeps the next line of a long cell in the table', () => {
    const wide: Cell = [54, 100, 400, 109, 'Table 2: Instruments used in the studies'];
    const rows = grid(
      [
        ['Code', 'Description', 'Year'],
        ['A1', 'Short description', '2019'],
      ],
      [54, 120, 420],
    );
    const next: Cell = [
      120,
      142,
      370,
      151,
      'a questionnaire of thirty items on a five-point scale, given twice, two weeks apart',
      7,
    ];
    const more = grid(
      [
        ['B2', 'Another one', '2020'],
        ['C3', 'More', '2021'],
      ],
      [54, 120, 420],
      154,
    );
    const [t] = detectTables(cellPage([wide, ...rows, next, ...more], []));
    expect(t!.rect.y1).toBeGreaterThan(170);
  });

  it('ignores running text and one-column lists', () => {
    const text: Cell[] = [0, 1, 2, 3, 4].map((i): Cell => [
      54,
      118 + i * 12,
      290,
      127 + i * 12,
      'Running text of the paper goes on and on here, more.',
    ]);
    expect(detectTables(cellPage([caption, ...text], []))).toEqual([]);
    const refs: Cell[] = [0, 1, 2, 3].map((i): Cell => [
      54,
      118 + i * 12,
      200,
      127 + i * 12,
      `[${i}] Author A. Title of a paper.`,
    ]);
    expect(detectTables(cellPage([caption, ...refs], []))).toEqual([]);
  });

  it('ignores the two columns of a page', () => {
    const cap: Cell = [
      54,
      100,
      560,
      109,
      'Table 3: A caption that runs across the whole width of the page itself.',
    ];
    const both: Cell[] = [0, 1, 2, 3].flatMap((i): Cell[] => [
      [54, 118 + i * 12, 290, 127 + i * 12, 'Left column text that keeps flowing down here'],
      [318, 118 + i * 12, 558, 127 + i * 12, 'Right column text that keeps flowing down too'],
    ]);
    expect(detectTables(cellPage([cap, ...both], []))).toEqual([]);
  });

  it('needs the columns to repeat', () => {
    const scattered: Cell[] = [
      [54, 118, 80, 127, 'one'],
      [200, 118, 230, 127, 'two'],
      [90, 130, 110, 139, 'a'],
      [240, 130, 270, 139, 'b'],
      [70, 142, 100, 151, 'c'],
      [170, 142, 200, 151, 'd'],
    ];
    expect(detectTables(cellPage([caption, ...scattered], []))).toEqual([]);
  });
});

describe('page 1 front matter', () => {
  it('reads the author grid author by author, before the abstract', async () => {
    const { analyzeDocument } = await import('../../src/pdf/analyze/analyze');
    const body = (y: number, x: number): Cell => [
      x,
      y,
      x + 240,
      y + 9,
      'Body text of the paper continues here with words.',
    ];
    const cells: Cell[] = [
      [100, 60, 500, 76, 'A Title of the Paper', 17],
      [90, 100, 170, 112, 'Ada Lovelace', 12],
      [250, 100, 340, 112, 'Alan Turing', 12],
      [420, 100, 500, 112, 'Grace Hopper', 12],
      [80, 114, 180, 123, 'University of London'],
      [245, 114, 345, 123, 'University of Cambridge'],
      [410, 114, 510, 123, 'Yale University'],
      [54, 160, 120, 171, 'ABSTRACT', 11],
      ...[175, 186, 197, 208, 219, 230].map((y) => body(y, 54)),
      ...[175, 186, 197, 208, 219, 230].map((y) => body(y, 318)),
    ];
    // MuPDF gives each author's lines a block of their own.
    const raw = page(cells, []);
    raw.blocks = cells.map((c) => ({
      bbox: { x0: c[0], y0: c[1], x1: c[2], y1: c[3] },
      lines: [line(c)],
    }));
    const [p] = analyzeDocument([raw]);
    const order = [...p!.blocks]
      .sort((a, b) => a.readingOrder - b.readingOrder)
      .map((b) => b.lines.map((l) => l.spans.map((s) => s.text).join('')).join(' '))
      .slice(0, 8);
    expect(order).toEqual([
      'A Title of the Paper',
      'Ada Lovelace',
      'University of London',
      'Alan Turing',
      'University of Cambridge',
      'Grace Hopper',
      'Yale University',
      'ABSTRACT',
    ]);
  });

  it('keeps a title, its author line and the affiliations in page order', async () => {
    const { analyzeDocument } = await import('../../src/pdf/analyze/analyze');
    const cells: Cell[] = [
      [121, 59, 474, 76, 'Measuring Meaning Shift in Academic Texts', 17],
      [219, 106, 376, 118, 'Ada Lovelace1, Alan Turing2', 12],
      [137, 123, 458, 132, '1University of London, Department of Mathematics'],
      [111, 134, 484, 143, '2University of Cambridge, Department of Computer Science'],
      [54, 168, 541, 177, 'Abstract. Machine translation is used more and more in publishing.'],
      [51, 283, 108, 296, '1 Introduction', 12],
    ];
    const raw = page(cells, []);
    raw.blocks = cells.map((c) => ({
      bbox: { x0: c[0], y0: c[1], x1: c[2], y1: c[3] },
      lines: [line(c)],
    }));
    const [p] = analyzeDocument([raw]);
    const order = [...p!.blocks]
      .sort((a, b) => a.readingOrder - b.readingOrder)
      .map((b) =>
        b.lines
          .map((l) => l.spans.map((s) => s.text).join(''))
          .join(' ')
          .slice(0, 8),
      );
    expect(order).toEqual(['Measurin', 'Ada Love', '1Univers', 'Abstract', '1 Introd']);
  });
});
