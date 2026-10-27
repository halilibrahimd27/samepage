import { afterEach, describe, expect, it, vi } from 'vitest';

const google = vi.hoisted(() => ({ calls: 0, failures: 0 }));
vi.mock('../../src/app/bridges/googleTranslate', () => ({
  closeGoogleTranslate: () => undefined,
  googleTranslate: (_pair: unknown, texts: string[]) => {
    google.calls++;
    return google.calls <= google.failures
      ? Promise.reject(new Error('Google Translate could not be loaded'))
      : Promise.resolve(texts.map((t) => `[${t}]`));
  },
}));

const { browserTranslationBridge, sheetStore } =
  await import('../../src/app/bridges/browserTranslator');
const pair = { source: 'tr', target: 'en' };

describe('automatic Google translation', () => {
  afterEach(() => {
    vi.useRealTimers();
    sheetStore.cancel();
  });

  it('waits and retries a helper that failed to load before giving up', async () => {
    vi.useFakeTimers();
    google.calls = 0;
    google.failures = 2;
    const result = browserTranslationBridge.translate(pair, ['bir']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(google.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(result).resolves.toEqual(['[bir]']);
    expect(google.calls).toBe(3);
    expect(sheetStore.get()).toBeNull();
  });

  it('falls back to the manual sheet after three failures, for a while', async () => {
    vi.useFakeTimers();
    google.calls = 0;
    google.failures = 3;
    const first = browserTranslationBridge.translate(pair, ['bir']);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sheetStore.get()?.notice).toBe('auto-failed');
    sheetStore.finish(sheetStore.get()!.id, ['one']);
    await expect(first).resolves.toEqual(['one']);
    // The next batch goes straight to the sheet …
    browserTranslationBridge.translate(pair, ['iki']).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(google.calls).toBe(3);
    sheetStore.cancel();
    // … and after five minutes automatic translation is tried again.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await expect(browserTranslationBridge.translate(pair, ['üç'])).resolves.toEqual(['[üç]']);
  });
});
