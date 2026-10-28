import { useState } from 'react';
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ProjectKind,
  type ProjectManifest,
  type ProjectOptions,
  type StoredOutcome,
} from '../core/project';
import type { GlossaryEntry } from '../core/validate/validate';
import type { LangPair } from '../engines/types';
import type { EngineSpec } from '../workers/api';
import { downloadBlob } from './download';
import { pipelineClient } from './pipelineClient';

/** What the translations shown came from (saved with the project). */
interface Origin {
  engine: ProjectManifest['engine'];
  options: ProjectOptions;
  pair: LangPair;
}

/**
 * Project files (P9.5) for a translator: a reopened project's translations are shown without
 * translating again, rebuilds after corrections reuse the translations shown (no engine call),
 * and the current state saves as a `.samepage` file.
 */
export function useProject(project: ProjectManifest | undefined, file: File, kind: ProjectKind) {
  const [translations, setTranslations] = useState<Record<string, StoredOutcome> | null>(
    project?.translations ?? null,
  );
  const [origin, setOrigin] = useState<Origin | null>(
    project ? { engine: project.engine, options: project.options, pair: project.pair } : null,
  );
  return {
    /** Translations a run reuses: not for a fresh translation, nor for another language pair. */
    reuse(fresh: boolean, pair: LangPair): Record<string, StoredOutcome> | null {
      if (fresh || !translations || !origin) return null;
      return origin.pair.source === pair.source && origin.pair.target === pair.target
        ? translations
        : null;
    },
    /** The options a run uses: those of the translations it reuses, or the current ones. */
    options(reused: boolean, current: ProjectOptions): ProjectOptions {
      return reused && origin ? origin.options : current;
    },
    /** Records a finished run. API keys are never kept: only the engine id and model. */
    finished(
      result: Record<string, StoredOutcome>,
      reused: boolean,
      spec: EngineSpec,
      options: ProjectOptions,
      pair: LangPair,
    ) {
      setTranslations(result);
      if (!reused)
        setOrigin({
          engine: { id: spec.id, ...(spec.model ? { model: spec.model } : {}) },
          options,
          pair,
        });
    },
    canSave: origin !== null && translations !== null,
    async save(glossary: GlossaryEntry[], edits: Record<string, string>): Promise<void> {
      if (!origin || !translations) return;
      const manifest: ProjectManifest = {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        file: { name: file.name, kind },
        pair: origin.pair,
        engine: origin.engine,
        options: origin.options,
        glossary,
        edits,
        translations,
      };
      const bytes = await pipelineClient.call<Uint8Array>(
        (api) => api.writeProject(manifest, file),
        120_000,
      );
      const base = file.name.replace(/\.(pdf|docx|pptx)$/i, '');
      downloadBlob(new Blob([bytes.slice()], { type: 'application/zip' }), `${base}.samepage`);
    },
    /** The reopened project's glossary terms the user's glossary lacks. */
    missingTerms(entries: GlossaryEntry[]): GlossaryEntry[] {
      if (!project) return [];
      return project.glossary.filter(
        (g) => !entries.some((e) => e.source.toLowerCase() === g.source.toLowerCase()),
      );
    },
  };
}
