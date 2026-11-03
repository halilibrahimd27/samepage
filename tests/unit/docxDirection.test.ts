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

  it('sets Latin letters in a Latin font, at a Latin size, when the size was the Arabic one', () => {
    const run = (props: string) =>
      `<w:pPr><w:bidi/></w:pPr><w:r><w:rPr>${props}<w:rtl/></w:rPr><w:t>الحمد لله رب العالمين</w:t></w:r>`;
    const both = translate(
      run(
        '<w:rFonts w:ascii="Sakkal Majalla" w:hAnsi="Sakkal Majalla" w:cs="Sakkal Majalla"/><w:sz w:val="28"/><w:szCs w:val="28"/>',
      ),
      (s) => s.replace('الحمد لله رب العالمين', "Hamd alemlerin Rabbi Allah'a"),
    );
    expect(both).toContain(
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Sakkal Majalla"/>',
    );
    expect(both).toContain('<w:sz w:val="24"/><w:szCs w:val="28"/>');
    // A Latin size of its own is kept, and so is a Latin font.
    const own = translate(
      run(
        '<w:rFonts w:ascii="Calibri" w:cs="Traditional Arabic"/><w:sz w:val="24"/><w:szCs w:val="32"/>',
      ),
      (s) => s.replace('الحمد لله رب العالمين', "Hamd alemlerin Rabbi Allah'a"),
    );
    expect(own).toContain('w:ascii="Calibri"');
    expect(own).toContain('<w:sz w:val="24"/><w:szCs w:val="32"/>');
  });

  it('takes the Arabic size of its style down to a Latin one', () => {
    const para = paragraph(
      '<w:pPr><w:pStyle w:val="NormalWeb"/><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t>الحمد لله</w:t></w:r><w:r><w:t> رب العالمين</w:t></w:r>',
    );
    const p = extractW(para, 'body');
    rebuild(p, decode('Hamd alemlerin Rabbi', p.encoded), {
      targetLang: 'tr',
      breakLongTokens: false,
      styleSize: (style) => (style === 'NormalWeb' ? { sz: '28', szCs: '28' } : {}),
    });
    const xml = serializeXml(para as unknown as Parameters<typeof serializeXml>[0]);
    expect(xml).toContain('<w:sz w:val="24"/>');
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
