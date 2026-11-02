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
    // The sentences a run crosses stay together; the rest are split.
    expect(
      sentencePieces(
        '<t1>Figure S2. Supply curves.</t1> Bars show the potential. The rest is used.',
      ),
    ).toEqual([
      '<t1>Figure S2. Supply curves.</t1>',
      'Bars show the potential.',
      'The rest is used.',
    ]);
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

  it('keeps the source when an engine makes up years, even if no number is lost', async () => {
    const engine: TranslationEngine = {
      ...machineTranslator(),
      translate: (batch) =>
        Promise.resolve(batch.map((b) => ({ id: b.id, text: `${b.text} 2018 2019 2023` }))),
    };
    const [out] = await translateSegments({
      engine,
      segments: [
        { id: 'y', text: 'Засновано у 2007 році. Журнал включено до переліку.', role: 'body' },
      ],
      ctx: { pair: { source: 'uk', target: 'tr' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(out!.untranslated).toBe(true);
  });

  it('translates a flagged paragraph again sentence by sentence and keeps it when it checks out', async () => {
    const whole: Record<string, string> = {
      'Bu yöntem işe yaramadı. Sonuçlar tutarlıdır.':
        'This method worked. The results are consistent.',
      'Bu yöntem işe yaramadı.': 'This method did not work.',
      'Sonuçlar tutarlıdır.': 'The results are consistent.',
    };
    const engine: TranslationEngine = {
      ...machineTranslator(),
      translate: (batch) =>
        Promise.resolve(batch.map((b) => ({ id: b.id, text: whole[b.text] ?? b.text }))),
      checkFidelity: (pairs) =>
        Promise.resolve({
          findings: pairs
            .filter((p) => !p.target.includes(' not '))
            .map((p) => ({ id: p.id, issue: 'negation lost', severity: 'major' as const })),
        }),
    };
    const [out] = await translateSegments({
      engine,
      segments: [{ id: 'n', text: 'Bu yöntem işe yaramadı. Sonuçlar tutarlıdır.', role: 'body' }],
      ctx: { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false },
      fidelityCheck: true,
      signal: new AbortController().signal,
    });
    expect(out!.text).toBe('This method did not work. The results are consistent.');
    expect(out!.issues.map((i) => i.code)).not.toContain('MEANING_DRIFT');
    expect(out!.findings).toEqual([]);
  });

  it('clears a flag the back-translation raised when the translation reads right in English', async () => {
    const source =
      'Соціальні виклики: збільшення кількості залишених без опіки дітей та старіння населення.';
    const turkish =
      'Sosyal zorluklar: bakımsız kalan çocuk sayısındaki artış ve nüfusun yaşlanması.';
    const engine: TranslationEngine = {
      ...machineTranslator(),
      translate: (batch, ctx) =>
        Promise.resolve(
          batch.map((b) => ({
            id: b.id,
            text:
              ctx.pair.target === 'en'
                ? 'Social challenges: an increase in children left without care and population ageing.'
                : turkish,
          })),
        ),
      // The back-translation went wrong ("children in care"): a negation looks lost.
      checkFidelity: (pairs) =>
        Promise.resolve({
          findings: pairs.map((p) => ({
            id: p.id,
            issue: 'negation lost',
            severity: 'major' as const,
          })),
        }),
    };
    const [out] = await translateSegments({
      engine,
      segments: [{ id: 'u', text: source, role: 'body' }],
      ctx: { pair: { source: 'uk', target: 'tr' }, glossary: [], numberLocalization: false },
      fidelityCheck: true,
      signal: new AbortController().signal,
    });
    expect(out!.text).toBe(turkish);
    expect(out!.findings).toEqual([]);
    expect(out!.issues.map((i) => i.code)).not.toContain('MEANING_DRIFT');
  });

  it('keeps an author line with math-asterisk marks as it is', async () => {
    const engine: TranslationEngine = {
      ...machineTranslator(),
      translate: (batch) =>
        Promise.resolve(batch.map((b) => ({ id: b.id, text: b.text.toLowerCase() }))),
    };
    const text = 'Wenbo Guo∗, Zhengzi Xu†‡, Chengwei Liu†, Yong Pi∗‡';
    const [out] = await translateSegments({
      engine,
      segments: [{ id: 'a', text, role: 'body' }],
      ctx: { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(out!.text).toBe(text);
  });

  it('takes a translation that writes a source year once more, flagged', async () => {
    const engine: TranslationEngine = {
      ...machineTranslator(),
      translate: (batch) =>
        Promise.resolve(
          batch.map((b) => ({
            id: b.id,
            text: b.text.replace(
              'Mudanças de mobilidade em 29 de março em relação a 16 de fevereiro de 2020.',
              "Mobilite, 16 Şubat 2020'ye göre 29 Mart 2020'de değişti.",
            ),
          })),
        ),
    };
    const [out] = await translateSegments({
      engine,
      segments: [
        {
          id: 'p',
          text: 'Mudanças de mobilidade em 29 de março em relação a 16 de fevereiro de 2020.',
          role: 'body',
        },
      ],
      ctx: { pair: { source: 'pt', target: 'tr' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(out!.untranslated).toBe(false);
    expect(out!.issues).toContainEqual(
      expect.objectContaining({ code: 'NUMBER_MISMATCH', severity: 'warning' }),
    );
  });

  it('takes a translation that writes a number the source spells out, flagged', async () => {
    const engine: TranslationEngine = {
      ...machineTranslator(),
      translate: (batch) =>
        Promise.resolve(
          batch.map((b) => ({
            id: b.id,
            text: b.text
              .replace(
                'Rewolucja końca osiemnastego wieku była inna.',
                '18. yüzyıl devrimi farklıydı.',
              )
              .replace('Tak było.', 'Öyleydi.'),
          })),
        ),
    };
    const [out] = await translateSegments({
      engine,
      segments: [
        { id: 'p', text: 'Rewolucja końca osiemnastego wieku była inna. Tak było.', role: 'body' },
      ],
      ctx: { pair: { source: 'pl', target: 'tr' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
    });
    expect(out!.untranslated).toBe(false);
    expect(out!.text).toBe('18. yüzyıl devrimi farklıydı. Öyleydi.');
    expect(out!.issues).toContainEqual(
      expect.objectContaining({ code: 'NUMBER_MISMATCH', severity: 'warning' }),
    );
  });
});
