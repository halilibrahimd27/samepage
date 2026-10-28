import Anthropic from '@anthropic-ai/sdk';
import type { GlossaryEntry } from '../core/validate/validate';
import {
  CONDENSE_SCHEMA,
  condensePrompt,
  FIDELITY_SCHEMA,
  fidelitySystemPrompt,
  fidelityUserMessage,
  GLOSSARY_SCHEMA,
  glossaryPrompt,
  postEditSystemPrompt,
  postEditUserMessage,
  TRANSLATION_SCHEMA,
  translationSystemPrompt,
  translationUserMessage,
  unescapeXml,
} from './prompt';
import { DEFAULT_ANTHROPIC_MODEL } from './anthropicModels';
import { EngineError, type FidelityFinding, type TranslationEngine } from './types';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

type Effort = 'low' | 'medium' | 'high';

function mapError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError)
    return new DOMException('Aborted', 'AbortError');
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new EngineError(
      'auth',
      'The Anthropic API key was rejected. Check the key and its permissions.',
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new EngineError(
      'rate-limit',
      'Anthropic rate limit reached. Wait a moment and try again.',
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new EngineError('network', 'Could not reach api.anthropic.com. Check your connection.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new EngineError('bad-request', `Anthropic rejected the request: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new EngineError('server', `Anthropic API error ${error.status ?? ''}`.trim());
  }
  return error;
}

export function createAnthropicEngine(config: {
  apiKey: string;
  model?: string;
}): TranslationEngine {
  const model = config.model ?? DEFAULT_ANTHROPIC_MODEL;
  // The key is the user's own and is only ever sent to api.anthropic.com (SECURITY.md §4).
  const client = new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 4,
  });

  async function callJson<T>(
    system: string,
    user: string,
    schema: Record<string, unknown>,
    effort: Effort,
    signal: AbortSignal,
  ): Promise<T> {
    let response;
    try {
      response = await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
          output_config: { effort, format: { type: 'json_schema', schema } },
          ...(FALLBACK_MODELS.has(model)
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        },
        { signal },
      );
    } catch (error) {
      throw mapError(error);
    }
    if (response.stop_reason === 'refusal') {
      throw new EngineError('refusal', 'The model declined to translate this content.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new EngineError('truncated', 'The response hit the output limit.');
    }
    const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new EngineError('bad-response', 'The model returned malformed JSON.');
    }
  }

  return {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    runsOn: 'worker',
    privacy: 'third-party-api',
    capabilities: {
      glossary: true,
      lengthBudget: true,
      tagsReliable: true,
      condense: true,
      vision: true,
      fidelityCheck: true,
    },
    model,
    maxBatchChars: 6000,
    isAvailable: () => Promise.resolve(config.apiKey ? 'available' : 'unavailable'),

    async translate(batch, ctx, signal) {
      const out = await callJson<{ segments: { id: string; text: string; over: boolean }[] }>(
        translationSystemPrompt(ctx),
        translationUserMessage(batch, ctx),
        TRANSLATION_SCHEMA,
        'medium',
        signal,
      );
      return out.segments.map((s) => ({ id: s.id, text: unescapeXml(s.text), overBudget: s.over }));
    },

    async condense(req, signal) {
      const out = await callJson<{ text: string }>(
        translationSystemPrompt(req.ctx),
        condensePrompt(req),
        CONDENSE_SCHEMA,
        'low',
        signal,
      );
      return unescapeXml(out.text);
    },

    async checkFidelity(pairs, ctx, signal) {
      const out = await callJson<{ findings: FidelityFinding[] }>(
        fidelitySystemPrompt(ctx),
        fidelityUserMessage(pairs),
        FIDELITY_SCHEMA,
        'medium',
        signal,
      );
      const ids = new Set(pairs.map((p) => p.id));
      return { findings: out.findings.filter((f) => ids.has(f.id)) };
    },

    async postEdit(items, ctx, signal) {
      const out = await callJson<{ segments: { id: string; text: string; over: boolean }[] }>(
        postEditSystemPrompt(ctx),
        postEditUserMessage(items),
        TRANSLATION_SCHEMA,
        'medium',
        signal,
      );
      const ids = new Set(items.map((i) => i.id));
      return out.segments
        .filter((s) => ids.has(s.id))
        .map((s) => ({ id: s.id, text: unescapeXml(s.text) }));
    },

    async extractGlossary(sample, ctx, signal) {
      const out = await callJson<{ terms: { source: string; target: string; note: string }[] }>(
        'You build bilingual terminology glossaries for academic translation.',
        glossaryPrompt(sample, ctx),
        GLOSSARY_SCHEMA,
        'low',
        signal,
      );
      return out.terms
        .filter((t) => t.source.trim() && t.target.trim())
        .map((t): GlossaryEntry =>
          t.note.trim() ? { ...t, note: t.note.trim() } : { source: t.source, target: t.target },
        );
    },
  };
}
