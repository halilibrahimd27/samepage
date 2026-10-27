import { useEffect, useState } from 'react';
import type { HistoryMeta } from '../../core/cache/idb';
import { languageName } from '../../core/languages';
import { downloadBlob } from '../download';
import { formatBytes } from '../format';
import { useI18n } from '../i18n';
import { pipelineClient } from '../pipelineClient';

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const;

export function History() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<HistoryMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    pipelineClient
      .call((api) => api.listHistory())
      .then(
        (list) => active && setItems(list),
        () => active && setFailed(true),
      );
    return () => {
      active = false;
    };
  }, [version]);

  const refresh = () => setVersion((v) => v + 1);
  const date = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });

  async function download(item: HistoryMeta, what: 'file' | 'report') {
    const entry = await pipelineClient.call((api) => api.getHistoryEntry(item.id));
    if (!entry) return refresh();
    if (what === 'file')
      downloadBlob(new Blob([entry.bytes.slice()], { type: MIME[item.kind] }), item.outputName);
    else
      downloadBlob(
        new Blob([JSON.stringify(entry.report, null, 2)], { type: 'application/json' }),
        item.outputName.replace(/\.(docx|pdf)$/i, '.report.json'),
      );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <a href="#" className="text-sm text-blue-700 underline">
          {t('history.back')}
        </a>
        <h2 className="mt-2 text-2xl font-semibold">{t('history.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('history.hint')}</p>
      </div>

      {failed && (
        <p role="alert" className="text-red-800">
          {t('history.failed')}
        </p>
      )}
      {items?.length === 0 && <p className="text-slate-600">{t('history.empty')}</p>}

      <ul className="flex flex-col gap-3" data-testid="history-list">
        {items?.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{item.name}</p>
              <p className="text-sm text-slate-600">
                {date.format(item.createdAt)} · {languageName(item.pair.source, lang)} →{' '}
                {languageName(item.pair.target, lang)} ·{' '}
                {t(`engine.${item.engine as 'pseudo'}.label`)} · {formatBytes(item.sizeBytes, lang)}
              </p>
              <p className="text-xs text-slate-500">{t('history.summary', item.summary)}</p>
            </div>
            <div className="flex shrink-0 gap-2 text-sm">
              <button
                type="button"
                className="rounded bg-emerald-700 px-3 py-1.5 text-white"
                onClick={() => void download(item, 'file')}
              >
                {t('history.download')}
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1.5"
                onClick={() => void download(item, 'report')}
              >
                {t('history.report')}
              </button>
              <button
                type="button"
                className="rounded border border-red-300 px-3 py-1.5 text-red-800"
                onClick={() =>
                  void pipelineClient.call((api) => api.deleteHistory(item.id)).then(refresh)
                }
              >
                {t('history.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {items && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {confirming ? (
            <>
              <span>{t('history.confirmClear', { count: items.length })}</span>
              <button
                type="button"
                className="rounded bg-red-700 px-3 py-1.5 text-white"
                onClick={() =>
                  void pipelineClient
                    .call((api) => api.deleteHistory(null))
                    .then(() => {
                      setConfirming(false);
                      refresh();
                    })
                }
              >
                {t('history.confirm')}
              </button>
              <button type="button" className="underline" onClick={() => setConfirming(false)}>
                {t('history.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded border border-red-300 px-3 py-1.5 text-red-800"
              onClick={() => setConfirming(true)}
            >
              {t('history.clear')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
