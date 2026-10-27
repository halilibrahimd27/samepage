import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { glossaryToCsv, mergeGlossaries, parseGlossaryCsv } from '../../src/core/glossary/glossary';
import { translateSegments } from '../../src/core/pipeline/translate';
import { createDehyphenator } from '../../src/core/segment/dehyphenate';
import { createBrowserPageEngine, respacePlaceholders } from '../../src/engines/browserPage';
import { createChromeEngine } from '../../src/engines/chromeBuiltin';
import { parseJsonLoose } from '../../src/engines/openaiCompatible';
import {
  matchInitialCase,
  placeTags,
  splitClauses,
  splitSentences,
} from '../../src/engines/plainText';
import { academicHeading, isNameList, usesMetrics } from '../../src/core/glossary/academic';
import { validateTranslation } from '../../src/core/validate/validate';
import { createPseudoEngine } from '../../src/engines/pseudo';
import { EngineError, type SegmentRequest, type TranslationEngine } from '../../src/engines/types';
import { redactSecrets } from '../../src/security/redact';

const ctx = { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false };
const seg = (id: string, text: string): SegmentRequest => ({ id, text, role: 'body' });

/** Engine scripted per call: each call returns answers for the ids it received. */
function scripted(
  answers: ((id: string, call: number) => string | undefined)[],
): TranslationEngine & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    ...createPseudoEngine(),
    id: 'anthropic',
    model: 'test',
    maxBatchChars: 10_000,
    checkFidelity: (pairs) =>
      Promise.resolve({
        findings: pairs
          .filter((p) => p.id === 'b')
          .map((p) => ({ id: p.id, issue: 'hedging lost', severity: 'major' as const })),
      }),
    calls,
    translate(batch) {
      const n = calls.length;
      calls.push(batch.map((b) => b.id));
      const answer = answers[Math.min(n, answers.length - 1)]!;
      return Promise.resolve(
        batch.flatMap((b) => {
          const text = answer(b.id, n);
          return text === undefined ? [] : [{ id: b.id, text }];
        }),
      );
    },
  };
}

describe('translateSegments', () => {
  const segments = [
    seg('a', 'Bu yöntem 3,5 kat daha hızlıdır [2].'),
    seg('b', 'Sonuçlar genellenebilir olabilir.'),
  ];

  it('retries the failing segment with feedback, then individually, then keeps the source', async () => {
    const engine = scripted([
      (id) =>
        id === 'a' ? 'This method is 3.5 times faster [2].' : 'The results are general [9].',
      () => 'Still wrong [9].',
    ]);
    const out = await translateSegments({
      engine,
      segments,
      ctx,
      signal: new AbortController().signal,
    });
    expect(engine.calls).toEqual([['a', 'b'], ['b'], ['b']]);
    expect(out[0]).toMatchObject({
      text: 'This method is 3.5 times faster [2].',
      untranslated: false,
      attempts: 1,
    });
    expect(out[1]).toMatchObject({ text: segments[1]!.text, untranslated: true, attempts: 3 });
    expect(out[1]!.issues.map((i) => i.code)).toContain('CITATION_MISMATCH');
  });

  it('Google engine: identifiers travel inline, changed ones fall back to spans', async () => {
    const sent: string[][] = [];
    const engine = createBrowserPageEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => {
        sent.push(texts);
        return Promise.resolve(
          texts.map((t) =>
            t
              .replace('We use the', 'Kullanıyoruz:')
              .replace('function', 'fonksiyonunu')
              .replace('bandit tool', 'haydut aracı')
              .replace('bandit', 'haydut'),
          ),
        );
      },
    });
    const out = await engine.translate(
      [
        {
          id: 'a',
          text: 'We use the ⟦U1⟧ function',
          role: 'body',
          verbatim: { U1: 'permutation_importance' },
        },
        { id: 'b', text: 'the ⟦U1⟧ tool', role: 'body', verbatim: { U1: 'bandit' } },
      ],
      { pair: { source: 'en', target: 'tr' }, glossary: [], numberLocalization: false },
      new AbortController().signal,
    );
    expect(sent[0]).toEqual(['We use the permutation_importance function', 'the bandit tool']);
    expect(sent[1]).toEqual(['the ⟦U1⟧ tool']);
    expect(out.map((r) => r.text)).toEqual(['Kullanıyoruz: ⟦U1⟧ fonksiyonunu', 'the ⟦U1⟧ tool']);
  });

  it('Google engine: a Turkish percent sign is not glued to the word before it', async () => {
    const engine = createBrowserPageEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => Promise.resolve(texts.map(() => "F1 skoru%94,2'lik bir oran")),
    });
    const [r] = await engine.translate(
      [{ id: 'a', text: 'an F1 score of 94.2%', role: 'body' }],
      { pair: { source: 'en', target: 'tr' }, glossary: [], numberLocalization: false },
      new AbortController().signal,
    );
    expect(r!.text).toBe("F1 skoru %94,2'lik bir oran");
  });

  it('keeps metric terms consistent between tables and sentences', async () => {
    const seen: string[] = [];
    const engine: TranslationEngine = {
      ...createPseudoEngine(),
      id: 'browser',
      capabilities: { ...createPseudoEngine().capabilities, glossary: false },
      translate(batch) {
        seen.push(...batch.map((b) => b.text));
        return Promise.resolve(
          batch.map((b) => ({
            id: b.id,
            text: b.text
              .replace('Performance under', 'Performans:')
              .replace(/ and /g, ' ve ')
              .replace('high', 'yüksek'),
          })),
        );
      },
    };
    const out = await translateSegments({
      engine,
      segments: [
        seg('c', 'Performance under ⟦U1⟧ (P), recall (R) and F1 score'),
        seg('h', 'F1-score (%)'),
        seg('p', 'Precision'),
      ].map((s) =>
        s.id === 'c'
          ? { ...s, text: 'Performance under precision (P), recall (R) and F1 score', verbatim: {} }
          : s,
      ),
      ctx: { ...ctx, pair: { source: 'en', target: 'tr' } },
      signal: new AbortController().signal,
    });
    expect(seen).toEqual(['Performance under ⟦G1⟧ (P), ⟦G2⟧ (R) and ⟦G3⟧']);
    expect(out.map((o) => o.text)).toEqual([
      'Performans: kesinlik (P), duyarlılık (R) ve F1 skoru',
      'F1 skoru (%)',
      'Kesinlik',
    ]);
  });

  it('puts back the spaces Google drops around placeholders', () => {
    expect(
      respacePlaceholders(
        'methods such as malware-check [35], ⟦U1⟧ [40], and <t1>Packj</t1> ⟦U2⟧ tools',
        'malware-check [35] gibi yöntemler,⟦U1⟧[40] ve <t1>Packj</t1>⟦U2⟧araçları',
      ),
    ).toBe('malware-check [35] gibi yöntemler, ⟦U1⟧ [40] ve <t1>Packj</t1> ⟦U2⟧ araçları');
    // Suffixes, punctuation and marks without spaces in the source stay as they are.
    expect(respacePlaceholders('we use ⟦U1⟧ here.', "⟦U1⟧'de kullanıyoruz.")).toBe(
      "⟦U1⟧'de kullanıyoruz.",
    );
    expect(respacePlaceholders('word⟦N1⟧ next', 'kelime⟦N1⟧ sonraki')).toBe('kelime⟦N1⟧ sonraki');
  });

  it('freezes tagged citations whole and restores them exactly', async () => {
    const { protectNumbers, restoreTerms } = await import('../../src/core/glossary/protect');
    const p = protectNumbers(
      'Scikit-learn [<t4>42</t4>] and [<t8>38</t8>, <t9>58</t9>] on 90% of 1,000',
    );
    expect(p.text).toBe('Scikit-learn ⟦D1⟧ and ⟦D2⟧ on ⟦D3⟧% of ⟦D4⟧');
    expect(restoreTerms('Scikit-learn ⟦D1⟧ ve ⟦D2⟧, ⟦D4⟧ öğenin %⟦D3⟧', p.targets, 'D')).toBe(
      'Scikit-learn [<t4>42</t4>] ve [<t8>38</t8>, <t9>58</t9>], 1,000 öğenin %90',
    );
  });

  it('freezes numbers when a machine translator changed one', async () => {
    const sent: string[] = [];
    const engine: TranslationEngine = {
      ...createPseudoEngine(),
      id: 'browser',
      capabilities: { ...createPseudoEngine().capabilities, glossary: false },
      translate(batch) {
        sent.push(...batch.map((b) => b.text));
        // A website translator reads the elided year "17—" as 2017.
        return Promise.resolve(
          batch.map((b) => ({
            id: b.id,
            text: b.text.replace('Geneva', 'Cenevre').replace(/\b17—/, '2017—'),
          })),
        );
      },
    };
    const out = await translateSegments({
      engine,
      segments: [seg('d', 'Geneva, March 18th, 17—')],
      ctx: { ...ctx, pair: { source: 'en', target: 'tr' } },
      signal: new AbortController().signal,
    });
    expect(sent).toEqual(['Geneva, March 18th, 17—', 'Geneva, March ⟦D1⟧th, ⟦D2⟧—']);
    expect(out[0]).toMatchObject({ text: 'Cenevre, March 18th, 17—', untranslated: false });
  });

  it('splits truncated batches, caches results and runs the fidelity check', async () => {
    let first = true;
    const engine = scripted([
      (id) =>
        id === 'a' ? 'This method is 3.5 times faster [2].' : 'The results may be generalisable.',
    ]);
    const translate = engine.translate.bind(engine);
    engine.translate = (batch, c, s) => {
      if (first && batch.length > 1) {
        first = false;
        return Promise.reject(new EngineError('truncated', 'cut'));
      }
      return translate(batch, c, s);
    };
    const cache = new MemoryCache();
    const run = () =>
      translateSegments({
        engine,
        segments,
        ctx,
        signal: new AbortController().signal,
        cache,
        fidelityCheck: true,
      });
    const out = await run();
    expect(engine.calls).toEqual([['a'], ['b']]);
    expect(out[1]!.issues).toEqual([
      expect.objectContaining({ code: 'MEANING_DRIFT', detail: 'major: hedging lost' }),
    ]);
    const again = await run();
    expect(engine.calls).toHaveLength(2);
    expect(again.every((o) => o.cached)).toBe(true);
    expect(again[1]!.findings).toHaveLength(1);
  });

  it('stops the job on fatal engine errors', async () => {
    const engine = scripted([() => 'x']);
    engine.translate = () => Promise.reject(new EngineError('auth', 'bad key'));
    await expect(
      translateSegments({ engine, segments, ctx, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('helpers', () => {
  it('re-applies tags on whole words in order, never inside other tags', () => {
    expect(
      placeTags('MuPDF works fast', [
        { id: 't1', text: 'MuPDF' },
        { id: 't2', text: 'hızlı' },
      ]),
    ).toEqual({ text: '<t1>MuPDF</t1> works fast', lost: ['t2'] });
    expect(
      placeTags('an n-gram and n', [
        { id: 't1', text: 'n' },
        { id: 't2', text: 'n' },
      ]).text,
    ).toBe('an <t1>n</t1>-gram and <t2>n</t2>');
  });

  it('keeps the initial capital of the source (locale-aware)', () => {
    expect(matchInitialCase('Background.', 'arka plan.', 'tr')).toBe('Arka plan.');
    expect(matchInitialCase('Related work', 'ilgili çalışmalar', 'tr')).toBe('İlgili çalışmalar');
    expect(matchInitialCase('<t1>Aims.</t1>', '<t1>amaçlar.</t1>', 'tr')).toBe('<t1>Amaçlar.</t1>');
    expect(matchInitialCase('The classifiers', '5.193 iyi huylu', 'tr')).toBe('5.193 iyi huylu');
    expect(matchInitialCase('[22] have been', 'bildirilmiştir', 'tr')).toBe('bildirilmiştir');
    expect(matchInitialCase('2 Background', '2 arka plan', 'tr')).toBe('2 Arka plan');
  });

  it('splits sentences but not after abbreviations or initials', () => {
    expect(
      splitSentences(
        'We use it (e.g. Fig. 2). Ohm et al. [37] agree. J. Smith too! 5 tools exist.',
      ),
    ).toEqual([
      'We use it (e.g. Fig. 2).',
      'Ohm et al. [37] agree.',
      'J. Smith too!',
      '5 tools exist.',
    ]);
  });

  it('splits clauses outside brackets only between longer parts', () => {
    expect(
      splitClauses(
        'In the training dataset, 23 out of 138 malicious and 3 out of 5,193 benign packages [48, 56, 58] were misclassified.',
      ),
    ).toEqual([
      'In the training dataset,',
      '23 out of 138 malicious and 3 out of 5,193 benign packages [48, 56, 58] were misclassified.',
    ]);
    expect(splitClauses('Table 2: An overview, in short.')).toEqual([
      'Table 2:',
      'An overview, in short.',
    ]);
  });

  it('translates the Abstract heading from a table, keeping markup and case', () => {
    expect(academicHeading('⟦I1⟧Abstract', 'en', 'tr')).toBe('⟦I1⟧Özet');
    expect(academicHeading('<t1>ABSTRACT:</t1>', 'en', 'de')).toBe('<t1>ZUSAMMENFASSUNG:</t1>');
    expect(academicHeading('Abstract algebra', 'en', 'tr')).toBeNull();
    expect(academicHeading('A B S T R A C T', 'en', 'tr')).toBe('ÖZET');
    expect(academicHeading('A R T I C L E  I N F O', 'en', 'tr')).toBe('MAKALE BİLGİSİ');
    // Metrics only in documents that name both precision and recall.
    expect(academicHeading('Recall (%)', 'en', 'tr', true)).toBe('Duyarlılık (%)');
    expect(academicHeading('№ з/п', 'uk', 'en')).toBe('No.');
    expect(isNameList('Haya Samaana, Diego Elias Costa, Emad Shihab and Ahmad Abdellatif')).toBe(
      true,
    );
    expect(isNameList('V. I. Munerman, D. V. Munerman')).toBe(true);
    expect(isNameList('Precision, Recall and F1-score')).toBe(false);
    expect(isNameList('Results and Discussion')).toBe(false);
    // Title-case keyword lists look alike: the pipeline also requires affiliation marks.
    expect(isNameList('Machine Learning, Deep Learning and Data Mining')).toBe(true);
    expect(academicHeading('Overall', 'en', 'tr')).toBe('Genel');
    expect(academicHeading('Recall', 'en', 'tr')).toBeNull();
    expect(usesMetrics(['Precision and recall of the classifier'], 'en')).toBe(true);
    expect(usesMetrics(['Free recall of word lists'], 'en')).toBe(false);
  });

  it('accepts identical output for names and code, not for sentences', () => {
    const check = (text: string) =>
      validateTranslation({ source: text, target: text, sourceLang: 'en', targetLang: 'tr' })
        .filter((i) => i.code === 'UNTRANSLATED')
        .map((i) => i.severity);
    expect(check('Haya Samaana1, Diego Elias Costa2, Emad Shihab2')).toEqual(['info']);
    expect(check('has_long_str is_valid_homepage')).toEqual(['info']);
    expect(check('The results of the study are shown here.')).toEqual(['error']);
  });

  it('joins line-end hyphens left inside words, not real compounds', () => {
    const fix = createDehyphenator([
      'Malicious pack-ages and other packages use exter-nal code.',
      'A state-of-the-art machine-learning model; Mal-OSS; ma-licious.',
      'malicious external',
    ]);
    expect(fix('Malicious pack-ages use <t1>exter-nal</t1> code ⟦F1⟧.')).toBe(
      'Malicious packages use <t1>external</t1> code ⟦F1⟧.',
    );
    expect(fix('A state-of-the-art machine-learning model; Mal-OSS; ma-licious.')).toBe(
      'A state-of-the-art machine-learning model; Mal-OSS; malicious.',
    );
  });

  it('Chrome engine: sends identifiers inline and run-in headings without their full stop', async () => {
    const sent: string[] = [];
    const engine = createChromeEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => {
        sent.push(...texts);
        return Promise.resolve(
          texts.map((t) =>
            t === 'Test dataset'
              ? 'Test veri kümesi'
              : t.replace(/<\/?t\d+>|⟦[A-Z]\d+⟧/g, '').replace('PyPI', 'PyPi'),
          ),
        );
      },
    });
    const [r] = await engine.translate(
      [
        {
          id: 'a',
          text: '<t1>Test dataset</t1>. Packages on ⟦U1⟧ are scanned.',
          role: 'body',
          verbatim: { U1: 'PyPI' },
        },
      ],
      ctx,
      new AbortController().signal,
    );
    expect(sent).toContain('Test dataset');
    expect(r!.text).toBe('<t1>Test veri kümesi</t1>. Packages on ⟦U1⟧ are scanned.');
  });

  it('Chrome engine: keeps every tag and placeholder even when the API drops them', async () => {
    // Behaves like Chrome's Translator API: markup is lost and the first letter lower-cased.
    const lossy = (t: string) => {
      const plain = t.replace(/<\/?t\d+>|⟦[A-Z]\d+⟧/g, '');
      return plain.charAt(0).toLowerCase() + plain.slice(1);
    };
    const engine = createChromeEngine({
      availability: () => Promise.resolve('available'),
      translate: (_pair, texts) => Promise.resolve(texts.map(lossy)),
    });
    const batch = [
      seg('a', 'Haya Samaana<t1>1</t1>, Diego Costa<t2>2</t2>, Emad Shihab<t3>2</t3>'),
      seg('b', '<t1>Background.</t1> Tools ⟦F1⟧ are used.⟦T1⟧Input'),
      seg('c', 'Malware Checks [35]⟦T1⟧setup.py⟦T2⟧Static <t1>bandit</t1> rules'),
    ];
    const out = await engine.translate(batch, ctx, new AbortController().signal);
    expect(out.map((r) => r.text)).toEqual([
      'Haya Samaana<t1>1</t1>, Diego Costa<t2>2</t2>, Emad Shihab<t3>2</t3>',
      '<t1>Background.</t1> Tools ⟦F1⟧ are used.⟦T1⟧Input',
      'Malware Checks [35]⟦T1⟧setup.py⟦T2⟧Static <t1>bandit</t1> rules',
    ]);
    expect(out.every((r) => !r.notes?.includes('style-approximated'))).toBe(true);
  });

  it('parses JSON wrapped in chatter or fences', () => {
    expect(parseJsonLoose('Sure!\n```json\n{"segments":[]}\n```')).toEqual({ segments: [] });
    expect(() => parseJsonLoose('no json')).toThrow(EngineError);
  });

  it('round-trips glossary CSV and lets user entries win', () => {
    const csv = glossaryToCsv([
      { source: 'derin öğrenme', target: 'deep learning' },
      { source: 'a, b', target: '"q"', note: 'n' },
    ]);
    expect(parseGlossaryCsv(csv)).toEqual([
      { source: 'derin öğrenme', target: 'deep learning' },
      { source: 'a, b', target: '"q"', note: 'n' },
    ]);
    expect(
      mergeGlossaries(
        [{ source: 'Veri', target: 'data' }],
        [{ source: 'veri', target: 'dataset' }],
      ),
    ).toEqual([{ source: 'veri', target: 'dataset' }]);
  });

  it('redacts API keys from error text', () => {
    expect(redactSecrets('401: invalid x-api-key sk-ant-TEST-abcdefghijklmnop')).not.toContain(
      'sk-ant-TEST',
    );
  });
});

describe('glossary term protection', () => {
  it('protects terms with suffixes and restores glossary targets', async () => {
    const { protectTerms, restoreTerms } = await import('../../src/core/glossary/protect');
    const glossary = [
      { source: 'derin öğrenme', target: 'deep learning' },
      { source: 'İstatistik', target: 'statistics' },
    ];
    const p = protectTerms(
      '<t1>Derin öğrenmenin</t1> avantajları istatistiksel olarak ⟦F1⟧ incelendi.',
      glossary,
      'tr',
    );
    expect(p.text).toBe('<t1>⟦G1⟧</t1> avantajları ⟦G2⟧ olarak ⟦F1⟧ incelendi.');
    expect(
      restoreTerms('The advantages of <t1>⟦G1⟧</t1> were examined ⟦G2⟧ ⟦F1⟧.', p.targets),
    ).toBe('The advantages of <t1>deep learning</t1> were examined statistics ⟦F1⟧.');
    expect(restoreTerms('lost term', p.targets)).toBeNull();
  });
});
