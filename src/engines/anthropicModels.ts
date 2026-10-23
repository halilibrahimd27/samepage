export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', tier: 'quality' },
  { id: 'claude-sonnet-5-5', tier: 'balanced' },
  { id: 'claude-haiku-5-5', tier: 'economy' },
] as const;
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
