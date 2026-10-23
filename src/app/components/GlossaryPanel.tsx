import { useRef } from 'react';
import { glossaryToCsv, parseGlossaryCsv, mergeGlossaries } from '../../core/glossary/glossary';
import type { GlossaryEntry } from '../../core/validate/validate';
import { downloadBlob } from '../download';
import { useI18n } from '../i18n';

const cell = 'w-full rounded border border-slate-300 px-2 py-1 text-sm';

export function GlossaryPanel(props: {
  entries: GlossaryEntry[];
  onChange: (entries: GlossaryEntry[]) => void;
  onExtract?: () => void;
  extracting: boolean;
  fileName: string;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const update = (i: number, patch: Partial<GlossaryEntry>) =>
    props.onChange(props.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">
        {t('glossary.title')} · {t('glossary.count', { count: props.entries.length })}
      </summary>
      <p className="mt-2 text-sm text-slate-600">{t('glossary.hint')}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {props.onExtract && (
          <button
            type="button"
            disabled={props.extracting}
            onClick={props.onExtract}
            className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-50"
          >
            {props.extracting ? t('glossary.extracting') : t('glossary.extract')}
          </button>
        )}
        <button
          type="button"
          onClick={() => props.onChange([...props.entries, { source: '', target: '' }])}
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          {t('glossary.add')}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100"
        >
          {t('glossary.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file)
              void file
                .text()
                .then((csv) =>
                  props.onChange(mergeGlossaries(props.entries, parseGlossaryCsv(csv))),
                );
          }}
        />
        <button
          type="button"
          disabled={props.entries.length === 0}
          onClick={() =>
            downloadBlob(
              new Blob([glossaryToCsv(props.entries)], { type: 'text/csv' }),
              props.fileName,
            )
          }
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-50"
        >
          {t('glossary.export')}
        </button>
        <button
          type="button"
          disabled={props.entries.length === 0}
          onClick={() => props.onChange([])}
          className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100 disabled:opacity-50"
        >
          {t('glossary.clear')}
        </button>
      </div>
      {props.entries.length > 0 && (
        <table className="mt-3 w-full border-separate border-spacing-1">
          <thead>
            <tr className="text-left text-xs text-slate-600">
              <th>{t('glossary.source')}</th>
              <th>{t('glossary.target')}</th>
              <th>{t('glossary.note')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {props.entries.map((e, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={t('glossary.source')}
                    className={cell}
                    value={e.source}
                    onChange={(ev) => update(i, { source: ev.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={t('glossary.target')}
                    className={cell}
                    value={e.target}
                    onChange={(ev) => update(i, { target: ev.target.value })}
                  />
                </td>
                <td>
                  <input
                    aria-label={t('glossary.note')}
                    className={cell}
                    value={e.note ?? ''}
                    onChange={(ev) => update(i, { note: ev.target.value })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="text-sm text-red-700 underline"
                    onClick={() => props.onChange(props.entries.filter((_, j) => j !== i))}
                  >
                    {t('glossary.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
