import { createAnthropicEngine } from './anthropic';
import { DEFAULT_LOCAL_BASE_URL } from './localDefaults';
import { createOpenAICompatibleEngine } from './openaiCompatible';
import { createPseudoEngine } from './pseudo';
import { registerEngine } from './registry';

registerEngine('anthropic', (c) =>
  createAnthropicEngine({ apiKey: c.apiKey ?? '', ...(c.model ? { model: c.model } : {}) }),
);
registerEngine('openai-compatible', (c) =>
  createOpenAICompatibleEngine({
    baseUrl: c.baseUrl ?? DEFAULT_LOCAL_BASE_URL,
    model: c.model ?? '',
    ...(c.apiKey ? { apiKey: c.apiKey } : {}),
  }),
);
registerEngine('pseudo', (c) => createPseudoEngine(c.pseudo));

export { createEngine } from './registry';
