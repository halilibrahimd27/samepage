import type { EngineId } from './catalog';
import type { TranslationEngine } from './types';

/** Creates an engine from its id and per-run configuration (key, model, base URL…). */
export type EngineFactory = (config: EngineConfig) => TranslationEngine;

export interface EngineConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  pseudo?: { factor: number; substitute: boolean };
}

const factories = new Map<EngineId, EngineFactory>();

export function registerEngine(id: EngineId, factory: EngineFactory): void {
  factories.set(id, factory);
}

export function createEngine(id: EngineId, config: EngineConfig): TranslationEngine {
  const factory = factories.get(id);
  if (!factory) throw new Error(`Engine "${id}" is not registered`);
  return factory(config);
}

export function registeredEngines(): EngineId[] {
  return [...factories.keys()].sort();
}
