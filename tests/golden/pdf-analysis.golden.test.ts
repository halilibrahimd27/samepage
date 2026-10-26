import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlockIR, PageIR, Role } from '../../src/core/ir/types';
import { blockText, extractAndAnalyze } from '../../src/pdf/analyze';

interface Expected {
  roles: { page: number; text: string; role: Role }[];
  chains: [{ page: number; text: string }, { page: number; text: string }][];
  /** Paragraphs that must keep all their lines (one block each, not one block per line). */
  paragraphs?: { page: number; text: string; lines: number }[];
}

const find = (pages: PageIR[], page: number, text: string): BlockIR | undefined =>
  pages[page]?.blocks.find((b) => blockText(b) === text) ?? pages[page]?.blocks.find((b) => blockText(b).startsWith(text));

const fixtures = readdirSync('tests/corpus/expected').filter((f) => f.endsWith('.json'));

describe.each(fixtures)('PDF analysis: %s', (file) => {
  const name = file.replace(/\.json$/, '');
  const expected = JSON.parse(readFileSync(`tests/corpus/expected/${file}`, 'utf8')) as Expected;

  it('classifies roles, keeps formulas untranslatable and links the expected chains', async () => {
    const pages = await extractAndAnalyze(new Uint8Array(readFileSync(`tests/corpus/pdf/${name}.pdf`)), 50);

    const results = expected.roles.map((e) => ({ ...e, got: find(pages, e.page, e.text)?.role ?? 'missing' }));
    const core = results.filter((r) => ['body', 'heading', 'caption'].includes(r.role));
    const accuracy = core.filter((r) => r.got === r.role).length / Math.max(1, core.length);
    expect(accuracy, JSON.stringify(results.filter((r) => r.got !== r.role))).toBeGreaterThanOrEqual(0.9);
    // Other roles are checked strictly.
    expect(results.filter((r) => !['body', 'heading', 'caption'].includes(r.role) && r.got !== r.role)).toEqual([]);

    const all = pages.flatMap((p) => p.blocks);
    expect(all.filter((b) => b.role === 'formula' && b.translatable)).toEqual([]);

    const chainPairs = all
      .filter((b) => b.chain?.next)
      .map((b) => `${b.id}->${b.chain!.next}`)
      .sort();
    const expectedPairs = expected.chains
      .map(([a, b]) => `${find(pages, a.page, a.text)?.id}->${find(pages, b.page, b.text)?.id}`)
      .sort();
    expect(chainPairs).toEqual(expectedPairs);

    for (const p of expected.paragraphs ?? []) {
      expect(find(pages, p.page, p.text)?.lines.length, p.text).toBe(p.lines);
    }
  });
});
