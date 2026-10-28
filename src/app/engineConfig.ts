import { useState } from 'react';
import type { LanguageCode } from '../core/languages';
import { DEFAULT_ANTHROPIC_MODEL } from '../engines/anthropicModels';
import type { EngineId } from '../engines/catalog';
import { DEFAULT_LOCAL_BASE_URL } from '../engines/localDefaults';
import type { EngineSpec } from '../workers/api';
import { useApiKey } from './keyStore';
import type { Translate } from './i18n';
import type { Settings } from './settings';

/** Translation configuration shared by the workspace and the playground. */
export function useEngineConfig(settings: Settings) {
  const [source, setSource] = useState<LanguageCode>('tr');
  const [target, setTarget] = useState<LanguageCode>('en');
  // Google (automatic, ADR-021) translates better than the on-device model: it is the default.
  const [engine, setEngine] = useState<EngineId>('browser');
  const [anthropicModel, setAnthropicModel] = useState<string>(DEFAULT_ANTHROPIC_MODEL);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LOCAL_BASE_URL);
  const [localModel, setLocalModel] = useState('');
  const apiKey = useApiKey();
  // Hybrid quality (P9.3): Claude revises what the meaning check flags in a Google/Chrome run.
  const [polish, setPolish] = useState(false);
  const [englishSpelling, setEnglishSpelling] = useState<'' | 'american' | 'british'>('');
  // Hiding the test engine falls back to the default engine without an extra state update.
  const activeEngine: EngineId =
    engine === 'pseudo' && !settings.showTestEngine ? 'anthropic' : engine;

  const spec = (): EngineSpec => {
    switch (activeEngine) {
      case 'anthropic':
        return { id: 'anthropic', apiKey: apiKey.key, model: anthropicModel };
      case 'openai-compatible':
        return { id: 'openai-compatible', baseUrl, model: localModel };
      case 'pseudo':
        return { id: 'pseudo', pseudo: { factor: 1.35, substitute: true } };
      case 'chrome-builtin':
        return { id: 'chrome-builtin' };
      case 'browser':
        return { id: 'browser' };
    }
  };

  const polishing = polish && (activeEngine === 'browser' || activeEngine === 'chrome-builtin');

  /** Job options beside the engine: the post-editor and the English spelling. */
  const extras = () => ({
    ...(polishing && apiKey.key ? { polish: { apiKey: apiKey.key, model: anthropicModel } } : {}),
    ...(target === 'en' && englishSpelling ? { englishSpelling } : {}),
  });

  /** First reason the current configuration cannot run, or null. */
  const problem = (t: Translate): string | null => {
    if (source === target) return t('config.sameLanguage');
    if ((activeEngine === 'anthropic' || polishing) && !apiKey.key) return t('config.needKey');
    if (activeEngine === 'openai-compatible' && !localModel.trim())
      return t('config.needLocalModel');
    return null;
  };

  return {
    problem,
    source,
    setSource,
    target,
    setTarget,
    engine: activeEngine,
    setEngine,
    anthropicModel,
    setAnthropicModel,
    baseUrl,
    setBaseUrl,
    localModel,
    setLocalModel,
    apiKey,
    spec,
    polish,
    setPolish,
    polishing,
    englishSpelling,
    setEnglishSpelling,
    extras,
  };
}

export type EngineConfig = ReturnType<typeof useEngineConfig>;
