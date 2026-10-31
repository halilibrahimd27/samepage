import { describe, expect, it } from 'vitest';
import { analyzeDocument, blockText } from '../../src/pdf/analyze/analyze';
import type { RawLine, RawPage } from '../../src/pdf/extract/raw';
import { SELF_CITATION_LABEL, REFERENCES_HEADING } from '../../src/core/references';
import { hyphenEvidence, joinHyphen } from '../../src/pdf/typeset/segments';

type Cell = [x0: number, y0: number, text: string, size?: number];

const line = ([x0, y0, text, size = 10]: Cell): RawLine => {
  const w = text.length * size * 0.45;
  return {
    bbox: { x0, y0, x1: x0 + w, y1: y0 + size },
    dir: [1, 0],
    wmode: 0,
    chars: [...text].map((c, i) => ({
      c,
      x: x0 + i * size * 0.45,
      y: y0 + size - 2,
      bbox: { x0: x0 + i * size * 0.45, y0, x1: x0 + (i + 1) * size * 0.45, y1: y0 + size },
      font: 'Serif',
      size,
      color: [0, 0, 0] as [number, number, number],
    })),
  };
};

const page = (index: number, cells: Cell[]): RawPage => ({
  index,
  width: 612,
  height: 792,
  rotation: 0,
  blocks: cells.map((c) => {
    const l = line(c);
    return { bbox: l.bbox, lines: [l] };
  }),
  images: [],
  vectors: [],
  links: [],
  fonts: {},
});

const body = (y: number): Cell[] =>
  [0, 1, 2].map(
    (i) => [72, y + i * 12, 'The quick brown fox jumps over the lazy dog again.'] as Cell,
  );

describe('reference lists', () => {
  const pages = analyzeDocument([
    page(0, [...body(100), ...body(160), ...body(220)]),
    page(1, [
      ...body(80),
      [72, 200, 'References', 14],
      [72, 230, '[1] A. Author and B. Writer. A title that wraps onto', 8],
      [84, 240, 'the next line. Journal 1, 2020.', 8],
      [72, 250, '[2] C. Editor. Another title. Journal 2, 2021.', 8],
      [72, 260, '[3] D. Person. Third title that goes on and on and', 8],
      [84, 270, 'ends here. Conf. 2019.', 8],
      [72, 280, '[4] E. Last. Fourth. 2018.', 8],
    ]),
  ]);

  it('reads every line below the heading as reference, chained by entry', () => {
    const refs = pages[1]!.blocks.filter((b) => b.role === 'reference');
    expect(refs.map((b) => blockText(b).slice(0, 5))).toEqual([
      '[1] A',
      'the n',
      '[2] C',
      '[3] D',
      'ends ',
      '[4] E',
    ]);
    expect(refs.every((b) => !b.translatable)).toBe(true);
    const head = (i: number) => refs[i]!.chain?.paragraphId;
    expect(head(1)).toBe(head(0));
    expect(head(2)).not.toBe(head(0));
    expect(head(4)).toBe(head(3));
    expect(refs[5]!.chain).toBeUndefined();
  });

  it('knows the heading in more languages', () => {
    for (const t of [
      '7. REFERENCES',
      'Литература и Интернет-источники',
      'Referências',
      '6.2 Bibliografía',
      'Zdroje',
    ])
      expect(REFERENCES_HEADING.test(t), t).toBe(true);
    for (const t of ['Literature review', '2. Related work'])
      expect(REFERENCES_HEADING.test(t)).toBe(false);
  });
});

describe('a paper citing itself', () => {
  it('knows the labels', () => {
    for (const t of [
      'ACM Reference Format:',
      'Cite this article:',
      'Pour citer cet article :',
      'Для цитирования:',
      'Cytowanie:',
      'Cómo citar este artículo:',
      'Jak citovat tento článek:',
    ])
      expect(SELF_CITATION_LABEL.test(t), t).toBe(true);
    expect(SELF_CITATION_LABEL.test('Citation analysis shows that')).toBe(false);
  });

  it('keeps the citation as published, the label stays text', () => {
    const [p] = analyzeDocument([
      page(0, [
        ...body(60),
        [72, 200, 'ACM Reference Format:'],
        [
          72,
          214,
          'Jane Doe. 2023. On the Feasibility of Things. In Annual Conference (ACSAC 23), December 4-8.',
        ],
        ...body(300),
      ]),
    ]);
    const cite = p!.blocks.find((b) => blockText(b).startsWith('Jane Doe'))!;
    const label = p!.blocks.find((b) => blockText(b).startsWith('ACM Reference'))!;
    expect(cite.role).toBe('reference');
    expect(cite.translatable).toBe(false);
    expect(label.translatable).toBe(true);
  });
});

describe('bold lines', () => {
  it('reads a bold heading as one, a bold item of a bulleted list as text', () => {
    const bold = (y: number, text: string) => {
      const c = page(0, [[72, y, text]]).blocks[0]!;
      for (const ch of c.lines[0]!.chars) ch.font = 'Serif-Bold';
      return c;
    };
    const raw = page(0, [...body(60), ...body(200)]);
    raw.blocks.push(bold(120, 'Material flow'), bold(140, '• the stock and its value,'));
    raw.fonts = {
      'Serif-Bold': { name: 'Serif-Bold', bold: true, italic: false, serif: true, mono: false },
    };
    const [p] = analyzeDocument([raw]);
    const role = (t: string) => p!.blocks.find((b) => blockText(b).startsWith(t))!.role;
    expect(role('Material')).toBe('heading');
    expect(role('•')).toBe('body');
  });
});

describe('scripts set apart', () => {
  it('joins a subscript that came out as its own block to the formula in its line', () => {
    const math = (c: Cell) => {
      const l = line(c);
      for (const ch of l.chars) ch.font = 'CMMI10';
      return l;
    };
    const a = line([72, 140, 'chronological order for user u, where ']);
    const v = math([a.bbox.x1, 140, 'v']);
    const b = line([v.bbox.x1 + 3, 140, ' is the item that the user has interacted with.']);
    const raw = page(0, [...body(60), ...body(200)]);
    raw.blocks.push({
      bbox: { ...a.bbox, x1: b.bbox.x1 },
      lines: [
        { ...a, bbox: { ...a.bbox, x1: b.bbox.x1 }, chars: [...a.chars, ...v.chars, ...b.chars] },
      ],
    });
    const t = math([v.bbox.x1, 146, 't', 7]);
    raw.blocks.push({ bbox: t.bbox, lines: [t] });
    const [p] = analyzeDocument([raw]);
    expect(p!.blocks.some((x) => blockText(x).trim() === 't')).toBe(false);
    const host = p!.blocks.find((x) => blockText(x).startsWith('chronological'))!;
    expect(host.lines[0]!.spans.map((sp) => sp.text.trim()).filter(Boolean)).toContain('t');
  });
});

describe('a line in pieces', () => {
  it('keeps a line that came in blocks split at its scripts in one paragraph', () => {
    const at = (c: Cell, dy = 0) => {
      const l = line(c);
      for (const ch of l.chars) ch.y += dy;
      return l;
    };
    const one = at([72, 100, 'Due to the one-hot encoding of user ID of the input layer,']);
    const two = at([72, 112, 'latent vector of user. Let the user latent vector p be P v']);
    const sup = at([two.bbox.x1, 108, 'U', 6], -4);
    const sub = at([two.bbox.x1, 115, 'u', 6], 2);
    const rest = at([sub.bbox.x1 + 2, 112, ' and item latent vector q be Q v. We define']);
    const next = at([72, 124, 'the mapping function of the first neural CF layer as follows.']);
    const raw = page(0, [...body(300)]);
    const tail = {
      ...two,
      bbox: { ...two.bbox, x1: sup.bbox.x1 },
      chars: [...two.chars, ...sup.chars],
    };
    const head = {
      ...sub,
      bbox: { ...sub.bbox, x1: rest.bbox.x1 },
      chars: [...sub.chars, ...rest.chars],
    };
    raw.blocks.push(
      { bbox: { ...one.bbox, y1: tail.bbox.y1 }, lines: [one, tail] },
      { bbox: { ...head.bbox, y1: next.bbox.y1 }, lines: [head, next] },
    );
    const [p] = analyzeDocument([raw]);
    const host = p!.blocks.find((b) => blockText(b).startsWith('Due to'))!;
    expect(blockText(host)).toContain('and item latent vector');
    expect(blockText(host)).toContain('mapping function');
  });
});

describe('footnotes', () => {
  it('keeps a marked note with its lines, and reads other small text as body', () => {
    const [p] = analyzeDocument([
      page(0, [
        ...body(60),
        ...body(110),
        [72, 700, '1 A note at the foot of the page that goes on', 7],
        [72, 709, 'with a second line of its own.', 7],
        [72, 740, 'Items of a table that are small and low', 7],
      ]),
    ]);
    const notes = p!.blocks.filter((b) => b.role === 'footnote');
    expect(notes.map((b) => blockText(b))).toEqual([
      '1 A note at the foot of the page that goes on with a second line of its own.',
    ]);
    expect(p!.blocks.find((b) => blockText(b).startsWith('Items'))!.role).toBe('body');
  });
});

describe('hyphenation at line ends', () => {
  const line1 = (text: string) => ({
    bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
    baseline: 1,
    spans: [
      {
        text,
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
        font: { name: 'x', family: 'serif' as const, bold: false, italic: false, isMath: false },
        size: 10,
        color: [0, 0, 0] as [number, number, number],
      },
    ],
  });
  const evidence = hyphenEvidence([
    {
      index: 0,
      width: 1,
      height: 1,
      rotation: 0,
      images: [],
      vectors: [],
      columns: [],
      blocks: [
        {
          id: 'p0-b0',
          bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
          role: 'body',
          translatable: true,
          lines: [
            line1('the Self-Attention layer and pretraining of the model'),
            line1('a hyper-parameter'),
            line1('self-'),
          ],
          align: 'left',
          direction: [1, 0],
          columnIndex: 0,
          readingOrder: 0,
        },
      ],
    },
  ]);

  it('keeps the hyphen of a compound the document writes with one', () => {
    expect(joinHyphen('the self-', 'attention layer', evidence)).toBe('the self-');
  });

  it('reads another form of the word as evidence too', () => {
    expect(joinHyphen('two hyper-', 'parameters', evidence)).toBe('two hyper-');
    expect(joinHyphen('the pre-', 'trained model', evidence)).toBe('the pre');
  });

  it('drops it for a word written whole, and by default', () => {
    expect(joinHyphen('before pre-', 'training of', evidence)).toBe('before pre');
    expect(joinHyphen('ge-', 'lişme', evidence)).toBe('ge');
    expect(joinHyphen('ge-', 'lişme')).toBe('ge');
  });

  it('keeps it before a capital or a digit', () => {
    expect(joinHyphen('COVID-', '19 cases', evidence)).toBe('COVID-');
    expect(joinHyphen('Von-', 'Neumann', evidence)).toBe('Von-');
  });
});
