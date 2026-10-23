import { useCallback, useEffect, useState } from 'react';
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
