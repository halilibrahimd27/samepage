import { useCallback, useEffect, useState } from 'react';
import type { TermSuggestion } from '../core/glossary/detect';
import type { GlossaryEntry } from '../core/validate/validate';
import type { LangPair } from '../engines/types';
import { pipelineClient } from './pipelineClient';

/** Glossary for a language pair, persisted in IndexedDB through the worker. */
export function useGlossary(pair: LangPair) {
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const { source, target } = pair;

  useEffect(() => {
    let active = true;
    void pipelineClient
      .call((api) => api.loadGlossary({ source, target }))
      .then((loaded) => active && setEntries(loaded));
    return () => {
      active = false;
    };
  }, [source, target]);

  const update = useCallback(
    (next: GlossaryEntry[]) => {
      setEntries(next);
      void pipelineClient.call((api) => api.saveGlossary({ source, target }, next));
    },
    [source, target],
  );

  const usable = entries.filter((g) => g.source.trim() && g.target.trim());
  return { entries, usable, update };
}

/**
 * Glossary suggestions found in the document (code-font words, tool names, field terms) for
 * this language pair, minus the terms already in the glossary.
 */
export function useTermSuggestions(
  file: File,
  kind: 'pdf' | 'docx',
  pair: LangPair,
  entries: GlossaryEntry[],
): TermSuggestion[] {
  const { source, target } = pair;
  const key = `${source}>${target}`;
  const [found, setFound] = useState<{ key: string; list: TermSuggestion[] } | null>(null);

  useEffect(() => {
    let active = true;
    void pipelineClient
      .call((api) => api.suggestTerms(file, kind, { source, target }, []), 120_000)
      .catch(() => [])
      .then((list) => active && setFound({ key: `${source}>${target}`, list }));
    return () => {
      active = false;
    };
  }, [file, kind, source, target]);

  if (found?.key !== key) return [];
  const have = new Set(entries.map((e) => e.source.trim().toLocaleLowerCase(source)));
  return found.list.filter((s) => !have.has(s.source.toLocaleLowerCase(source)));
}
