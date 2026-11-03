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

  it('reads a footnote mark raised only 1.6 pt in 9 pt text as a mark', () => {
    const b = block('p0-b0', 'body', 100, [words]);
    const line = b.lines[0]!;
    line.spans.push({
      ...span(' 1', 296, 7.3),
      bbox: { x0: 296, y0: 100, x1: 304, y1: 109 },
      baseline: line.baseline - 1.6,
    });
    const [unit] = buildPdfUnits([page(0, [b])]);
    expect(unit!.encoded.source).toMatch(/⟦N1⟧$/u);
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
          sizes: { body: 9, heading1: 10, reference: 7 },
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
    // The reference list at 7 pt keeps the PDF's proportion of leading: 11 × 7 / 9.
    expect(styles).toContain('w:line="171" w:lineRule="atLeast"');
    // Justified columns hyphenate, as the paper's do.
    expect(await zip.file('word/settings.xml')!.async('string')).toContain('<w:autoHyphenation/>');
  });

  it('centres an author line on a page of one column, and sets an abstract in from both sides', () => {
    const result = plan([
      page(
        0,
        [
          block('p0-a', 'heading', 60, ['Ali BALTACI'], {
            x0: 280,
            x1: 330,
            size: 10,
            align: 'left',
          }),
          block('p0-b', 'body', 100, [words, words, words], { x0: 84, x1: 528 }),
          block('p0-c', 'body', 160, [words, words, words], { x0: 54, x1: 558 }),
          block('p0-d', 'body', 220, [words, words, words], { x0: 54, x1: 558 }),
        ],
        { columns: [] },
      ),
    ]);
    const [author, abstract] = paragraphs(result.items);
    expect(author).toMatchObject({ align: 'center' });
    const right = plan([
      page(
        0,
        [
          block('p0-a', 'body', 60, ['Chiara Marchetti'], { x0: 470, x1: 558, align: 'left' }),
          block('p0-c', 'body', 160, [words, words, words], { x0: 54, x1: 558 }),
        ],
        { columns: [] },
      ),
    ]);
    expect(paragraphs(right.items)[0]).toMatchObject({ align: 'right' });
    expect(abstract).toMatchObject({ align: 'justify', indent: { left: 30, right: 30 } });
  });

  it('draws a figure of panels as one picture, with the legends and titles between them', () => {
    const label = (id: string, y: number, text: string, x0: number) =>
      block(id, 'label', y, [text], { x0, x1: x0 + 4 * text.length, size: 8, align: 'left' });
    const result = plan([
      page(
        0,
        [
          block('p0-t', 'heading', 398, ['npm'], { x0: 174, x1: 190, size: 10, align: 'left' }),
          label('p0-a', 432, 'Total:', 175),
          label('p0-b', 443, 'Mono-language (npm) = 1229', 175),
          label('p0-c', 432, 'Total:', 439),
          label('p0-d', 443, 'Mono-language (PyPI) = 561', 439),
          block('p0-f', 'caption', 602, ['Figure 4: Comparison of results for the samples'], {
            x0: 54,
            x1: 558,
          }),
          block('p0-r', 'body', 640, [words, words], { x0: 54, x1: 296 }),
        ],
        {
          figures: [
            { bbox: { x0: 64, y0: 413, x1: 170, y1: 498 }, formula: false },
            { bbox: { x0: 330, y0: 413, x1: 436, y1: 498 }, formula: false },
          ],
        },
      ),
    ]);
    expect(result.pictures).toHaveLength(1);
    expect(result.pictures[0]!.rect).toMatchObject({ y0: 396 });
    expect(result.pictures[0]!.rect.x1).toBeGreaterThan(540);
    const text = paragraphs(result.items).map((p) => p.runs.map((r) => r.text).join(''));
    expect(text.some((t) => /Total|Mono-language|^npm/u.test(t))).toBe(false);
    expect(text.some((t) => t.startsWith('Figure 4'))).toBe(true);
  });

  it('measures paragraph spacing from baselines: none where paragraphs follow line by line', () => {
    const one = (id: string, y: number) =>
      block(id, 'body', y, [words, words, words], { first: 64 });
    // Paragraphs one leading apart, as ACM sets them (block boxes 2 pt apart).
    const result = plan([page(0, [one('p0-a', 100), one('p0-b', 133), one('p0-c', 166)])]);
    expect(result.layout?.after).toBe(0);
  });

  it('keeps three columns, and a title across the second and third as wide', () => {
    const three = [
      { x0: 40, x1: 200, y0: 0, y1: 792 },
      { x0: 216, x1: 376, y0: 0, y1: 792 },
      { x0: 392, x1: 552, y0: 0, y1: 792 },
    ];
    const col = (id: string, y: number, x0: number) =>
      block(id, 'body', y, [words, words, words], { x0, x1: x0 + 160 });
    const pages = [0, 1].map((n) =>
      page(
        n,
        [
          ...(n === 0
            ? [
                block('p0-t', 'heading', 40, ['A Title Over Two Columns'], {
                  x0: 216,
                  x1: 552,
                  size: 18,
                  align: 'left',
                }),
              ]
            : []),
          col(`p${n}-a`, 120, 40),
          col(`p${n}-b`, 120, 216),
          col(`p${n}-c`, 120, 392),
        ],
        { columns: three },
      ),
    );
    const result = plan(pages);
    expect(result.layout?.columns).toBe(3);
    expect(paragraphs(result.items)[0]).toMatchObject({ wide: true });
  });
});

describe('a deck of slides in Word', () => {
  const slide = (index: number, blocks: BlockIR[]): PageIR => ({
    index,
    width: 960,
    height: 540,
    rotation: 0,
    blocks,
    images: [],
    vectors: [],
    columns: [{ x0: 56, x1: 904, y0: 0, y1: 540 }],
  });
  const white = (b: BlockIR): BlockIR => ({
    ...b,
    lines: b.lines.map((l) => ({
      ...l,
      spans: l.spans.map((s) => ({ ...s, color: [1, 1, 1] as [number, number, number] })),
    })),
  });

  it('sets each slide on a page of its own, its text in frames over its picture', async () => {
    const result = plan([
      slide(0, [
        white(
          block('p0-t', 'heading', 120, ['Pipeline Security'], {
            x0: 56,
            x1: 420,
            size: 40,
            align: 'left',
          }),
        ),
        block('p0-l', 'body', 300, ['> SCA', '> SAST'], {
          x0: 72,
          x1: 140,
          size: 12,
          align: 'left',
        }),
      ]),
      slide(1, [
        block('p1-t', 'heading', 60, ['Second slide'], {
          x0: 56,
          x1: 300,
          size: 24,
          align: 'left',
        }),
      ]),
    ]);
    const slides = result.items.flatMap((i) => (i.kind === 'slide' ? [i] : []));
    expect(slides).toHaveLength(2);
    expect(result.backgrounds?.map((b) => b.page)).toEqual([0, 1]);
    // Every block's text is taken off the picture it is set over.
    expect(result.backgrounds?.[0]?.redact).toHaveLength(2);
    const [title, list] = slides[0]!.frames;
    // White text over the slide's dark picture stays white; the title keeps its size.
    expect(title!.paragraphs[0]!.runs[0]).toMatchObject({ color: 'FFFFFF' });
    expect(title!.paragraphs[0]!.size).toBe(40);
    // A list that ran together starts each item on a line again.
    expect(list!.paragraphs[0]!.runs.filter((r) => r.lineBreak)).toHaveLength(1);

    const docx = await buildEditableDocx(result.items, [new Uint8Array([1]), new Uint8Array([2])], {
      locale: 'en-US',
      page: { width: 960, height: 540 },
    });
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    expect(xml.match(/<w:sectPr>/g)).toHaveLength(2);
    expect(xml).toContain('<w:pgSz w:w="19200" w:h="10800" w:orient="landscape"/>');
    expect(xml).toContain('w:hAnchor="page" w:vAnchor="page"');
    expect(xml.match(/behindDoc="1"/g)).toHaveLength(2);
  });

  it('makes a frame as high as its text runs, and sets a number column’s header right', () => {
    // A table drawn in the slide's picture: its cells as boxes, the header at its cell's right.
    const cell = (x0: number, x1: number) => ({
      bbox: { x0, y0: 145, x1, y1: 170 },
      isRectangle: true,
      isStroked: false,
      picture: true,
    });
    const result = plan([
      {
        ...slide(0, [
          block('p0-a', 'body', 151, ['Attribute'], { x0: 72, x1: 122, size: 12, align: 'left' }),
          block('p0-h', 'body', 151, ['Harmful'], { x0: 704, x1: 755, size: 12, align: 'left' }),
        ]),
        vectors: [cell(64, 497), cell(629, 762)],
      },
    ]);
    const [slide0] = result.items.flatMap((i) => (i.kind === 'slide' ? [i] : []));
    const [label, header] = slide0!.frames;
    expect(label!.paragraphs[0]!.align).toBe('left');
    expect(header!.paragraphs[0]!.align).toBe('right');
    // Pages hides a line its box has no room for: a line's height and one more to spare.
    for (const f of [label!, header!]) expect(f.height).toBeGreaterThan(2 * 12);
  });

  it('keeps a paper in portrait to its flow', () => {
    const result = plan([page(0, [block('p0-b', 'body', 100, [words, words])])]);
    expect(result.items.some((i) => i.kind === 'slide')).toBe(false);
    expect(result.backgrounds).toBeUndefined();
  });
});

describe('text turned in the margin', () => {
  it('keeps arXiv’s stamp where the page has it, as a picture of it', async () => {
    const stamp: BlockIR = {
      ...block('p0-s', 'header', 200, ['arXiv:2412.05259v1 [cs.SE] 6 Dec 2024'], {
        x0: 14,
        x1: 34,
        size: 20,
        align: 'left',
      }),
      bbox: { x0: 14, y0: 200, x1: 34, y1: 560 },
      direction: [0, -1],
    };
    const result = plan([page(0, [stamp, block('p0-b', 'body', 100, [words, words])])]);
    const turned = result.items.find((i) => i.kind === 'stamp');
    // Pages sets turned text a letter per line: the stamp goes in as a picture, its words told.
    expect(turned).toMatchObject({ text: 'arXiv:2412.05259v1 [cs.SE] 6 Dec 2024', x: 13, y: 199 });
    expect(result.pictures[(turned as { picture: number }).picture]).toEqual({
      page: 0,
      rect: { x0: 13, y0: 199, x1: 35, y1: 561 },
    });
    const docx = await buildEditableDocx(result.items, [new Uint8Array([1])], {
      locale: 'tr-TR',
      page: { width: 612, height: 792 },
    });
    const xml = await (await JSZip.loadAsync(docx)).file('word/document.xml')!.async('string');
    expect(xml).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>165100</wp:posOffset>');
    expect(xml).toContain('descr="arXiv:2412.05259v1 [cs.SE] 6 Dec 2024"');
    expect(xml).not.toContain('w:textDirection');
  });
});

describe('a Word file laid out as the PDF, page by page', () => {
  const run = (text: string, x: number, size = 9) => ({
    text,
    face: 'serif-regular' as const,
    size,
    color: [0, 0, 0] as [number, number, number],
    x,
    width: 4.2 * text.length,
    rise: 0,
  });
  const body = block('p0-b', 'body', 100, [words, words]);
  const number = block('p0-n', 'page-number', 760, ['7'], { x0: 300, x1: 306, align: 'center' });
  const text = (vectors: PageIR['vectors'] = []) => {
    const pages = [page(0, [body, number], { vectors })];
    return planEditable(
      pages,
      buildPdfUnits(pages).map((unit) => ({
        unit,
        runs: decode(unit.encoded.source, unit.encoded),
      })),
      () => true,
      {
        // The PDF's lines of the translation: each word at its place.
        layouts: new Map([
          [
            'p0-b',
            {
              blockId: 'p0-b',
              unitId: 'u',
              scale: 1,
              overflow: false,
              lines: [
                {
                  baseline: 108,
                  x0: 54,
                  x1: 296,
                  wordSpacing: 0,
                  runs: [run('Bu', 54), run('satır', 66)],
                },
                { baseline: 119, x0: 54, x1: 120, wordSpacing: 0, runs: [run('ikinci', 54)] },
              ],
            },
          ],
        ]),
        redactions: new Map([[0, [body.bbox]]]),
        notes: [{ page: 0, text: 'Notta kalan çeviri' }],
      },
    );
  };

  it('sets each page at its size, the PDF’s lines in a frame where the PDF sets them', () => {
    const result = text();
    const [slide, note] = result.items;
    expect(slide).toMatchObject({ kind: 'slide', width: 612, height: 792 });
    const frames = (slide as Extract<EditableItem, { kind: 'slide' }>).frames;
    const runs = frames[0]!.paragraphs[0]!.runs;
    // Words set apart are one run with a space; the next line starts on a new line.
    expect(runs.map((r) => r.text)).toEqual(['Bu satır', 'ikinci']);
    expect(runs[1]!.lineBreak).toBe(true);
    expect(frames[0]!.x).toBeCloseTo(53, 0);
    // The page number, kept, is text too: a page of nothing but text needs no picture.
    expect(frames[1]!.paragraphs[0]!.runs[0]!.text).toBe('7');
    expect(result.backgrounds).toEqual([]);
    // A translation the PDF could only put in a note follows the pages.
    expect(note).toMatchObject({
      kind: 'paragraph',
      runs: [{ text: '1: ' }, { text: 'Notta kalan çeviri' }],
    });
  });

  it('puts the page behind its frames when it draws more than text', () => {
    const result = text([
      { bbox: { x0: 54, y0: 300, x1: 296, y1: 301 }, isRectangle: true, isStroked: true },
    ]);
    expect(result.backgrounds).toHaveLength(1);
    // The PDF's own boxes taken out, and the page number's line.
    expect(result.backgrounds![0]!.redact).toHaveLength(2);
  });
});
