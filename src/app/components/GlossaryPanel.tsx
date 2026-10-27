import { useRef, useState } from 'react';
import type { TermSuggestion } from '../../core/glossary/detect';
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
  /** Terms found in the document, offered for the glossary. */
  suggestions?: TermSuggestion[];
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const suggestions = props.suggestions ?? [];
  /** Suggestions the user unticked. */
  const [declined, setDeclined] = useState<ReadonlySet<string>>(new Set());
  const chosen = suggestions.filter((s) => !declined.has(s.source));
  const update = (i: number, patch: Partial<GlossaryEntry>) =>
    props.onChange(props.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer font-medium">
        {t('glossary.title')} · {t('glossary.count', { count: props.entries.length })}
        {suggestions.length > 0 && (
          <span className="font-normal text-violet-800" data-testid="term-suggestion-count">
            {' '}
            · {t('glossary.suggestionCount', { count: suggestions.length })}
          </span>
        )}
      </summary>
      <p className="mt-2 text-sm text-slate-600">{t('glossary.hint')}</p>
      {suggestions.length > 0 && (
        <section
          className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm"
          data-testid="term-suggestions"
        >
          <p className="font-medium text-violet-950">{t('glossary.suggested')}</p>
          <p className="mt-1 text-xs text-slate-700">{t('glossary.suggestedHint')}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {suggestions.map((s) => (
              <li key={s.source}>
                <label className="flex flex-wrap items-baseline gap-x-2">
                  <input
                    type="checkbox"
                    checked={!declined.has(s.source)}
                    onChange={(e) =>
                      setDeclined((d) => {
                        const next = new Set(d);
                        if (e.target.checked) next.delete(s.source);
                        else next.add(s.source);
                        return next;
                      })
                    }
                  />
                  <span className="font-medium">{s.source}</span>
                  <span aria-hidden="true">→</span>
                  <span>{s.target === s.source ? t('glossary.keep') : s.target}</span>
                  <span className="rounded bg-white px-1.5 text-xs text-violet-900">
                    {t(`glossary.reason.${s.reason}`)}
                  </span>
                  <span className="text-xs text-slate-500">×{s.count}</span>
                </label>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() =>
              props.onChange(
                mergeGlossaries(
                  chosen.map(({ source, target }) => ({ source, target })),
                  props.entries,
                ),
              )
            }
            className="mt-2 rounded bg-violet-700 px-3 py-1.5 text-white hover:bg-violet-800 disabled:opacity-50"
            data-testid="add-term-suggestions"
          >
            {t('glossary.addSelected', { count: chosen.length })}
          </button>
        </section>
      )}
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
