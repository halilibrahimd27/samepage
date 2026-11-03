import type { LangPair } from '../../engines/types';

/**
 * Chrome's own language model (Gemini Nano, the Prompt API), on the device and free: it revises
 * the sentences the meaning check flags, as Claude does under the user's key. Chrome downloads
 * the model once, for every site; it writes a few languages only (English among them, not
 * Turkish), so the option is offered when Chrome says it can write the target language.
 */

export type ChromeAiAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: { loaded: number }) => void): void;
}
interface LanguageOptions {
  expectedInputs?: { type: 'text'; languages: string[] }[];
  expectedOutputs?: { type: 'text'; languages: string[] }[];
}
interface Session {
  prompt(
    input: string,
    options?: { responseConstraint?: object; signal?: AbortSignal },
  ): Promise<string>;
  clone(): Promise<Session>;
  destroy(): void;
}
interface LanguageModelStatic {
  availability(options?: LanguageOptions): Promise<ChromeAiAvailability>;
  create(
    options: LanguageOptions & {
      initialPrompts?: { role: 'system'; content: string }[];
      monitor?: (m: DownloadMonitor) => void;
    },
  ): Promise<Session>;
}

const api = (): LanguageModelStatic | undefined =>
  (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;

const languages = (pair: LangPair): LanguageOptions => ({
  expectedInputs: [{ type: 'text', languages: [pair.source, pair.target] }],
  expectedOutputs: [{ type: 'text', languages: [pair.target] }],
});

/** Whether Chrome's model can revise translations into the pair's target language. */
export async function chromeAiAvailability(pair: LangPair): Promise<ChromeAiAvailability> {
  const LM = api();
  if (!LM) return 'unavailable';
  return LM.availability(languages(pair)).catch(() => 'unavailable' as const);
}

/** One session per pair and instructions; each item is asked in a copy of it, alone. */
const sessions = new Map<string, Promise<Session>>();

function session(pair: LangPair, system: string, onProgress?: (f: number) => void) {
  const key = `${pair.source}>${pair.target}\n${system}`;
  let s = sessions.get(key);
  if (!s) {
    const LM = api();
    if (!LM) return Promise.reject(new Error('Chrome’s built-in AI is not available.'));
    s = LM.create({
      ...languages(pair),
      initialPrompts: [{ role: 'system', content: system }],
      ...(onProgress
        ? {
            monitor: (m: DownloadMonitor) =>
              m.addEventListener('downloadprogress', (e) => onProgress(e.loaded)),
          }
        : {}),
    });
    s.catch(() => sessions.delete(key));
    sessions.set(key, s);
  }
  return s;
}

/**
 * Starts the model (its download, the first time) from the click that starts a job: Chrome
 * downloads it only after a user gesture.
 */
export async function prepareChromeAi(
  pair: LangPair,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const LM = api();
  if (!LM) throw new Error('Chrome’s built-in AI is not available.');
  const warm = await LM.create({
    ...languages(pair),
    ...(onProgress
      ? {
          monitor: (m: DownloadMonitor) =>
            m.addEventListener('downloadprogress', (e) => onProgress(e.loaded)),
        }
      : {}),
  });
  warm.destroy();
}

/**
 * One revision: the instructions, the item, the answer's JSON shape. Null when the model
 * fails or refuses: the flagged translation then stays as it was, with its finding.
 */
export async function reviseOnDevice(
  pair: LangPair,
  system: string,
  user: string,
  schema: object,
): Promise<string | null> {
  try {
    const s = await (await session(pair, system)).clone();
    try {
      return await s.prompt(user, { responseConstraint: schema });
    } finally {
      s.destroy();
    }
  } catch {
    return null;
  }
}
