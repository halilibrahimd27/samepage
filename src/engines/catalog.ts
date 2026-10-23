/** Static UI metadata for the engines (the runtime registry arrives in Phase 1). */
export type EngineId = 'anthropic' | 'chrome-builtin' | 'openai-compatible' | 'pseudo';
export type Privacy = 'on-device' | 'third-party-api' | 'local-server';

export interface EngineInfo {
  id: EngineId;
  privacy: Privacy;
  /** Lower fidelity for academic text: shown with a "draft quality" badge. */
  draftQuality: boolean;
  testOnly: boolean;
}

export const ENGINES: readonly EngineInfo[] = [
  { id: 'anthropic', privacy: 'third-party-api', draftQuality: false, testOnly: false },
  { id: 'chrome-builtin', privacy: 'on-device', draftQuality: true, testOnly: false },
  { id: 'openai-compatible', privacy: 'local-server', draftQuality: true, testOnly: false },
  { id: 'pseudo', privacy: 'on-device', draftQuality: false, testOnly: true },
];

/** Chrome's Translator API exists only in desktop Chrome/Edge 138+ (main thread). */
export function isChromeTranslatorPresent(): boolean {
  return typeof globalThis === 'object' && 'Translator' in globalThis;
}
