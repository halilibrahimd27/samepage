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

  it('finds an asterisk in the text’s own size, and a note number set apart', () => {
    const body = block('p0-b0', 'body', 100, [
      [span('Zatrzymano całe życie”*. W Szwecji', 50), { sup: '31', x: 240 }],
    ]);
    const star = block('p0-b1', 'footnote', 760, [[span('* O. Olberg, 1905.', 50, 8)]]);
    const numbered = block('p0-b2', 'footnote', 780, [
      [span('31 ', 50, 8), span('Rocher de bronze.', 65, 8)],
    ]);
    const result = plan([page(0, [body, star, numbered])]);
    expect(result.items.map(text)).toEqual(['Zatrzymano całe życie”. W Szwecji']);
    expect(result.footnotes.map((n) => n.map((r) => r.text).join(''))).toEqual([
      'O. Olberg, 1905.',
      'Rocher de bronze.',
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

  it('builds a Word table from table cells, each column wide enough for its text', () => {
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
    // The table's width on the page; the second column's 100 pt of text and cell margins first.
    expect(table.columns).toEqual([142, 108]);
    expect(
      table.rows.map((r) =>
        r.map((c) => c.paragraphs.map((p) => p.map((x) => x.text).join('')).join()),
      ),
    ).toEqual([
      ['Sistem', 'F1'],
      ['Temel', '0,76'],
    ]);
  });

  it('sets a listing framed by rules as code, indented as on the page and fitted to the line', () => {
    const mono = (t: string, x: number) => ({
      ...span(t, x),
      font: { ...span(t, x).font, name: 'Inconsolata', family: 'mono' as const },
    });
    const long = `exec(${'x'.repeat(110)})`;
    const b = block('p0-b0', 'code', 300, [[mono('def run(self):', 50)], [mono(long, 70)]], {
      translatable: false,
    });
    b.lines.forEach((l, i) => {
      l.bbox.x0 = i ? 70 : 50;
      l.bbox.x1 = l.bbox.x0 + 5 * l.spans[0]!.text.length;
    });
    b.bbox.x1 = b.lines[1]!.bbox.x1;
    b.tableCell = { tableId: 't0', row: 0, col: 0, cellRect: { ...b.bbox } };
    const [item] = plan([page(0, [b])]).items as Extract<EditableItem, { kind: 'paragraph' }>[];
    expect(item!.style).toBe('code');
    expect(item!.runs.map((r) => r.text)).toEqual(['def run(self):', `    ${long}`]);
    expect(item!.runs[1]!.lineBreak).toBe(true);
    // 120 characters of Consolas in 451 pt.
    expect(item!.size).toBe(6.5);
  });

  it('sets an inline formula’s subscript as a Word subscript', () => {
    const m = (t: string, x: number, size = 10) => ({
      ...span(t, x, size),
      font: { ...span(t, x).font, name: 'CMMI10', isMath: true },
    });
    const b = block('p0-b0', 'body', 300, [
      [span('where ', 50), m('v', 80), m('t', 85, 7), span(' is the item.', 90)],
    ]);
    const t = b.lines[0]!.spans[2]!;
    t.baseline = b.lines[0]!.baseline + 3;
    const [item] = plan([page(0, [b])]).items as Extract<EditableItem, { kind: 'paragraph' }>[];
    expect(item!.runs.find((r) => r.text === 't')).toMatchObject({ subscript: true, math: true });
    expect(item!.runs.find((r) => r.text === 'v')?.subscript).toBeUndefined();
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

  it('draws a chart’s ticks and legend with the chart, not as pictures of their own', () => {
    const tick = (id: string, y: number, t: string) =>
      block(id, 'label', y, [[span(t, 70)]], { x0: 70, x1: 90 });
    const result = plan([
      page(0, [tick('p0-b0', 150, '0.75'), tick('p0-b1', 200, '0.5'), tick('p0-b2', 250, 'GMF')], {
        figures: [{ bbox: { x0: 60, y0: 140, x1: 280, y1: 320 }, formula: false }],
      }),
    ]);
    expect(result.pictures).toHaveLength(1);
    expect(result.items.map(text)).toEqual(['[picture]']);
  });
});

describe('editable Word output: front matter and references', () => {
  it('sets author names above the abstract as text, so sections are Heading 1', () => {
    const p = page(0, [
      block('p0-b0', 'heading', 40, [[span('On the Feasibility of Detection', 50, 17)]]),
      block('p0-b1', 'heading', 80, [[span('Piergiorgio Ladisa', 50, 12)]]),
      block('p0-b2', 'heading', 120, [[span('ABSTRACT', 50, 11)]]),
      block('p0-b3', 'body', 140, [[span('Current software supply chains rely on packages.', 50)]]),
      block('p0-b4', 'heading', 180, [[span('1 INTRODUCTION', 50, 11)]]),
    ]);
    const styles = new Map(
      plan([p]).items.flatMap((i) => (i.kind === 'paragraph' ? [[text(i), i.style]] : [])),
    );
    expect(styles.get('On the Feasibility of Detection')).toBe('title');
    expect(styles.get('Piergiorgio Ladisa')).toBe('body');
    expect(styles.get('ABSTRACT')).toBe('heading1');
    expect(styles.get('1 INTRODUCTION')).toBe('heading1');
  });

  it('gives each reference entry its own paragraph when the text extraction joined two', () => {
    const p = page(0, [
      block('p0-b0', 'heading', 40, [[span('REFERENCES', 50, 11)]]),
      block(
        'p0-b1',
        'reference',
        60,
        [
          [span('[19] Zhipeng Huang and Yeye He. 2018. Auto-Detect.', 50, 7)],
          [span('In Proceedings of SIGMOD, 1377-1392.', 50, 7)],
          [span('[20] Piergiorgio Ladisa et al. 2023. SoK: Taxonomy of Attacks.', 50, 7)],
        ],
        { translatable: false },
      ),
    ]);
    const refs = plan([p])
      .items.filter((i) => i.kind === 'paragraph' && /^\[\d+\]/.test(text(i)))
      .map((i) => text(i).slice(0, 4));
    expect(refs).toEqual(['[19]', '[20]']);
  });
});

describe('editable Word output: tables', () => {
  const cell = (id: string, y: number, x: number, row: number, col: number, t: string) => ({
    ...block(id, 'table-cell', y, [[span(t, x, 9)]], {
      x0: x,
      x1: x + 5 * t.length,
      translatable: false,
    }),
    tableCell: {
      tableId: 'p0-t0',
      row,
      col,
      cellRect: { x0: x, y0: y, x1: x + 120, y1: y + 12 },
    },
  });

  it('joins a cell’s second line, set as a row of its own, to the row above', () => {
    const p = page(0, [
      cell('p0-b0', 100, 50, 0, 0, 'Type'),
      cell('p0-b1', 100, 170, 0, 1, 'Description'),
      cell('p0-b2', 114, 50, 1, 0, 'Continuous'),
      cell('p0-b3', 114, 170, 1, 1, 'Mean of Shannon entropy of strings in'),
      cell('p0-b4', 128, 170, 2, 1, 'all source code files'),
      cell('p0-b5', 142, 50, 3, 0, 'Boolean'),
      cell('p0-b6', 142, 170, 3, 1, 'Usage of installation hooks'),
    ]);
    const table = plan([p]).items.find((i) => i.kind === 'table');
    if (table?.kind !== 'table') throw new Error('no table');
    const rows = table.rows.map((r) =>
      r.map((c) =>
        c.paragraphs
          .flat()
          .map((x) => x.text)
          .join(''),
      ),
    );
    expect(rows).toEqual([
      ['Type', 'Description'],
      ['Continuous', 'Mean of Shannon entropy of strings in all source code files'],
      ['Boolean', 'Usage of installation hooks'],
    ]);
  });
});
