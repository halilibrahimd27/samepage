import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { translateDocx } from '../../src/docx/pipeline';
import { NS, parseXml } from '../../src/docx/xml';
import { createPseudoEngine } from '../../src/engines/pseudo';

const CORPUS = 'tests/corpus/docx';
const OUT = 'tests/golden/__out__';

async function textParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort()) {
    if (!zip.files[name]!.dir) out.set(name, await zip.files[name]!.async('string'));
  }
  return out;
}

const count = (xml: string, ns: string, tag: string) =>
  parseXml(xml).getElementsByTagNameNS(ns, tag).length;

describe.each(readdirSync(CORPUS).filter((f) => f.endsWith('.docx')))('DOCX golden: %s', (name) => {
  it('translates with pseudo ×1.35, keeping structure, formatting and untouched parts', async () => {
    const input = new Uint8Array(readFileSync(`${CORPUS}/${name}`));
    const { bytes, report } = await translateDocx(input, {
      engine: createPseudoEngine({ factor: 1.35, substitute: true }),
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      translateComments: true,
      translateReferences: false,
      translateMetadata: true,
      cache: new MemoryCache(),
      signal: new AbortController().signal,
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/${name.replace(/\.docx$/, '.en.docx')}`, bytes);

    const before = await textParts(input);
    const after = await textParts(bytes);
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [part, xml] of after) {
      if (part.endsWith('.xml') || part.endsWith('.rels'))
        expect(() => parseXml(xml), part).not.toThrow();
    }
    // Structure survives: tables, equations, drawings, charts, footnote references.
    const doc0 = before.get('word/document.xml')!;
    const doc1 = after.get('word/document.xml')!;
    for (const [ns, tag] of [
      [NS.w, 'tbl'],
      [NS.w, 'tr'],
      [NS.m, 'oMath'],
      [NS.w, 'drawing'],
      [NS.w, 'footnoteReference'],
      [NS.w, 'del'],
      [NS.w, 'ins'],
      [NS.w, 'hyperlink'],
      [NS.w, 'commentReference'],
    ] as const) {
      expect(count(doc1, ns, tag), tag).toBe(count(doc0, ns, tag));
    }
    // Run formatting survives: bold and italic runs still exist in the output.
    expect(count(doc1, NS.w, 'b')).toBeGreaterThanOrEqual(1);
    expect(count(doc1, NS.w, 'i')).toBeGreaterThanOrEqual(1);
    // Parts without text are byte-identical.
    for (const part of [
      'word/settings.xml',
      'word/_rels/document.xml.rels',
      '[Content_Types].xml',
    ]) {
      if (before.has(part)) expect(after.get(part), part).toBe(before.get(part));
    }

    expect(report.summary.untranslated).toBe(0);
    expect(report.summary.skipped).toBeGreaterThanOrEqual(1); // reference list
    await expect(
      JSON.stringify(
        {
          summary: report.summary,
          repairs: report.repairs,
          segments: report.segments.map((s) => ({
            part: s.part,
            role: s.role,
            status: s.status,
            source: s.source,
            target: s.target,
          })),
        },
        null,
        2,
      ),
    ).toMatchFileSnapshot(`docx/${name.replace(/\.docx$/, '.json')}`);
  });
});

describe('reference titles in brackets (P9.6)', () => {
  it('keeps a reference as published and adds its title’s translation in brackets', async () => {
    const input = new Uint8Array(readFileSync(`${CORPUS}/academic.docx`));
    const engine = createPseudoEngine({ factor: 1, substitute: true });
    const { bytes, report } = await translateDocx(input, {
      engine,
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      translateComments: false,
      translateReferences: false,
      referenceTitles: true,
      translateMetadata: false,
      signal: new AbortController().signal,
    });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    const text = [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
    // The entry keeps its authors, year, journal and title; the title's translation follows it.
    expect(text).toMatch(
      /Yılmaz, A\. ve Demir, B\. \(2021\)\. Türkçe metinlerde terim tutarlılığı \[.+\]\. Dil Dergisi, 12\(3\), 45–67\./,
    );
    const entry = report.segments.find((s) => s.source.startsWith('Yılmaz'))!;
    expect(entry.role).toBe('reference');
    expect(entry.status).toBe('translated');
  });
});
