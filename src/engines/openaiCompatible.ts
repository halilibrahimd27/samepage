import {
  CONDENSE_SCHEMA,
  condensePrompt,
  TRANSLATION_SCHEMA,
  translationSystemPrompt,
  translationUserMessage,
  unescapeXml,
} from './prompt';
import { isLocalBaseUrl } from './localDefaults';
import { EngineError, type TranslationEngine } from './types';

/** Parses JSON from chat output that may be wrapped in prose or code fences. */
export function parseJsonLoose(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new EngineError('bad-response', 'The server returned no JSON.');
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new EngineError('bad-response', 'The server returned malformed JSON.');
  }
}

export function createOpenAICompatibleEngine(config: {
  baseUrl: string;
  model: string;
  apiKey?: string;
}): TranslationEngine {
  const base = config.baseUrl.replace(/\/+$/, '');
  let jsonMode = true;

  async function chat(
    system: string,
    user: string,
    schema: object,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!isLocalBaseUrl(base)) {
      throw new EngineError(
        'unavailable',
        'Only localhost / 127.0.0.1 servers can be used from the hosted site.',
      );
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    const body = {
      model: config.model,
      stream: false,
      messages: [
        {
          role: 'system',
          content: `${system}\n\nAnswer with JSON matching this schema: ${JSON.stringify(schema)}`,
        },
        { role: 'user', content: user },
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new EngineError(
        'network',
        `Could not reach ${base}. Is the server running and does it allow this site via CORS (Ollama: OLLAMA_ORIGINS)?`,
      );
    }
    if (res.status === 400 && jsonMode) {
      // Some servers do not support response_format; retry once without it.
      jsonMode = false;
      return chat(system, user, schema, signal);
    }
    if (res.status === 401 || res.status === 403)
      throw new EngineError('auth', 'The local server rejected the API key.');
    if (res.status === 404)
      throw new EngineError('bad-request', `Model "${config.model}" or endpoint not found.`);
    if (res.status >= 500) throw new EngineError('server', `Local server error ${res.status}.`);
    if (!res.ok) throw new EngineError('bad-request', `Local server returned ${res.status}.`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length')
      throw new EngineError('truncated', 'The response hit the output limit.');
    return parseJsonLoose(choice?.message?.content ?? '');
  }

  return {
    id: 'openai-compatible',
    label: 'Local LLM server',
    runsOn: 'worker',
    privacy: 'local-server',
    capabilities: {
      glossary: false,
      lengthBudget: true,
      tagsReliable: false,
      condense: true,
      vision: false,
      fidelityCheck: false,
    },
    model: `${base}#${config.model}`,
    maxBatchChars: 3000,
    isAvailable: () =>
      Promise.resolve(isLocalBaseUrl(base) && config.model ? 'available' : 'unavailable'),

    async translate(batch, ctx, signal) {
      const out = (await chat(
        translationSystemPrompt(ctx),
        translationUserMessage(batch, ctx),
        TRANSLATION_SCHEMA,
        signal,
      )) as {
        segments?: { id?: unknown; text?: unknown; over?: unknown }[];
      };
      return (out.segments ?? [])
        .filter((s) => typeof s.id === 'string' && typeof s.text === 'string')
        .map((s) => ({
          id: s.id as string,
          text: unescapeXml(s.text as string),
          overBudget: s.over === true,
        }));
    },

    async condense(req, signal) {
      const out = (await chat(
        translationSystemPrompt(req.ctx),
        condensePrompt(req),
        CONDENSE_SCHEMA,
        signal,
      )) as {
        text?: unknown;
      };
      return typeof out.text === 'string' ? unescapeXml(out.text) : req.current;
    },
  };
}
