import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { translateDocx } from '../../src/docx/pipeline';
import { NS, parseXml } from '../../src/docx/xml';
import { createPseudoEngine } from '../../src/engines/pseudo';
import type { TranslationEngine } from '../../src/engines/types';

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

const documentText = async (bytes: Uint8Array) => {
  const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => m[0]);
  const text = (p: string) => [...p.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  return { paragraphs, texts: paragraphs.map(text) };
};
const options = (engine: TranslationEngine) => ({
  engine,
  pair: { source: 'tr', target: 'en' },
  glossary: [],
  numberLocalization: false,
  fidelityCheck: false,
  translateComments: false,
  translateReferences: false,
  translateMetadata: false,
  signal: new AbortController().signal,
});

describe('a lab sheet with code', () => {
  it('keeps commands and listings as written, translates the words around them', async () => {
    const input = new Uint8Array(readFileSync(`${CORPUS}/lab.docx`));
    const { bytes } = await translateDocx(
      input,
      options(createPseudoEngine({ factor: 1, substitute: true })),
    );
    const { texts } = await documentText(bytes);
    for (const code of [
      'import hashlib',
      'mesaj = "Blokzincir".encode("utf-8")',
      'ozet = hashlib.sha256(mesaj).hexdigest()',
      'print(ozet)',
      '02.09., 14:03–14:12 UTC',
    ])
      expect(texts, code).toContain(code);
    const command = texts.find((t) => t.includes('python3 --version'))!;
    expect(command).not.toContain('Python sürümünü'); // the sentence around it is translated
    // A comment in words and a label in a typewriter font are language.
    expect(texts).not.toContain('# İki bayt dizisi arasındaki farklı bit sayısı');
    expect(texts).not.toContain('BİLMEN GEREKEN');
  });
});

describe('a paper with other languages in it', () => {
  it('translates each paragraph from its own language, keeps the target language as written', async () => {
    const input = new Uint8Array(readFileSync(`${CORPUS}/mixed.docx`));
    const pseudo = createPseudoEngine({ factor: 1, substitute: true });
    const sent: string[] = [];
    const engine: TranslationEngine = {
      ...pseudo,
      async translate(batch, ctx, signal) {
        for (const s of batch) sent.push(`${ctx.pair.source}: ${s.text}`);
        const out = await pseudo.translate(batch, ctx, signal);
        // Arabic comes back in Latin letters, as a translation into English would.
        return out.map((r) => ({ ...r, text: r.text.replace(/\p{Script=Arabic}+/gu, 'arabic') }));
      },
    };
    const { bytes, report } = await translateDocx(input, options(engine));
    expect(sent.some((s) => s.startsWith('ar: لم يكن الشعر'))).toBe(true);
    expect(sent.some((s) => s.startsWith('de: Die Dichtung'))).toBe(true);
    expect(sent.some((s) => s.includes('This study examines'))).toBe(false);

    const { paragraphs, texts } = await documentText(bytes);
    expect(texts).toContain(
      'This study examines the social function of poetry through sources that were written in different languages.',
    );
    // The Arabic paragraph, now in English, reads left to right.
    const arabic = paragraphs[texts.findIndex((t) => t.includes('arabic'))]!;
    expect(arabic).toContain('<w:bidi w:val="0"/>');
    expect(arabic).toContain('<w:rtl w:val="0"/>');

    // The appendix holding the reference list: its entries kept, its note and the next appendix
    // translated.
    const status = (start: string) => report.segments.find((s) => s.source.startsWith(start))!;
    expect(status('[F01]').status).toBe('skipped');
    expect(status('[F02]').status).toBe('skipped');
    expect(status('Erişim ve bibliyografik').status).toBe('translated');
    expect(status('Katılımcılara').status).toBe('translated');
    expect(texts).toContain('30.08., 19:00 UTC');
  });
});

describe('a document in Arabic', () => {
  it('reads left to right once translated, its sections and tables too', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    const para = (text: string) =>
      `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS.w}"><w:body>` +
        para('لم يكن الشعر العربي مجرد لون من ألوان الأدب، بل كان مؤسسة ثقافية.') +
        `<w:tbl><w:tblPr><w:bidiVisual/></w:tblPr><w:tr><w:tc>${para('الشعر')}</w:tc><w:tc>${para('المجتمع')}</w:tc></w:tr></w:tbl>` +
        '<w:sectPr><w:bidi/></w:sectPr></w:body></w:document>',
    );
    const input = await zip.generateAsync({ type: 'uint8array' });
    const pseudo = createPseudoEngine({ factor: 1, substitute: false });
    const engine: TranslationEngine = {
      ...pseudo,
      translate: (batch) =>
        Promise.resolve(batch.map((s) => ({ id: s.id, text: s.text.replace(/\p{Script=Arabic}+/gu, 'şiir') }))),
    };
    const { bytes } = await translateDocx(input, options(engine));
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    expect(xml).not.toMatch(/\p{Script=Arabic}/u);
    expect(xml).not.toMatch(/<w:(?:bidi|bidiVisual|rtl)\/>/);
    expect(xml).toContain('<w:bidiVisual w:val="0"/>');
    expect(xml).toMatch(/<w:sectPr><w:bidi w:val="0"\/><\/w:sectPr>/);
  });
});
