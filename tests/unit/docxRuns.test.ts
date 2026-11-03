import { describe, expect, it } from 'vitest';
import { extractW } from '../../src/docx/paragraphs';
import { NS, parseXml } from '../../src/docx/xml';

const W = NS.w;
const fonts = (ascii: string, cs = ascii) =>
  `<w:rFonts w:ascii="${ascii}" w:hAnsi="${ascii}" w:cs="${cs}"/>`;
const run = (text: string, props = '') =>
  `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (runs: string) =>
  parseXml(
    `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
  ).getElementsByTagNameNS(W, 'p')[0]!;
const source = (runs: string) => extractW(paragraph(runs), 'body').encoded.source;

describe('runs that look alike', () => {
  it('keeps a word whole when Word set one of its letters in another font', () => {
    const bask = fonts('Baskerville Old Face');
    expect(
      source(
        run('B.1. MUNKAID', `${bask}<w:b/>`) +
          run('Ő', `${fonts('Times New Roman')}<w:b/>`) +
          run(' ÖSSZEHASONLÍTÁS (EU, 2023)', `${bask}<w:b/>`),
      ),
    ).toBe('B.1. MUNKAIDŐ ÖSSZEHASONLÍTÁS (EU, 2023)');
  });

  it('takes no account of the complex-script font in Latin text', () => {
    expect(
      source(
        run('A képerny', fonts('Baskerville Old Face', 'Times New Roman')) +
          run('ő', fonts('Times New Roman')) +
          run('alapú figyelem csökkent', fonts('Baskerville Old Face')),
      ),
    ).toBe('A képernyőalapú figyelem csökkent');
  });

  it('keeps formatting that shows, and letters in a symbol font', () => {
    expect(source(run('Lehrer') + run('innen', '<w:i/>') + run(' und Schüler'))).toBe(
      'Lehrer<t1>innen</t1> und Schüler',
    );
    expect(source(run('Wert ') + run('a', fonts('Symbol')) + run('lpha bleibt'))).toContain(
      '<t1>a</t1>',
    );
    // A word split over two fonts takes the font of its longer part; the text after it keeps its own.
    expect(
      source(
        run('abc', fonts('Arial')) +
          run('d', fonts('Times New Roman')) +
          run(' ef', fonts('Arial')),
      ),
    ).toBe('abcd ef');
    expect(source(run('Text ', fonts('Arial')) + run('in Times', fonts('Times New Roman')))).toBe(
      '<t1>Text </t1>in Times',
    );
  });

  it('keeps the complex-script font of Arabic text', () => {
    expect(
      source(
        run('النص العربي', fonts('Arial', 'Traditional Arabic')) + run(' الثاني', fonts('Arial')),
      ),
    ).toContain('<t1>');
  });
});
