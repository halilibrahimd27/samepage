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
});
