import { describe, expect, it } from 'vitest';
import { decode } from '../../src/core/segment/codec';
import { extractA, extractW, rebuild } from '../../src/docx/paragraphs';
import { NS, parseXml, serializeXml } from '../../src/docx/xml';

const W = NS.w;
const paragraph = (inner: string) =>
  parseXml(
    `<w:document xmlns:w="${W}"><w:body><w:p>${inner}</w:p></w:body></w:document>`,
  ).getElementsByTagNameNS(W, 'p')[0]!;

const translate = (inner: string, text: (source: string) => string) => {
  const para = paragraph(inner);
  const p = extractW(para, 'body');
  rebuild(p, decode(text(p.encoded.source), p.encoded), {
    targetLang: 'tr',
    breakLongTokens: false,
  });
  return serializeXml(para as unknown as Parameters<typeof serializeXml>[0]);
};

const ARABIC =
  '<w:pPr><w:bidi/><w:jc w:val="both"/></w:pPr>' +
  '<w:r><w:rPr><w:bCs/><w:szCs w:val="32"/><w:rtl/></w:rPr><w:t>الشعر العربي</w:t></w:r>';

describe('right-to-left text in a Word document', () => {
  it('reads left to right once translated into a left-to-right language', () => {
    const xml = translate(ARABIC, (s) => s.replace('الشعر العربي', 'Arap şiiri'));
    expect(xml).toContain('<w:bidi w:val="0"/><w:jc w:val="both"/>');
    // Bold as it was shown in, in schema order; the size stays the one for Latin letters.
    expect(xml).toMatch(/<w:b\/><w:bCs\/><w:szCs w:val="32"\/><w:rtl w:val="0"\/>/);
    expect(xml).toContain('Arap şiiri');
  });

  it('reads left to right on a slide too', () => {
    const A = NS.a;
    const para = parseXml(
      `<a:txBody xmlns:a="${A}"><a:p><a:pPr rtl="1" algn="r"/><a:r><a:rPr lang="ar-SA"/><a:t>الشعر العربي</a:t></a:r></a:p></a:txBody>`,
    ).getElementsByTagNameNS(A, 'p')[0]!;
    const p = extractA(para, 'body');
    rebuild(p, decode(p.encoded.source.replace('الشعر العربي', 'Arap şiiri'), p.encoded), {
      targetLang: 'tr',
      breakLongTokens: false,
    });
    const xml = serializeXml(para as unknown as Parameters<typeof serializeXml>[0]);
    expect(xml).toContain('rtl="0"');
    expect(xml).toContain('Arap şiiri');
  });

  it('stays right to left when it was kept as written', () => {
    const xml = translate(ARABIC, (s) => s);
    expect(xml).toContain('<w:bidi/>');
    expect(xml).toContain('<w:rtl/>');
  });
});
