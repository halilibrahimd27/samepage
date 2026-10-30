import { describe, expect, it } from 'vitest';
import { verbatimOf } from '../../src/core/segment/codec';
import type { PlaceholderDef } from '../../src/core/segment/types';
import { confineTags, createBrowserPageEngine, unglue } from '../../src/engines/browserPage';
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

describe('headings with machine engines', () => {
  it('keeps the section number in front and reads small capitals whole', async () => {
    const { academicHeading } = await import('../../src/core/glossary/academic');
    expect(academicHeading('8 R<t1>ELATED</t1> W<t2>ORK</t2>', 'en', 'tr', false, true)).toBe(
      '8 İLGİLİ ÇALIŞMALAR',
    );
    const sent: string[] = [];
    const engine = createBrowserPageEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => {
        sent.push(...texts);
        return Promise.resolve(texts.map(() => 'GEÇERLİLİĞE YÖNELİK TEHDİTLER'));
      },
    });
    const [out] = await engine.translate(
      [{ id: 's1', text: '7 THREATS TO VALIDITY', role: 'heading' }],
      { pair: { source: 'en', target: 'tr' }, glossary: [], numberLocalization: false },
      signal,
    );
    expect(sent).toEqual(['THREATS TO VALIDITY']);
    expect(out!.text).toBe('7 GEÇERLİLİĞE YÖNELİK TEHDİTLER');
  });

  it('keeps a research question label in its run-in heading', async () => {
    const sent: string[] = [];
    const engine = createBrowserPageEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => {
        sent.push(...texts);
        return Promise.resolve([
          '<t1>Yaklaşımımız ne kadar doğru?</t1> Altı sınıflandırıcı geliştirdik.',
        ]);
      },
    });
    const [out] = await engine.translate(
      [
        {
          id: 's1',
          text: '<t1>RQ1: How accurate is our approach?</t1> We developed six classifiers.',
          role: 'body',
        },
      ],
      { pair: { source: 'en', target: 'tr' }, glossary: [], numberLocalization: false },
      signal,
    );
    expect(sent).toEqual(['<t1>How accurate is our approach?</t1> We developed six classifiers.']);
    expect(out!.text).toBe(
      '<t1>RQ1: Yaklaşımımız ne kadar doğru?</t1> Altı sınıflandırıcı geliştirdik.',
    );
  });

  it('keeps a bold span to its words when Google stretches it to the next one', () => {
    const source =
      'we select 397 packages, named<t2> typical packages</t2>. For the malicious ones, a collection of <t3>143 malicious packages</t3>, distinct from ours.';
    const target =
      '397 paket seçiyoruz ve bunlara <t2>tipik paketler diyoruz. Kötü amaçlı paketler için, farklı </t2><t3>143 kötü amaçlı paketten</t3> oluşan bir koleksiyon.';
    expect(confineTags(source, target)).toBe(
      '397 paket seçiyoruz ve bunlara <t2>tipik paketler</t2> diyoruz. Kötü amaçlı paketler için, farklı <t3>143 kötü amaçlı paketten</t3> oluşan bir koleksiyon.',
    );
    // A span that holds sentences in the source too is left alone.
    const quote = 'He wrote <t1>No. It failed.</t1> twice.';
    expect(confineTags(quote, 'Şöyle yazdı: <t1>Hayır. Başarısız oldu.</t1> iki kez.')).toBe(
      'Şöyle yazdı: <t1>Hayır. Başarısız oldu.</t1> iki kez.',
    );
  });

  it('puts the space back around citations Google glued to a word', () => {
    expect(
      unglue(
        'anomaly detection [32], dynamic analysis [20, 21], such as PyPI, struggle',
        'anomali tespiti[32]dinamik analiz [20, 21]ve PyPIGünlük gelen',
      ),
    ).toBe('anomali tespiti [32] dinamik analiz [20, 21] ve PyPI Günlük gelen');
    // Written so in the source: left as it is.
    expect(unglue('see Eq.[3] and XMLHttpRequest', 'bkz. Denk.[3] ve XMLHttpRequest')).toBe(
      'bkz. Denk.[3] ve XMLHttpRequest',
    );
  });
});
