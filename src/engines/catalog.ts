/** Static UI metadata for the engines (the runtime registry arrives in Phase 1). */
export type EngineId = 'browser' | 'chrome-builtin' | 'anthropic' | 'openai-compatible' | 'pseudo';
export type Privacy = 'browser-vendor' | 'on-device' | 'third-party-api' | 'local-server';

export interface EngineInfo {
  id: EngineId;
  privacy: Privacy;
  /** Lower fidelity for academic text: shown with a "draft quality" badge. */
  draftQuality: boolean;
  testOnly: boolean;
  /** Shown only when "advanced engines" is enabled in settings. */
  advanced: boolean;
}

/** Free engines first (ADR-015); LLM engines are optional "advanced" engines. */
export const ENGINES: readonly EngineInfo[] = [
  {
    id: 'browser',
    privacy: 'browser-vendor',
    draftQuality: false,
    testOnly: false,
    advanced: false,
  },
  {
    id: 'chrome-builtin',
    privacy: 'on-device',
    draftQuality: false,
    testOnly: false,
    advanced: false,
  },
  {
    id: 'anthropic',
    privacy: 'third-party-api',
    draftQuality: false,
    testOnly: false,
    advanced: true,
  },
  {
    id: 'openai-compatible',
    privacy: 'local-server',
    draftQuality: true,
    testOnly: false,
    advanced: true,
  },
  { id: 'pseudo', privacy: 'on-device', draftQuality: false, testOnly: true, advanced: false },
];

/** Chrome's Translator API exists only in desktop Chrome/Edge 138+ (main thread). */
export function isChromeTranslatorPresent(): boolean {
  return typeof globalThis === 'object' && 'Translator' in globalThis;
}
