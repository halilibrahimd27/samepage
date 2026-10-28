import { describe, expect, it } from 'vitest';
import type { BlockIR, PageIR, Role, SpanIR } from '../../src/core/ir/types';
import { decode } from '../../src/core/segment/codec';
import type { EditableItem } from '../../src/docx/editable';
import { planEditable } from '../../src/pdf/editable';
import { buildPdfUnits } from '../../src/pdf/typeset/segments';

const span = (text: string, x: number, size = 10): SpanIR => ({
  text,
  bbox: { x0: x, y0: 0, x1: x + 5 * text.length, y1: size },
  font: { name: 'LMRoman10-Regular', family: 'serif', bold: false, italic: false, isMath: false },
  size,
  color: [0, 0, 0],
});
let order = 0;
/** A block at height `y` with one line per entry; `sup` spans are raised marks. */
function block(
  id: string,
  role: Role,
  y: number,
  lines: (SpanIR | { sup: string; x: number })[][],
  opts: { x0?: number; x1?: number; translatable?: boolean } = {},
): BlockIR {
  const x0 = opts.x0 ?? 50;
  const x1 = opts.x1 ?? 300;
  return {
    id,
    bbox: { x0, y0: y, x1, y1: y + 14 * lines.length },
    role,
    translatable: opts.translatable ?? !['formula', 'header', 'page-number'].includes(role),
    lines: lines.map((spans, i) => {
      const baseline = y + 10 + 14 * i;
      return {
        bbox: { x0, y0: y + 14 * i, x1, y1: y + 12 + 14 * i },
        baseline,
        spans: spans.map((s) =>
          'sup' in s
            ? { ...span(s.sup, s.x, 6), baseline: baseline - 4 }
            : { ...s, bbox: { ...s.bbox, y0: y + 14 * i, y1: y + 12 + 14 * i }, baseline },
        ),
      };
    }),
    align: 'left',
    direction: [1, 0],
    columnIndex: 0,
    readingOrder: order++,
  };
}
const page = (index: number, blocks: BlockIR[], extra: Partial<PageIR> = {}): PageIR => ({
  index,
  width: 595,
  height: 842,
  rotation: 0,
  blocks,
  images: [],
  vectors: [],
  columns: [],
  ...extra,
});
/** The plan with each unit "translated" as itself. */
const plan = (pages: PageIR[]) =>
  planEditable(
    pages,
    buildPdfUnits(pages).map((unit) => ({ unit, runs: decode(unit.encoded.source, unit.encoded) })),
  );
const text = (item: EditableItem) =>
  item.kind === 'paragraph' ? item.runs.map((r) => r.text).join('') : `[${item.kind}]`;

describe('editable Word output of a PDF (P9.4)', () => {
  it('leaves running heads out and styles headings by size, the largest as the title', () => {
    const p = page(0, [
      block('p0-b0', 'header', 10, [[span('Dergi 12 (2024)', 50)]]),
      block('p0-b1', 'heading', 60, [[span('Anlam kayması', 50, 18)]]),
      block('p0-b2', 'heading', 100, [[span('1 Giriş', 50, 12)]]),
      block('p0-b3', 'body', 120, [[span('Bu çalışma bir örnektir.', 50)]]),
      block('p0-b4', 'heading', 160, [[span('1.1 Amaç', 50, 11)]]),
      block('p0-b5', 'page-number', 800, [[span('3', 290)]]),
    ]);
    const result = plan([p]);
    expect(result.furniture).toBe(2);
    expect(
      result.items.map((i) => (i.kind === 'paragraph' ? `${i.style}: ${text(i)}` : '')),
    ).toEqual([
      'title: Anlam kayması',
      'heading1: 1 Giriş',
      'body: Bu çalışma bir örnektir.',
      'heading2: 1.1 Amaç',
    ]);
  });

  it('puts a display formula between the two halves of its sentence, with its number', () => {
    const before = block('p0-b0', 'body', 100, [[span('Von-Neumann yöntemi kullanılırsa', 50)]]);
    const formula = block('p0-b1', 'formula', 120, [[span('u = v + w', 120)]], {
      x0: 120,
      x1: 200,
    });
    const number = block('p0-b2', 'body', 120, [[span('(3)', 470)]], { x0: 470, x1: 485 });
    const after = block('p0-b3', 'body', 140, [[span('elde edilir.', 50)]]);
    before.chain = { paragraphId: 'p0-b0', index: 0, next: 'p0-b3' };
    after.chain = { paragraphId: 'p0-b0', index: 1, afterFormula: true };
    const result = plan([page(0, [before, formula, number, after])]);
    expect(result.items.map(text)).toEqual([
      'Von-Neumann yöntemi kullanılırsa',
      '[picture]',
      'elde edilir.',
    ]);
    // The picture holds the formula and its number.
    expect(result.pictures).toHaveLength(1);
    expect(result.pictures[0]!.rect.x1).toBeGreaterThanOrEqual(485);
  });

  it('turns a footnote into a Word footnote referenced where its mark is', () => {
    const body = block('p0-b0', 'body', 100, [
      [span('Veriler derlemden alınmıştır.', 50), { sup: '1', x: 190 }],
    ]);
    const note = block('p0-b1', 'footnote', 780, [
      [{ sup: '1', x: 50 }, span('Derlem açık erişimlidir.', 55, 8)],
    ]);
    const result = plan([page(0, [body, note])]);
    expect(result.items.map(text)).toEqual(['Veriler derlemden alınmıştır.']);
    const para = result.items[0] as Extract<EditableItem, { kind: 'paragraph' }>;
    expect(para.runs.some((r) => r.footnote === 0)).toBe(true);
    expect(result.footnotes.map((n) => n.map((r) => r.text).join(''))).toEqual([
      'Derlem açık erişimlidir.',
    ]);
  });

  it('keeps a footnote without a matching mark where it is', () => {
    const body = block('p0-b0', 'body', 100, [[span('Veriler derlemden alınmıştır.', 50)]]);
    const note = block('p0-b1', 'footnote', 780, [[span('Bu belge kurgusaldır.', 50, 8)]]);
    const result = plan([page(0, [body, note])]);
    expect(result.footnotes).toEqual([]);
    expect(result.items.map(text)).toEqual([
      'Veriler derlemden alınmıştır.',
      'Bu belge kurgusaldır.',
    ]);
  });

  it('builds a Word table from table cells, with column widths from the page', () => {
    const cell = (id: string, row: number, col: number, t: string) => {
      const x0 = col ? 200 : 50;
      const b = block(id, 'table-cell', 300 + 20 * row, [[span(t, x0)]], { x0, x1: x0 + 100 });
      b.tableCell = {
        tableId: 't0',
        row,
        col,
        cellRect: { x0, y0: 300 + 20 * row, x1: col ? 300 : 200, y1: 320 + 20 * row },
      };
      return b;
    };
    const result = plan([
      page(0, [
        cell('p0-b0', 0, 0, 'Sistem'),
        cell('p0-b1', 0, 1, 'F1'),
        cell('p0-b2', 1, 0, 'Temel'),
        cell('p0-b3', 1, 1, '0,76'),
      ]),
    ]);
    const table = result.items[0] as Extract<EditableItem, { kind: 'table' }>;
    expect(table.kind).toBe('table');
    expect(table.columns).toEqual([150, 100]);
    expect(
      table.rows.map((r) =>
        r.map((c) => c.paragraphs.map((p) => p.map((x) => x.text).join('')).join()),
      ),
    ).toEqual([
      ['Sistem', 'F1'],
      ['Temel', '0,76'],
    ]);
  });

  it('places a figure before the first block below it and joins hyphenated kept text', () => {
    const above = block('p0-b0', 'body', 100, [[span('Şekil 1 sonuçları gösterir.', 50)]]);
    const caption = block('p0-b1', 'caption', 330, [[span('Şekil 1: Sonuçlar.', 50)]]);
    const ref = block(
      'p0-b2',
      'reference',
      400,
      [[span('Jo-', 50)], [span('nes, L. (2020).', 50)]],
      {
        translatable: false,
      },
    );
    const result = plan([
      page(0, [above, caption, ref], {
        figures: [{ bbox: { x0: 60, y0: 140, x1: 280, y1: 320 }, formula: false }],
      }),
    ]);
    expect(result.items.map(text)).toEqual([
      'Şekil 1 sonuçları gösterir.',
      '[picture]',
      'Şekil 1: Sonuçlar.',
      'Jones, L. (2020).',
    ]);
  });
});
