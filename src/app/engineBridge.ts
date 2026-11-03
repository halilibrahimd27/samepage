import { proxy } from 'comlink';
import type { ChromeTranslatorBridge } from '../engines/chromeBuiltin';
import type { EngineId, LangPair } from '../engines/types';
import { browserTranslationBridge } from './bridges/browserTranslator';
import { chromeTranslatorBridge, prepareChromeTranslator } from './bridges/chromeTranslator';
import { prepareChromeAi, reviseOnDevice } from './bridges/chromeAi';
import type { Translate } from './i18n';

/**
 * The main-thread bridge for engines that translate in the page (Chrome built-in, Google), with
 * the browser's own model when it polishes (`onDevice`). Call it inside the click handler:
 * Chrome only creates translators and its model after a user gesture.
 */
export async function engineBridge(
  engine: EngineId,
  pair: LangPair,
  onDownload: (percent: number | null) => void,
  onDevice = false,
): Promise<ChromeTranslatorBridge | undefined> {
  let bridge: ChromeTranslatorBridge | undefined;
  if (engine === 'chrome-builtin') {
    await prepareChromeTranslator(pair, (f) => onDownload(Math.round(f * 100)));
    onDownload(null);
    bridge = chromeTranslatorBridge;
  }
  if (engine === 'browser') bridge = browserTranslationBridge;
  if (!bridge) return undefined;
  if (!onDevice) return proxy(bridge);
  await prepareChromeAi(pair, (f) => onDownload(Math.round(f * 100)));
  onDownload(null);
  return proxy({ ...bridge, revise: reviseOnDevice });
}

/** Text for an error thrown while starting or running a job. */
export function runErrorText(error: unknown, t: Translate): string {
  const message = error instanceof Error ? error.message : String(error);
  // Chrome refuses to create the translator when its language download failed.
  return /Unable to create translator|cannot translate this language pair|download stalled/i.test(
    message,
  )
    ? t('error.chromeTranslator')
    : message;
}
