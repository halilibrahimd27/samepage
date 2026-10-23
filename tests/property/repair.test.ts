import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { BlockIR, PageIR, Role } from '../../src/core/ir/types';
import type { DecodedRun } from '../../src/core/segment/codec';
import { DEFAULT_POLICY } from '../../src/layout-repair/policy';
import { inkBox, repairDocument, type RepairInput } from '../../src/layout-repair/repair';
import type { PdfStyle, PdfUnit } from '../../src/pdf/typeset/segments';
import type { Measurer } from '../../src/pdf/typeset/types';

/** Fixed-advance measurer (0.5 em per character) — layout logic only, no fonts. */
const measurer: Measurer = {
  width: (text, _face, size) => [...text].length * size * 0.5,
  covers: () => true,
  metrics: () => ({
    unitsPerEm: 1000,
    ascender: 0.9,
    descender: -0.25,
    xHeight: 0.5,
    capHeight: 0.7,
  }),
};

const ROLES: Role[] = ['body', 'heading', 'caption', 'label', 'footnote'];
const style: PdfStyle = {
  family: 'serif',
  bold: false,
  italic: false,
  color: [0, 0, 0],
  size: 10,
  fontName: 'Test',
};

interface Spec {
  role: Role;
  lines: number;
  width: number;
  factor: number;
}

/** Non-overlapping blocks stacked in one column of a 600×800 page. */
function build(specs: Spec[]): RepairInput {
  const blocks: BlockIR[] = [];
  const units: { unit: PdfUnit; runs: DecodedRun<PdfStyle>[] }[] = [];
  let y = 60;
  specs.forEach((sp, i) => {
    const lineH = 12;
    const bbox = { x0: 60, y0: y, x1: 60 + sp.width, y1: y + sp.lines * lineH };
    const lines = Array.from({ length: sp.lines }, (_, k) => ({
      bbox: { x0: 60, y0: y + k * lineH, x1: 60 + sp.width, y1: y + (k + 1) * lineH },
      baseline: y + k * lineH + 9,
      spans: [
        {
          text: 'x',
          bbox: { x0: 60, y0: y + k * lineH, x1: 60 + sp.width, y1: y + (k + 1) * lineH },
          font: {
            name: 'Test',
            family: 'serif' as const,
            bold: false,
            italic: false,
            isMath: false,
          },
          size: 10,
          color: [0, 0, 0] as [number, number, number],
        },
      ],
    }));
    const block: BlockIR = {
      id: `p0-b${i}`,
      bbox,
      role: sp.role,
      translatable: true,
      lines,
      align: 'left',
      direction: [1, 0],
      columnIndex: 0,
      readingOrder: i,
    };
    blocks.push(block);
    // Original text fills the box; the translation is `factor` times longer.
    const charsPerLine = Math.floor(sp.width / 5);
    const words = Math.max(1, Math.round((sp.lines * charsPerLine * sp.factor) / 6));
    const text = Array.from({ length: words }, (_, k) => 'abcde'.slice(0, 1 + (k % 5))).join(' ');
    units.push({
      unit: {
        id: block.id,
        role: sp.role,
        blocks: [block],
        encoded: { source: text, baseStyle: style, tags: [], placeholders: [] },
      },
      runs: [{ type: 'text', text, style }],
    });
    y = bbox.y1 + 6 + (i % 3) * 10;
  });
  const page: PageIR = {
    index: 0,
    width: 600,
    height: 800,
    rotation: 0,
    blocks,
    images: [],
    vectors: [],
    columns: [],
  };
  return { pages: [page], units, measurer, sizeFactor: () => 1, policy: DEFAULT_POLICY };
}

const specArb = fc.record({
  role: fc.constantFrom(...ROLES),
  lines: fc.integer({ min: 1, max: 6 }),
  width: fc.integer({ min: 60, max: 420 }),
  factor: fc.double({ min: 0.7, max: 1.8, noNaN: true }),
});

describe('layout repair properties', () => {
  it('terminates, is deterministic, and never leaves an unaccounted collision or out-of-bounds', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 8 }), (specs) => {
        const input = build(specs);
        const a = repairDocument(input);
        const b = repairDocument(build(specs));
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
        for (const issue of a.issues.filter(
          (i) => i.code === 'OUT_OF_BOUNDS' || i.code === 'COLLISION',
        )) {
          expect(
            a.units.find((u) => u.unitId === issue.unitId)?.fallback,
            issue.code,
          ).toBeDefined();
        }
        // Every unit either fits or carries a fallback.
        for (const u of a.units)
          expect(u.layouts.some((l) => l.overflow) ? u.fallback : 'ok').toBeDefined();
      }),
      { numRuns: 60 },
    );
  });

  it('is idempotent: repairing its own output needs no new fallback', () => {
    fc.assert(
      fc.property(fc.array(specArb, { minLength: 1, maxLength: 6 }), (specs) => {
        const input = build(specs);
        const first = repairDocument(input);
        // Feed the grown boxes back as the original geometry.
        const page = input.pages[0]!;
        for (const u of first.units) {
          const block = page.blocks.find((b) => b.id === u.unitId)!;
          const grown = u.params.boxes[block.id]!;
          block.bbox = grown;
        }
        const second = repairDocument(input);
        const fallbacks = (r: typeof first) =>
          r.units.filter((u) => u.fallback === 'keep-original').length;
        expect(fallbacks(second)).toBeLessThanOrEqual(fallbacks(first));
        for (const u of second.units)
          if (!u.fallback) expect(u.layouts.every((l) => !l.overflow)).toBe(true);
        expect(
          second.units.every((u) =>
            u.layouts.every((l) => inkBox(l) === null || inkBox(l)!.x1 <= 600),
          ),
        ).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});
