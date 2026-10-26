import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { glossaryToCsv, mergeGlossaries, parseGlossaryCsv } from '../../src/core/glossary/glossary';
import { translateSegments } from '../../src/core/pipeline/translate';
import { createDehyphenator } from '../../src/core/segment/dehyphenate';
import { createChromeEngine } from '../../src/engines/chromeBuiltin';
import { parseJsonLoose } from '../../src/engines/openaiCompatible';
import {
  matchInitialCase,
  placeTags,
  splitClauses,
  splitSentences,
} from '../../src/engines/plainText';
import { academicHeading } from '../../src/core/glossary/academic';
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
      Promise.resolve(
        pairs
          .filter((p) => p.id === 'b')
          .map((p) => ({ id: p.id, issue: 'hedging lost', severity: 'major' as const })),
      ),
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
  });

  it('accepts identical output for names and code, not for sentences', () => {
    const check = (text: string) =>
      validateTranslation({ source: text, target: text, sourceLang: 'en', targetLang: 'tr' })
        .filter((i) => i.code === 'UNTRANSLATED')
        .map((i) => i.severity);
    expect(check('Haya Samaana1, Diego Elias Costa2, Emad Shihab2')).toEqual(['warning']);
    expect(check('has_long_str is_valid_homepage')).toEqual(['warning']);
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
