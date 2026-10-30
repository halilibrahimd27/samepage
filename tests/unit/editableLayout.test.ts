import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { BlockIR, PageIR, Role, SpanIR } from '../../src/core/ir/types';
import { decode } from '../../src/core/segment/codec';
import { buildEditableDocx, type EditableItem } from '../../src/docx/editable';
import { planEditable } from '../../src/pdf/editable';
import { buildPdfUnits } from '../../src/pdf/typeset/segments';

const span = (text: string, x: number, size = 9): SpanIR => ({
  text,
  bbox: { x0: x, y0: 0, x1: x + 4 * text.length, y1: size },
  font: { name: 'LinLibertineT', family: 'serif', bold: false, italic: false, isMath: false },
  size,
  color: [0, 0, 0],
});
let order = 0;
/** A block of lines from `x0` to `x1`, the first line starting at `first` (an indent). */
function block(
  id: string,
  role: Role,
  y: number,
  lines: string[],
  opts: { x0?: number; x1?: number; first?: number; size?: number; align?: BlockIR['align'] } = {},
): BlockIR {
  const { x0 = 54, x1 = 296, size = 9, align = 'justify' } = opts;
  const first = opts.first ?? x0;
  return {
    id,
    bbox: { x0: Math.min(x0, first), y0: y, x1, y1: y + 11 * lines.length },
    role,
    translatable: true,
    lines: lines.map((t, i) => {
      const lx = i ? x0 : first;
      return {
        bbox: { x0: lx, y0: y + 11 * i, x1: x1, y1: y + 9 + 11 * i },
        baseline: y + 8 + 11 * i,
        spans: [{ ...span(t, lx, size), bbox: { x0: lx, y0: y + 11 * i, x1, y1: y + 9 + 11 * i } }],
      };
    }),
    align,
    direction: [1, 0],
    columnIndex: x0 > 300 ? 1 : 0,
    readingOrder: order++,
  };
}
const columns = [
  { x0: 54, x1: 296, y0: 0, y1: 792 },
  { x0: 316, x1: 558, y0: 0, y1: 792 },
];
const page = (index: number, blocks: BlockIR[], extra: Partial<PageIR> = {}): PageIR => ({
  index,
  width: 612,
  height: 792,
  rotation: 0,
  blocks,
  images: [],
  vectors: [],
  columns,
  ...extra,
});
const plan = (pages: PageIR[]) =>
  planEditable(
    pages,
    buildPdfUnits(pages).map((unit) => ({ unit, runs: decode(unit.encoded.source, unit.encoded) })),
  );
const paragraphs = (items: EditableItem[]) =>
  items.flatMap((i) => (i.kind === 'paragraph' ? [i] : []));
const words = 'The running text of the paper goes on over the whole width of its column here';

describe('editable Word output keeps the layout of the PDF', () => {
  it('measures the columns, type and leading, and keeps first-line indents and justification', () => {
    const body = (id: string, y: number, x0: number, x1: number) =>
      block(id, 'body', y, [words, words, words], { x0, x1, first: x0 + 10 });
    const result = plan([
      page(0, [
        block('p0-b0', 'heading', 60, ['A Title Across Both Columns'], {
          x0: 150,
          x1: 462,
          size: 14,
          align: 'center',
        }),
        block('p0-b1', 'heading', 100, ['1 INTRODUCTION'], { size: 10, align: 'left' }),
        body('p0-b2', 120, 54, 296),
        body('p0-b3', 160, 54, 296),
        body('p0-b4', 120, 316, 558),
        body('p0-b5', 160, 316, 558),
      ]),
    ]);
    expect(result.layout).toMatchObject({
      columns: 2,
      gap: 20,
      font: 'Times New Roman',
      leading: 11,
      margins: { left: 54, right: 54 },
      sizes: { body: 9 },
    });
    const [title, ...rest] = paragraphs(result.items);
    expect(title).toMatchObject({ style: 'title', wide: true });
    const text = rest.filter((p) => p.style === 'body');
    expect(text.every((p) => p.align === 'justify' && p.indent?.firstLine === 10)).toBe(true);
    expect(text.some((p) => p.wide)).toBe(false);
  });

  it('gives numbered headings their level from the number', () => {
    const result = plan([
      page(0, [
        block('p0-b0', 'heading', 100, ['3 MODELS TRAINING'], { size: 10, align: 'left' }),
        block('p0-b1', 'body', 120, [words, words, words]),
        block('p0-b2', 'heading', 160, ['3.1 Datasets'], { size: 10, align: 'left' }),
        block('p0-b3', 'body', 180, [words, words, words]),
      ]),
    ]);
    expect(paragraphs(result.items).map((p) => p.style)).toEqual([
      'heading1',
      'body',
      'heading2',
      'body',
    ]);
  });

  it('writes the columns as Word sections, the wide title block in one column', async () => {
    const docx = await buildEditableDocx(
      [
        {
          kind: 'paragraph',
          style: 'title',
          align: 'center',
          runs: [{ text: 'Title' }],
          wide: true,
        },
        { kind: 'paragraph', style: 'body', align: 'justify', runs: [{ text: 'Text' }] },
        {
          kind: 'paragraph',
          style: 'body',
          align: 'justify',
          runs: [{ text: 'Indented' }],
          indent: { firstLine: 10 },
          size: 7,
        },
      ],
      [],
      {
        locale: 'tr-TR',
        page: { width: 612, height: 792 },
        layout: {
          margins: { top: 54, right: 54, bottom: 54, left: 54 },
          columns: 2,
          gap: 20,
          font: 'Times New Roman',
          headingFont: 'Arial',
          sizes: { body: 9, heading1: 10 },
          leading: 11,
          after: 0,
        },
      },
    );
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file('word/document.xml')!.async('string');
    const styles = await zip.file('word/styles.xml')!.async('string');
    const sections = [...xml.matchAll(/<w:sectPr>.*?<\/w:sectPr>/g)].map((m) => m[0]);
    expect(sections).toHaveLength(2);
    expect(sections[0]).not.toContain('<w:cols');
    expect(sections[1]).toContain('<w:type w:val="continuous"/>');
    expect(sections[1]).toContain('<w:cols w:num="2" w:space="400"/>');
    expect(sections[1]).toContain('w:left="1080"');
    expect(xml).toContain('<w:ind w:firstLine="200"/>');
    expect(xml).toContain('<w:sz w:val="14"/>');
    expect(styles).toContain('w:ascii="Times New Roman"');
    expect(styles).toContain('<w:sz w:val="18"/>');
    expect(styles).toContain('w:line="220" w:lineRule="atLeast"');
  });
});
