import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlockIR } from '../../src/core/ir/types';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { blockText, extractAndAnalyze } from '../../src/pdf/analyze';
import type { RawPage } from '../../src/pdf/extract/raw';
import { loadFaces, openPdfForExtraction, renderPagePixels, type PagePixels } from '../../src/pdf/engine';
import { translatePdf } from '../../src/pdf/pipeline';

/**
 * Identity check (TESTING.md §3): pseudo ×1.0 without letter substitution must reproduce the
 * original pages closely, isolating typesetting/font errors from translation effects.
 */
const FIXTURES = ['one-column-basic', 'two-column', 'formulas-tables', 'colored-figures', 'two-column-floats', 'thesis-spacing'];
// Whitespace, dashes, format characters and accents are ignored: the new typesetting breaks lines
// at different places and inline math is re-set approximately (ˆy → ŷ).
const norm = (s: string) => s.normalize('NFD').replace(/[\s\p{Pd}\p{M}\p{Cf}\p{Sk}\p{Lm}]+/gu, '');

function diffRatio(a: PagePixels, b: PagePixels, rects: BlockIR['bbox'][], scale: number) {
  let changed = 0;
  let total = 0;
  for (const r of rects) {
    for (let y = Math.floor(r.y0 * scale); y < Math.ceil(r.y1 * scale); y++) {
      for (let x = Math.floor(r.x0 * scale); x < Math.ceil(r.x1 * scale); x++) {
        const i = (y * a.width + x) * 3;
        total++;
        if (Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 96) changed++;
      }
    }
  }
  return total ? changed / total : 0;
}

/** Characters whose centre lies inside `box`, in line order (raw extraction, both sides). */
function charsIn(raw: RawPage, box: BlockIR['bbox']): string {
  const inside = raw.blocks
    .flatMap((bl) => bl.lines.flatMap((l) => l.chars))
    .filter((c) => {
      const cx = (c.bbox.x0 + c.bbox.x1) / 2;
      const cy = (c.bbox.y0 + c.bbox.y1) / 2;
      return cx >= box.x0 - 1 && cx <= box.x1 + 1 && cy >= box.y0 - 1 && cy <= box.y1 + 1;
    });
  // Superscript/subscript glyphs (footnote marks, indices) are ignored: their raised or lowered
  // baselines make the line order ambiguous; they are checked as atoms elsewhere.
  const sizes = inside.map((c) => c.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 10;
  return inside
    .filter((c) => c.size >= median * 0.8)
    .sort((a, b) => Math.round(a.y) - Math.round(b.y) || a.x - b.x)
    .map((c) => c.c)
    .join('');
}

async function rawPages(bytes: Uint8Array): Promise<RawPage[]> {
  const pdf = await openPdfForExtraction(bytes);
  const pages = Array.from({ length: pdf.pageCount }, (_, i) => pdf.extractPage(i));
  pdf.close();
  return pages;
}

describe.each(FIXTURES)('PDF identity check: %s', (name) => {
  it('reproduces text, positions and untouched formulas', async () => {
    const input = new Uint8Array(readFileSync(`tests/corpus/pdf/${name}.pdf`));
    const faces = await loadFaces((file) => Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${file}`))));
    const { mono, report } = await translatePdf(input, {
      engine: createPseudoEngine({ factor: 1, substitute: false }),
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      faces,
      maxPages: 50,
      dual: false,
      resetIdentical: true,
      signal: new AbortController().signal,
    });
    faces.destroy();
    mkdirSync('tests/golden/__out__', { recursive: true });
    writeFileSync(`tests/golden/__out__/${name}.identity.pdf`, mono);

    const before = await extractAndAnalyze(input, 50);
    const rawBefore = await rawPages(input);
    const rawAfter = await rawPages(mono);
    // Units: a chain is compared as a whole (text may move between its boxes).
    const blocks = before.flatMap((p) => p.blocks.map((b) => ({ p: p.index, b })));
    const units = new Map<string, { p: number; b: BlockIR }[]>();
    for (const x of blocks.filter((x) => x.b.translatable)) {
      const key = x.b.chain?.paragraphId ?? x.b.id;
      units.set(key, [...(units.get(key) ?? []), x]);
    }
    // Layout repair may widen a single-line heading/caption box (R2) up to its column edge.
    const region = (p: number, b: BlockIR) => {
      if (b.lines.length !== 1 || !['heading', 'caption', 'body'].includes(b.role)) return b.bbox;
      const page = before[p]!;
      const right = b.columnIndex >= 0 && page.columns[b.columnIndex] ? page.columns[b.columnIndex]!.x1 : page.width;
      const left = b.align === 'center' ? (b.columnIndex >= 0 && page.columns[b.columnIndex] ? page.columns[b.columnIndex]!.x0 : 0) : b.bbox.x0;
      return { ...b.bbox, x0: left, x1: right };
    };
    const unitText = (raw: RawPage[], members: { p: number; b: BlockIR }[]) => norm(members.map(({ p, b }) => charsIn(raw[p]!, region(p, b))).join(''));
    const all = [...units.entries()];
    const red = all.filter(([, m]) => unitText(rawAfter, m) !== unitText(rawBefore, m));
    const ratio = (all.length - red.length) / all.length;
    const redList = red.map(([k, m]) => {
      const x = unitText(rawBefore, m);
      const y = unitText(rawAfter, m);
      let i = 0;
      while (i < x.length && x[i] === y[i]) i++;
      return `${k}: ${blockText(m[0]!.b).slice(0, 30)} | at ${i}: before=…${x.slice(Math.max(0, i - 15), i + 25)} | after=…${y.slice(Math.max(0, i - 15), i + 25)}`;
    });

    expect(report.summary.missingGlyphs).toEqual([]);
    expect(report.summary.untranslated + report.summary.keptOriginal).toBe(0);
    expect(rawAfter.flatMap((p) => p.blocks).length).toBeGreaterThan(0);
    // Links over translated text are moved, never lost (P4.7).
    const links = (raw: RawPage[]) => raw.flatMap((p) => p.links.map((l) => l.uri)).sort();
    expect(links(rawAfter)).toEqual(links(rawBefore));
    expect(ratio, `red units:\n${redList.join('\n')}`).toBeGreaterThanOrEqual(0.98);

    const scale = 96 / 72;
    for (const p of before) {
      const formulas = p.blocks.filter((b) => b.role === 'formula').map((b) => b.bbox);
      if (!formulas.length) continue;
      expect(diffRatio(await renderPagePixels(input, p.index, scale), await renderPagePixels(mono, p.index, scale), formulas, scale)).toBeLessThan(0.001);
    }
  });
});
