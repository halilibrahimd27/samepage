import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import type { PageIR } from '../../src/core/ir/types';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { blockText, extractAndAnalyze, pdfParagraphs } from '../../src/pdf/analyze';
import { loadFaces } from '../../src/pdf/engine';
import { translatePdf } from '../../src/pdf/pipeline';
import papers from './papers.json';

/**
 * Structure benchmark on real open-access papers (`npm run bench:fetch`, then `npm run bench`):
 * what the analysis finds in each paper and what reaches its editable Word file, translated with
 * the identity engine so that every word can be looked up. The numbers go to
 * tests/private/bench/RESULTS.md; they are measurements to compare between versions, not
 * assertions.
 */
const DIR = 'tests/private/bench';
const TABLE_CAPTION =
  /^\s*(?:Table|Tab\.|Tablo|Tabelle|Tableau|Tabla|Tabela|Tabella|Tabel|Tabulka|Таблица)\s*([A-Z]?\d+(?:\.\d+)?|[IVX]+)/iu;
const SOURCE_ROLES = new Set(['body', 'heading', 'caption', 'table-cell', 'footnote']);
const wordsOf = (s: string) =>
  (s.toLowerCase().match(/\p{L}{3,}/gu) ?? []).map((w) => w.normalize('NFC'));
const count = (words: string[]) => {
  const out = new Map<string, number>();
  for (const w of words) out.set(w, (out.get(w) ?? 0) + 1);
  return out;
};
const xmlText = (xml: string) =>
  [...xml.replace(/<w:noBreakHyphen\/>/g, '<w:t>-</w:t>').matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) =>
      [...p[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
        .map((t) => t[1]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
        .join(''),
    )
    .join(' ');

interface Row {
  paper: string;
  pages: number;
  tableCaptions: number;
  tables: number;
  wordTables: number;
  footnoteBlocks: number;
  wordFootnotes: number;
  referenceBlocks: number;
  bibliography: number;
  figures: number;
  pictures: number;
  tinyPictures: number;
  lostWords: string;
  score: number;
  warnings: number;
}

function source(pages: PageIR[]) {
  const captions = new Set<string>();
  const tables = new Map<string, Set<number>>();
  for (const page of pages)
    for (const b of page.blocks) {
      const m = b.role === 'caption' ? TABLE_CAPTION.exec(blockText(b)) : null;
      if (m) captions.add(m[1]!);
      if (b.tableCell) {
        const key = `${page.index}:${b.tableCell.tableId}`;
        tables.set(key, (tables.get(key) ?? new Set()).add(b.tableCell.col));
      }
    }
  const blocks = (role: string) =>
    pages.reduce((n, p) => n + p.blocks.filter((b) => b.role === role).length, 0);
  return {
    tableCaptions: captions.size,
    tables: [...tables.values()].filter((cols) => cols.size >= 2).length,
    footnoteBlocks: blocks('footnote'),
    referenceBlocks: blocks('reference'),
    figures: pages.reduce((n, p) => n + (p.figures ?? []).filter((f) => !f.formula).length, 0),
    words: count(
      pdfParagraphs(pages)
        .filter((p) => SOURCE_ROLES.has(p.role))
        .flatMap((p) => wordsOf(p.text)),
    ),
  };
}

const present = papers.filter((p) => existsSync(`${DIR}/${p.slug}.pdf`));
const rows: Row[] = [];

describe.skipIf(!present.length)('structure of real papers', () => {
  afterAll(() => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]!) as (keyof Row)[];
    const table = [
      `| ${keys.join(' | ')} |`,
      `|${keys.map(() => '-').join('|')}|`,
      ...rows
        .sort((a, b) => a.paper.localeCompare(b.paper))
        .map((r) => `| ${keys.map((k) => r[k]).join(' | ')} |`),
    ].join('\n');
    writeFileSync(`${DIR}/RESULTS.md`, `# Structure benchmark\n\n${table}\n`);
  });

  it.each(present)(
    '$slug',
    async ({ slug, source: lang }) => {
      const bytes = new Uint8Array(readFileSync(`${DIR}/${slug}.pdf`));
      const found = source(await extractAndAnalyze(bytes, 40));
      const faces = await loadFaces((f) =>
        Promise.resolve(new Uint8Array(readFileSync(`public/fonts/${f}`))),
      );
      const { editable, report } = await translatePdf(bytes, {
        engine: createPseudoEngine({ factor: 1, substitute: false }),
        pair: { source: lang, target: lang === 'en' ? 'tr' : 'en' },
        glossary: [],
        numberLocalization: false,
        fidelityCheck: false,
        faces,
        maxPages: 40,
        dual: false,
        editable: true,
        signal: new AbortController().signal,
      }).finally(() => faces.destroy());
      expect(editable).not.toBeNull();
      const zip = await JSZip.loadAsync(editable!);
      const xml = await zip.file('word/document.xml')!.async('string');
      const notes = (await zip.file('word/footnotes.xml')?.async('string')) ?? '';
      const words = count(wordsOf(`${xmlText(xml)} ${xmlText(notes)}`));
      let total = 0;
      let lost = 0;
      for (const [w, n] of found.words) {
        total += n;
        lost += Math.max(0, n - (words.get(w) ?? 0));
      }
      const extents = [...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map(
        (m) => [Number(m[1]) / 12700, Number(m[2]) / 12700] as const,
      );
      rows.push({
        paper: slug,
        pages: report.summary.pages,
        tableCaptions: found.tableCaptions,
        tables: found.tables,
        wordTables: (xml.match(/<w:tbl>/g) ?? []).length,
        footnoteBlocks: found.footnoteBlocks,
        wordFootnotes: (notes.match(/<w:footnote w:id="[1-9]\d*"/g) ?? []).length,
        referenceBlocks: found.referenceBlocks,
        bibliography: (xml.match(/<w:pStyle w:val="Bibliography"\/>/g) ?? []).length,
        figures: found.figures,
        pictures: extents.length,
        tinyPictures: extents.filter(([w, h]) => w < 20 && h < 20).length,
        lostWords: total ? `${((100 * lost) / total).toFixed(2)} %` : '-',
        score: report.summary.score,
        warnings: report.summary.warnings,
      });
    },
    600_000,
  );
});
