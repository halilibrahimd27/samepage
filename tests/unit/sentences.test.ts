import { describe, expect, it } from 'vitest';
import { sentencePieces, translateSegments } from '../../src/core/pipeline/translate';
import { createPseudoEngine } from '../../src/engines/pseudo';
import type { TranslationEngine } from '../../src/engines/types';

/** Two Turkish sentences; the whole paragraph comes back with an invented year (as Google did). */
const SENTENCES: Record<string, string> = {
  'Bu yöntem 1980 yılında geliştirildi.': 'This method was developed in 1980.',
  'Bu yöntem ⟦D1⟧ yılında geliştirildi.': 'This method was developed in ⟦D1⟧.',
  'Sonuçlar tutarlıdır.': 'The results are consistent.',
};

function machineTranslator(): TranslationEngine & { sent: string[] } {
  const sent: string[] = [];
  return {
    ...createPseudoEngine(),
    id: 'browser',
    capabilities: { ...createPseudoEngine().capabilities, glossary: false },
    sent,
    translate(batch) {
      sent.push(...batch.map((b) => b.text));
      return Promise.resolve(
        batch.map((b) => ({
          id: b.id,
          text:
            SENTENCES[b.text] ??
            'This method was developed in 1980, and since the 1990s the results are consistent.',
        })),
      );
    },
  };
}

describe('sentence-by-sentence retry', () => {
  it('splits only where no inline formatting crosses a sentence end', () => {
    expect(sentencePieces('Bir cümle. <t1>İkinci</t1> cümle.')).toEqual([
      'Bir cümle.',
      '<t1>İkinci</t1> cümle.',
    ]);
    expect(sentencePieces('<t1>Bir cümle. İkinci</t1> cümle.')).toBeNull();
    expect(sentencePieces('Tek cümle.')).toBeNull();
  });

  it('translates a paragraph the engine keeps rewriting sentence by sentence', async () => {
    const engine = machineTranslator();
    const [out] = await translateSegments({
      engine,
      segments: [
        {
          id: 'p',
          text: 'Bu yöntem 1980 yılında geliştirildi. Sonuçlar tutarlıdır.',
          role: 'body',
        },
      ],
      ctx: { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(out!.untranslated).toBe(false);
    expect(out!.text).toBe('This method was developed in 1980. The results are consistent.');
    expect(out!.issues.map((i) => [i.code, i.severity])).toEqual([['REVIEW_SUGGESTED', 'info']]);
    expect(engine.sent).toContain('Sonuçlar tutarlıdır.');
  });
});
