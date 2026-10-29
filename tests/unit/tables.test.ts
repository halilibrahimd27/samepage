import { describe, expect, it } from 'vitest';
import { detectTables } from '../../src/pdf/analyze/tables';
import type { RawLine, RawPage } from '../../src/pdf/extract/raw';

type Cell = [x0: number, y0: number, x1: number, y1: number, text: string];

const line = ([x0, y0, x1, y1, text]: Cell): RawLine => ({
  bbox: { x0, y0, x1, y1 },
  dir: [1, 0],
  wmode: 0,
  chars: [...text].map((c, i) => ({
    c,
    x: x0 + i,
    y: y1 - 2,
    bbox: { x0: x0 + i, y0, x1: x0 + i + 1, y1 },
    font: 'Serif',
    size: 9,
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
