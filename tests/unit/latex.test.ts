import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decode, encode, plainText } from '../../src/core/segment/codec';
import { latexStyleKey, latexUnits } from '../../src/latex/parse';
import { renderLatex } from '../../src/latex/render';

const SRC = readFileSync('tests/corpus/latex/paper.tex', 'utf8');

/** Each unit rendered back from its own source: the file must come out unchanged in meaning. */
function roundTrip(src: string, translate: (tagged: string) => string = (t) => t): string {
  const units = latexUnits(src);
  const footnotes = new Map<string, string>();
  const rendered = new Map<string, string>();
  // Footnotes first: their parents need their text.
  for (const u of [...units].sort((a, b) => Number(!!b.nested) - Number(!!a.nested))) {
    const enc = encode(u.runs, latexStyleKey);
    const text = renderLatex(decode(translate(enc.source), enc), footnotes);
    if (u.nested) footnotes.set(u.id, text);
    else rendered.set(u.id, text);
  }
  let out = '';
  let at = 0;
  for (const u of units.filter((x) => !x.nested)) {
    out += src.slice(at, u.start) + rendered.get(u.id);
    at = u.end;
  }
  return out + src.slice(at);
}

describe('LaTeX units (P9.7)', () => {
  const units = latexUnits(SRC);
  const texts = units.map((u) => plainText(encode(u.runs, latexStyleKey).source));

  it('finds the prose and nothing else', () => {
    expect(texts).toContain('Akademik Metinlerde Anlam Kaymasının Ölçülmesi');
    expect(texts).toContain('Giriş');
    expect(texts).toContain('Anlam kayması türlerinin dağılımı.');
    expect(texts).toContain('Olumsuzluk kaybı en sık görülen hatadır.');
    expect(texts).toContain('Olumsuzluk kaybı');
    expect(texts).toContain('Örnekler derlemden alınmıştır.');
    // Code, the author, numbers-only cells and the bibliography commands are not text to translate.
    expect(texts.join('\n')).not.toMatch(/kod: bu metin|Ayşe Yılmaz|41,2|apalike/);
  });

  it('keeps commands, mathematics and citations as placeholders', () => {
    const intro = units.find((u) => u.role === 'body' && /Sinir ağı/.test(JSON.stringify(u.runs)))!;
    const enc = encode(intro.runs, latexStyleKey);
    expect(enc.source).toMatch(/çeviriler üretmektedir\u00A0⟦C1⟧\./);
    expect(enc.source).toMatch(/<t1>akıcılık<\/t1>/);
    expect(enc.source).toMatch(/kaybolması anlamı/);
    expect(enc.source).toContain('%12');
    expect(enc.placeholders.map((p) => p.kind)).toEqual(['C', 'N', 'C']);
    // A display formula inside the sentence travels with it.
    const metric = units.find((u) => /harmonik/.test(JSON.stringify(u.runs)))!;
    const m = encode(metric.runs, latexStyleKey);
    expect(m.source).toMatch(/olan ⟦I1⟧ ölçütüyle hesaplanmıştır\./);
  });

  it('writes the same document back when nothing is translated', () => {
    const out = roundTrip(SRC);
    // Line breaks inside paragraphs become spaces and TeX quotes Unicode; everything else stays.
    const norm = (s: string) => s.replace(/\s+/g, ' ');
    expect(norm(out)).toBe(norm(SRC));
  });

  it('escapes translated text and keeps every command', () => {
    const out = roundTrip(SRC, (t) =>
      t
        .replace('Giriş', 'Introduction')
        .replace('Kayıp oranı %12 düzeyindedir.', 'The loss rate is 12% & rising.')
        .replace('Örnekler derlemden alınmıştır.', 'Examples are from the corpus.'),
    );
    expect(out).toContain('\\section{Introduction}\\label{sec:giris}');
    expect(out).toContain('The loss rate is 12\\% \\& rising.');
    expect(out).toContain('\\footnote{Examples are from the corpus.}');
    for (const kept of [
      '\\cite{vaswani2017,koehn2010}',
      '\\begin{equation}',
      '\\label{eq:f1}',
      '$\\kappa = 0{,}81$',
      '\\begin{verbatim}\nkod: bu metin çevrilmez\n\\end{verbatim}',
      '\\usepackage[turkish]{babel}',
    ])
      expect(out).toContain(kept);
  });
});
