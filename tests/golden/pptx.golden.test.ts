import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { docxParagraphs, docxTermTexts, translateDocx } from '../../src/docx/pipeline';
import { NS, parseXml } from '../../src/docx/xml';
import { createPseudoEngine } from '../../src/engines/pseudo';

const talk = () => new Uint8Array(readFileSync('tests/corpus/pptx/talk.pptx'));

async function parts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const out = new Map<string, string>();
  for (const name of Object.keys(zip.files).sort())
    if (!zip.files[name]!.dir) out.set(name, await zip.files[name]!.async('string'));
  return out;
}

const texts = (xml: string) =>
  Array.from(parseXml(xml).getElementsByTagNameNS(NS.a, 't')).map((t) => t.textContent ?? '');

describe('PPTX (P8.7)', () => {
  it('reads slides for language detection and term suggestions', async () => {
    const paras = await docxParagraphs(talk());
    expect(paras[0]).toEqual({ text: 'Türkçe Akademik Metinlerde Anlam Kayması', role: 'body' });
    expect(paras.map((p) => p.text)).toContain('Sonuçlar');
    expect((await docxTermTexts(talk())).length).toBe(paras.length);
  });

  it('translates slides, notes and charts and fits text that grew', async () => {
    const { bytes, report } = await translateDocx(talk(), {
      engine: createPseudoEngine({ factor: 1.6, substitute: true }),
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      translateComments: false,
      translateReferences: false,
      translateMetadata: true,
      cache: new MemoryCache(),
      signal: new AbortController().signal,
    });
    expect(report.summary.untranslated).toBe(0);
    const partsOf = new Set(report.segments.map((s) => s.part));
    expect(partsOf).toEqual(
      new Set([
        'docProps/core.xml',
        ...[1, 2, 3, 4, 5].map((n) => `ppt/slides/slide${n}.xml`),
        ...[1, 2].map((n) => `ppt/notesSlides/notesSlide${n}.xml`),
        'ppt/charts/chart1.xml',
      ]),
    );
    // Slides are taken in their order (slide10 after slide9, not after slide1).
    const slides = [...new Set(report.segments.map((x) => x.part))].filter((x) =>
      x.startsWith('ppt/slides/'),
    );
    expect(slides).toEqual([1, 2, 3, 4, 5].map((n) => `ppt/slides/slide${n}.xml`));

    const before = await parts(talk());
    const after = await parts(bytes);
    // Same parts, same paragraph structure; every slide text changed; the slide number field
    // of the notes stays a field.
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const n of [1, 2, 3, 4, 5]) {
      const path = `ppt/slides/slide${n}.xml`;
      const count = (xml: string) => parseXml(xml).getElementsByTagNameNS(NS.a, 'p').length;
      expect(count(after.get(path)!)).toBe(count(before.get(path)!));
      expect(texts(after.get(path)!)).not.toEqual(texts(before.get(path)!));
    }
    expect(after.get('ppt/notesSlides/notesSlide1.xml')).toContain('type="slidenum"');
    expect(texts(after.get('ppt/notesSlides/notesSlide1.xml')!).join(' ')).not.toContain(
      'Konuşmaya teşekkür',
    );
    expect(texts(after.get('ppt/charts/chart1.xml')!).join(' ')).not.toContain('Tümce uzunluğuna');
    // Numbers, formulas and formatting survive.
    const slide2 = after.get('ppt/slides/slide2.xml')!;
    expect(texts(slide2).join(' ')).toContain('412');
    expect(slide2).toContain('b="1"');
    expect(slide2).toContain('i="1"');
    // The tight box of slide 5 is fitted, and the fit is reported.
    expect(after.get('ppt/slides/slide5.xml')).toMatch(/<a:normAutofit fontScale="\d+"/);
    expect(report.repairs.some((r) => r.code === 'P1_SLIDE_FIT' && r.part === 'ppt/slides/slide5.xml')).toBe(
      true,
    );
    // Translated runs are marked as the target language.
    expect(slide2).toContain('lang="en-US"');
  });
});
