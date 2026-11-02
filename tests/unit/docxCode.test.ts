import { describe, expect, it } from 'vitest';
import { commentInWords, monoProse } from '../../src/core/segment/code';
import { plainText } from '../../src/core/segment/codec';
import { extractA, extractW } from '../../src/docx/paragraphs';
import { NS, parseXml } from '../../src/docx/xml';

const W = NS.w;
const run = (text: string, mono = false) =>
  `<w:r>${mono ? '<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (runs: string) =>
  parseXml(
    `<w:document xmlns:w="${W}"><w:body><w:p>${runs}</w:p></w:body></w:document>`,
  ).getElementsByTagNameNS(W, 'p')[0]!;

describe('code in a Word document', () => {
  it('keeps code runs inside a sentence as themselves, with their style', () => {
    const p = extractW(
      paragraph(
        run('Python sürümünü kontrol edin: ') +
          run('python3 --version', true) +
          run(' (3.10 veya üstü).'),
      ),
      'body',
      { code: true },
    );
    const code = p.encoded.placeholders.filter((x) => x.kind === 'C');
    expect(code.map((x) => x.text)).toEqual(['python3 --version']);
    expect(plainText(p.encoded.source)).not.toContain('python3');
  });

  it('leaves a line of code untranslated, translates a comment in words', () => {
    const code = extractW(paragraph(run('mesaj = "Blokzincir".encode("utf-8")', true)), 'body', {
      code: true,
    });
    expect(/\p{L}/u.test(plainText(code.encoded.source))).toBe(false);
    const comment = extractW(
      paragraph(run('# İki bayt dizisi arasındaki farklı bit sayısı', true)),
      'body',
      { code: true },
    );
    expect(plainText(comment.encoded.source)).toContain('İki bayt dizisi');
    // A comment holding a value stays with its code.
    expect(commentInWords('# Beklenen: 7a4b58bb56a4e8404e37f8e7a97c0882f424ea483d')).toBe(false);
  });

  it('translates a label set in a typewriter font', () => {
    expect(monoProse('BİLMEN GEREKEN')).toBe(true);
    const p = extractW(paragraph(run('BİLMEN GEREKEN', true)), 'body', { code: true });
    expect(plainText(p.encoded.source)).toBe('BİLMEN GEREKEN');
  });

  it('reads a typewriter face as plain text when the document is set in it', () => {
    const p = extractW(paragraph(run('python3 --version', true)), 'body', { code: false });
    expect(p.encoded.placeholders.some((x) => x.kind === 'C')).toBe(false);
    expect(plainText(p.encoded.source)).toContain('--version');
  });

  it('does the same on a slide', () => {
    const A = NS.a;
    const run = (text: string, mono = false) =>
      `<a:r><a:rPr lang="tr-TR">${mono ? '<a:latin typeface="JetBrains Mono"/>' : ''}</a:rPr><a:t>${text}</a:t></a:r>`;
    const slide = (runs: string) =>
      parseXml(`<a:txBody xmlns:a="${A}"><a:p>${runs}</a:p></a:txBody>`).getElementsByTagNameNS(
        A,
        'p',
      )[0]!;
    const inline = extractA(slide(run('Kurulum: ') + run('pip install numpy', true)), 'body', {
      code: true,
    });
    expect(inline.encoded.placeholders.map((x) => x.kind)).toEqual(['C']);
    const label = extractA(slide(run('BİLMEN GEREKEN', true)), 'body', { code: true });
    expect(plainText(label.encoded.source)).toBe('BİLMEN GEREKEN');
    const code = extractA(slide(run('import hashlib', true)), 'body', { code: true });
    expect(/\p{L}/u.test(plainText(code.encoded.source))).toBe(false);
  });
});
