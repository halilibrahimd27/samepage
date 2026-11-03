import { afterEach, describe, expect, it } from 'vitest';
import { chromeAiAvailability, reviseOnDevice } from '../../src/app/bridges/chromeAi';
import type { ChromeTranslatorBridge } from '../../src/engines/chromeBuiltin';
import { createOnDeviceEditor } from '../../src/engines/onDevice';

const ctx = { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false };
const item = (id: string) => ({
  id,
  role: 'body' as const,
  source: 'Sonuçlar anlamlı değildir.',
  draft: 'The results are significant.',
  findings: ['major: negation lost'],
});
const bridge = (revise: ChromeTranslatorBridge['revise']): ChromeTranslatorBridge => ({
  availability: () => Promise.resolve('available'),
  translate: (_, texts) => Promise.resolve(texts),
  ...(revise ? { revise } : {}),
});

describe('polishing with the browser’s own model', () => {
  it('revises each flagged item alone, under the instructions Claude gets', async () => {
    const asked: string[] = [];
    const editor = createOnDeviceEditor(
      bridge((_, system, user) => {
        asked.push(user);
        expect(system).toMatch(/expert editor of academic translations from Turkish to English/u);
        const id = /<item id="([^"]+)"/u.exec(user)![1];
        return Promise.resolve(
          JSON.stringify({
            segments: [{ id, text: 'The results are not significant.', over: false }],
          }),
        );
      }),
    );
    const out = await editor.postEdit!([item('a'), item('b')], ctx, new AbortController().signal);
    expect(asked).toHaveLength(2);
    expect(out).toEqual([
      { id: 'a', text: 'The results are not significant.' },
      { id: 'b', text: 'The results are not significant.' },
    ]);
  });

  it('leaves the flagged translation when the model cannot answer', async () => {
    for (const revise of [
      () => Promise.resolve(null),
      () => Promise.resolve('Sure! Here is the revised text: …'),
      () => Promise.reject(new Error('session destroyed')),
    ]) {
      const out = await createOnDeviceEditor(bridge(revise)).postEdit!(
        [item('a')],
        ctx,
        new AbortController().signal,
      );
      expect(out).toEqual([]);
    }
    // A bridge without the model (no on-device polishing chosen) revises nothing.
    expect(
      await createOnDeviceEditor(bridge(undefined)).postEdit!(
        [item('a')],
        ctx,
        new AbortController().signal,
      ),
    ).toEqual([]);
  });
});

describe('Chrome’s Prompt API bridge', () => {
  const g = globalThis as { LanguageModel?: unknown };
  afterEach(() => {
    delete g.LanguageModel;
  });

  it('asks Chrome whether it writes the target language, and prompts a copy per item', async () => {
    expect(await chromeAiAvailability({ source: 'tr', target: 'en' })).toBe('unavailable');
    const log: string[] = [];
    const session = (name: string) => ({
      prompt: (input: string, options?: { responseConstraint?: object }) => {
        log.push(`${name} prompt ${input} ${options?.responseConstraint ? 'json' : 'text'}`);
        return Promise.resolve('{"segments":[]}');
      },
      clone: () => Promise.resolve(session(`${name}'`)),
      destroy: () => log.push(`${name} destroyed`),
    });
    g.LanguageModel = {
      availability: (o: { expectedOutputs: { languages: string[] }[] }) =>
        Promise.resolve(
          o.expectedOutputs[0]!.languages[0] === 'en' ? 'downloadable' : 'unavailable',
        ),
      create: (o: { initialPrompts?: { content: string }[] }) => {
        log.push(`create ${o.initialPrompts?.[0]?.content ?? ''}`);
        return Promise.resolve(session('s'));
      },
    };
    expect(await chromeAiAvailability({ source: 'tr', target: 'en' })).toBe('downloadable');
    expect(await chromeAiAvailability({ source: 'en', target: 'tr' })).toBe('unavailable');
    const pair = { source: 'tr', target: 'en' };
    await reviseOnDevice(pair, 'rules', 'one', {});
    await reviseOnDevice(pair, 'rules', 'two', {});
    // One session with the instructions; each item in a copy, destroyed after its answer.
    expect(log).toEqual([
      'create rules',
      "s' prompt one json",
      "s' destroyed",
      "s' prompt two json",
      "s' destroyed",
    ]);
  });
});
