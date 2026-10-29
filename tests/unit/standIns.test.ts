import { describe, expect, it } from 'vitest';
import { verbatimOf } from '../../src/core/segment/codec';
import type { PlaceholderDef } from '../../src/core/segment/types';
import { createBrowserPageEngine } from '../../src/engines/browserPage';
import { createPseudoEngine } from '../../src/engines/pseudo';
import type { SegmentRequest, TranslationEngine } from '../../src/engines/types';
import { translateLatex } from '../../src/latex/pipeline';

const F = (id: string, text: string) => ({ id, kind: 'F', text }) as PlaceholderDef;
const pair = { source: 'tr', target: 'en' };
const signal = new AbortController().signal;

describe('placeholders that travel as text, so the sentence stays whole', () => {
  it('sends inline formulas as themselves or as one distinct symbol each', () => {
    const { verbatim } = verbatimOf(
      [F('F1', '$P$'), F('F2', String.raw`$\kappa = 0{,}81$`), F('F3', 'p <')],
      pair,
    );
    expect(verbatim!.F1).toBe('P');
    expect(verbatim!.F2).not.toBe(verbatim!.F3);
    expect([...verbatim!.F2!]).toHaveLength(1);
  });

  it('gives Google a whole sentence and puts the formula back', async () => {
    const sent: string[] = [];
    const engine = createBrowserPageEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => {
        sent.push(...texts);
        return Promise.resolve(texts.map((t) => t.replace('olarak hesaplanmıştır', 'calculated')));
      },
    });
    const text = 'Uyum katsayısı ⟦F1⟧ olarak hesaplanmıştır.';
    const [out] = await engine.translate(
      [{ id: 's1', text, role: 'body', ...verbatimOf([F('F1', String.raw`$\kappa = 0{,}81$`)]) }],
      { pair, glossary: [], numberLocalization: false },
      signal,
    );
    expect(sent[0]).not.toContain('⟦F1⟧');
    expect(out!.text).toBe('Uyum katsayısı ⟦F1⟧ calculated.');
  });

  it('reads LaTeX references and citations as a reader sees them', async () => {
    const seen: SegmentRequest[] = [];
    const pseudo = createPseudoEngine({ factor: 1, substitute: false });
    const engine: TranslationEngine = {
      ...pseudo,
      translate: (batch, ctx, s) => {
        seen.push(...batch);
        return pseudo.translate(batch, ctx, s);
      },
    };
    const tex = String.raw`\documentclass{article}
\begin{document}
Ayrıntılar Tablo~\ref{tab:a}'de ve 17 örnekte verilmiştir \cite{x,y}. Ayrıca \eqref{eq:b} geçerlidir.
\end{document}
`;
    await translateLatex(new TextEncoder().encode(tex), {
      engine,
      pair,
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      signal,
    });
    const verbatim = Object.values(seen[0]!.verbatim ?? {});
    // Numbers the paragraph does not use ("7" is in "17"), and a bracketed citation.
    expect(verbatim).toEqual(['8', '[1]', '9']);
  });
});
