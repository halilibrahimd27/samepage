import { useState } from 'react';
import type { LanguageCode } from '../core/languages';
import { DEFAULT_ANTHROPIC_MODEL } from '../engines/anthropicModels';
import type { EngineId } from '../engines/catalog';
import { DEFAULT_LOCAL_BASE_URL } from '../engines/localDefaults';
import type { EngineSpec } from '../workers/api';
import { useApiKey } from './keyStore';
import type { Settings } from './settings';

/** Translation configuration shared by the workspace and the playground. */
export function useEngineConfig(settings: Settings) {
  const [source, setSource] = useState<LanguageCode>('tr');
  const [target, setTarget] = useState<LanguageCode>('en');
  const [engine, setEngine] = useState<EngineId>('anthropic');
  const [anthropicModel, setAnthropicModel] = useState<string>(DEFAULT_ANTHROPIC_MODEL);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LOCAL_BASE_URL);
  const [localModel, setLocalModel] = useState('');
  const apiKey = useApiKey();
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
    }
  };

  return {
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
  };
}

export type EngineConfig = ReturnType<typeof useEngineConfig>;
