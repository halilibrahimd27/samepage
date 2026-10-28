import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { translateLatex } from '../../src/latex/pipeline';

const OUT = 'tests/golden/__out__';
const SRC = readFileSync('tests/corpus/latex/paper.tex');
const opts = () => ({
  engine: createPseudoEngine({ factor: 1.35, substitute: true }),
  pair: { source: 'tr', target: 'en' },
  glossary: [],
  numberLocalization: false,
  fidelityCheck: false,
  signal: new AbortController().signal,
});

describe('LaTeX translation (P9.7)', () => {
  it('translates a .tex file: prose only, every command and formula kept', async () => {
    const { bytes, zip, report } = await translateLatex(new Uint8Array(SRC), opts());
    expect(zip).toBe(false);
    const out = new TextDecoder().decode(bytes);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/paper.en.tex`, out);

    // The pseudo engine's look-alike letters show the prose was translated.
    expect(out).toMatch(/\\section\{\[Ğırış\]\}\\label\{sec:giris\}/);
    expect(out).toMatch(/\\caption\{\[Ånlåm/);
    expect(out).toMatch(/\\footnote\{\[Örnеklеr/);
    for (const kept of [
      '\\documentclass[11pt]{article}',
      '\\usepackage[english]{babel}',
      '\\cite{vaswani2017,koehn2010}',
      '\\ref{tab:sonuc}',
      '$\\kappa = 0{,}81$',
      '\\begin{equation}\n  F_1 = \\frac{2PR}{P+R}\n  \\label{eq:f1}\n\\end{equation}',
      '\\begin{verbatim}\nkod: bu metin çevrilmez\n\\end{verbatim}',
      '\\bibliography{kaynaklar}',
      '\\toprule',
      '% Synthetic paper',
    ])
      expect(out).toContain(kept);
    // Translated text is escaped: "%12" stays "\%12".
    expect(out).toContain('\\%12');
    expect(out).not.toMatch(/[^\\]%12/);
    expect(report.summary.untranslated).toBe(0);
    expect(report.repairs.map((r) => r.code)).toEqual(['L1_LANGUAGE']);
  });

  it('translates a project .zip: every .tex file, the other files untouched', async () => {
    const input = new JSZip();
    input.file('main.tex', SRC);
    input.file('chapters/intro.tex', '\\section{Amaç}\nBu bölüm amacı açıklar.\n');
    input.file('figures/plot.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    input.file('kaynaklar.bib', '@book{koehn2010, title={Statistical Machine Translation}}');
    const bytes = await input.generateAsync({ type: 'uint8array' });
    const result = await translateLatex(bytes, opts());
    expect(result.zip).toBe(true);
    const out = await JSZip.loadAsync(result.bytes);
    expect(Object.keys(out.files).sort()).toEqual(
      ['chapters/', 'chapters/intro.tex', 'figures/', 'figures/plot.png', 'kaynaklar.bib', 'main.tex'].sort(),
    );
    expect(await out.file('chapters/intro.tex')!.async('string')).toMatch(/\\section\{\[Åmåç\]\}/);
    expect([...(await out.file('figures/plot.png')!.async('uint8array'))]).toEqual([
      137, 80, 78, 71, 1, 2, 3,
    ]);
    expect(await out.file('kaynaklar.bib')!.async('string')).toContain('Statistical Machine Translation');
    expect(result.report.segments.some((s) => s.part === 'chapters/intro.tex')).toBe(true);
  });
});
