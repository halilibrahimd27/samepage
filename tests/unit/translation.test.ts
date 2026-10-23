import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import { glossaryToCsv, mergeGlossaries, parseGlossaryCsv } from '../../src/core/glossary/glossary';
import { translateSegments } from '../../src/core/pipeline/translate';
import { reapplyTags } from '../../src/engines/chromeBuiltin';
import { parseJsonLoose } from '../../src/engines/openaiCompatible';
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
  it('re-applies tags that survived verbatim and keeps the structure valid', () => {
    expect(reapplyTags('<t1>MuPDF</t1> ile <t2>hızlı</t2> çalışır', 'MuPDF works fast')).toBe(
      '<t1>MuPDF</t1> works fast<t2></t2>',
    );
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
