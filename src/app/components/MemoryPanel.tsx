import { useCallback, useEffect, useRef, useState } from 'react';
import { languageName } from '../../core/languages';
import { pairKey, type MemoryStats } from '../../core/memory/memory';
import { TMX_LIMITS } from '../../security/limits';
import type { MemoryImport } from '../../workers/api';
import { downloadBlob } from '../download';
import { useI18n } from '../i18n';
import { pipelineClient } from '../pipelineClient';

const button = 'rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-50';

/**
 * The translation memory in the settings: what it holds, its TMX export (every pair or one) and
 * import, and clearing it after a confirmation.
 */
export function MemoryPanel({ open }: { open: boolean }) {
  const { t, lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  /** The pair to export ("tr>en"); '' for all. */
  const [pair, setPair] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(() => {
    void pipelineClient
      .call<MemoryStats>((api) => api.memoryStats())
      .then(setStats, () => setStats(null));
  }, []);
  // Counted again each time the settings open: a translation may have added to it.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const entries = stats?.entries ?? 0;
  const chosen = stats?.pairs.find((p) => pairKey(p.pair) === pair)?.pair;
  const pairName = (p: { source: string; target: string }) =>
    `${languageName(p.source, lang)} → ${languageName(p.target, lang)}`;

  function exportTmx() {
    void pipelineClient
      .call<string>((api) => api.exportMemory(chosen), 60_000)
      .then((tmx) =>
        downloadBlob(
          new Blob([tmx], { type: 'application/x-tmx+xml' }),
          chosen
            ? `translation-memory.${chosen.source}-${chosen.target}.tmx`
            : 'translation-memory.tmx',
        ),
      );
  }

  function importTmx(file: File) {
    setMessage(null);
    void pipelineClient
      .call<MemoryImport>((api) => api.importMemory(file), 120_000)
      .then(
        (r) => {
          setMessage(
            r.ok
              ? [
                  t('memory.imported', { added: r.added }),
                  r.older ? t('memory.older', { count: r.older }) : '',
                  r.skipped ? t('memory.skipped', { count: r.skipped }) : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              : r.reason === 'too-large'
                ? t('memory.tooLarge', { mb: TMX_LIMITS.maxBytes / 1024 / 1024 })
                : t('memory.unreadable'),
          );
          refresh();
        },
        () => setMessage(t('memory.unreadable')),
      );
  }

  function clear() {
    void pipelineClient
      .call((api) => api.clearMemory())
      .then(() => {
        setConfirming(false);
        setPair('');
        setMessage(t('memory.cleared'));
        refresh();
      });
  }

  return (
    <section
      className="mt-8 flex flex-col items-start gap-3 border-t border-slate-200 pt-6 text-sm"
      aria-labelledby="memory-title"
      data-testid="memory"
    >
      <h3 id="memory-title" className="text-base font-medium">
        {t('memory.title')}
      </h3>
      <p className="text-slate-600">{t('memory.hint')}</p>
      <p data-testid="memory-count">
        {t('memory.count', {
          entries,
          manual: stats?.manual ?? 0,
          imported: stats?.imported ?? 0,
        })}
      </p>
      {(stats?.pairs.length ?? 0) > 1 && (
        <label className="flex flex-col gap-1">
          <span>{t('memory.pair')}</span>
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1"
            data-testid="memory-pair"
          >
            <option value="">{t('memory.allPairs')}</option>
            {stats!.pairs.map((p) => (
              <option key={pairKey(p.pair)} value={pairKey(p.pair)}>
                {pairName(p.pair)} ({p.entries})
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={entries === 0}
          onClick={exportTmx}
          data-testid="memory-export"
        >
          {t('memory.export')}
        </button>
        <button type="button" className={button} onClick={() => fileRef.current?.click()}>
          {t('memory.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".tmx,.xml,application/x-tmx+xml"
          aria-label={t('memory.import')}
          // The button above opens it: one stop for the keyboard.
          tabIndex={-1}
          className="sr-only"
          data-testid="memory-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) importTmx(file);
          }}
        />
      </div>
      {confirming ? (
        <div
          role="group"
          aria-labelledby="memory-confirm"
          className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3"
        >
          <p id="memory-confirm" className="text-red-900">
            {t('memory.clearConfirm', { entries })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-red-700 px-3 py-1.5 text-white hover:bg-red-800"
              onClick={clear}
              data-testid="memory-clear-confirm"
            >
              {t('memory.clearYes')}
            </button>
            <button type="button" className={button} onClick={() => setConfirming(false)}>
              {t('memory.clearNo')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={button}
          disabled={entries === 0}
          onClick={() => {
            setMessage(null);
            setConfirming(true);
          }}
        >
          {t('memory.clear')}
        </button>
      )}
      {message && (
        <p role="status" className="text-slate-700" data-testid="memory-status">
          {message}
        </p>
      )}
    </section>
  );
}
