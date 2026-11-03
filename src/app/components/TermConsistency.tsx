import { useState } from 'react';
import type { TermVariance } from '../../core/glossary/consistency';
import type { GlossaryEntry } from '../../core/validate/validate';
import { useI18n } from '../i18n';

type Choice = 'rendering' | 'instead' | 'keep';

/**
 * Terms the translation renders two ways, each confirmed by the engine: the user picks one, it
 * goes into the glossary, and the paragraphs with the term are translated again.
 */
export function TermConsistency({
  terms,
  example,
  busy,
  onUse,
}: {
  terms: TermVariance[];
  /** A paragraph's source and translation, by id. */
  example: (id: string) => { source: string; target: string } | undefined;
  busy: boolean;
  onUse: (entries: GlossaryEntry[]) => void;
}) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  // The form the glossary takes, as chosen or as the user writes it (an ending taken off).
  const [written, setWritten] = useState<Record<string, string>>({});
  const chosen = (v: TermVariance) => choice[v.term] ?? 'rendering';
  const form = (v: TermVariance) =>
    written[v.term] ?? (chosen(v) === 'instead' ? v.instead : v.rendering);
  const choose = (v: TermVariance, c: Choice) => {
    setChoice((all) => ({ ...all, [v.term]: c }));
    setWritten(({ [v.term]: _, ...rest }) => rest);
  };
  const entries = terms.flatMap((v) =>
    chosen(v) === 'keep' || !form(v).trim() ? [] : [{ source: v.term, target: form(v).trim() }],
  );

  return (
    <section
      className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"
      aria-labelledby="terms-title"
      data-testid="term-consistency"
    >
      <h3 id="terms-title" className="font-semibold text-slate-900">
        {t('terms.title', { count: terms.length })}
      </h3>
      <p className="mt-1 text-sm text-slate-700">{t('terms.hint')}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {terms.map((v) => {
          const first = example(v.differ[0]!);
          return (
            <li
              key={v.term}
              className="rounded-lg border border-amber-200 bg-white p-3"
              data-testid="term"
            >
              <fieldset>
                <legend className="font-medium text-slate-900">{v.term}</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {(
                    [
                      ['rendering', v.rendering, v.agree.length],
                      ['instead', v.instead, v.differ.length],
                    ] as const
                  ).map(([value, text, count]) => (
                    <label key={value} className="flex items-center gap-1.5">
                      <input
                        type="radio"
                        name={`term-${v.term}`}
                        checked={chosen(v) === value}
                        onChange={() => choose(v, value)}
                      />
                      <span>
                        <span className="font-medium">{text}</span>{' '}
                        <span className="text-slate-500">{t('terms.count', { count })}</span>
                      </span>
                    </label>
                  ))}
                  <label className="flex items-center gap-1.5 text-slate-600">
                    <input
                      type="radio"
                      name={`term-${v.term}`}
                      checked={chosen(v) === 'keep'}
                      onChange={() => choose(v, 'keep')}
                    />
                    {t('terms.keep')}
                  </label>
                </div>
                {chosen(v) !== 'keep' && (
                  <label className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {t('terms.form')}
                    <input
                      type="text"
                      value={form(v)}
                      onChange={(e) => setWritten((all) => ({ ...all, [v.term]: e.target.value }))}
                      className="rounded border border-slate-300 px-2 py-0.5 text-slate-900"
                      data-testid="term-form"
                    />
                  </label>
                )}
              </fieldset>
              {first && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-slate-600">{t('terms.example')}</summary>
                  <p className="mt-1 text-slate-700">{first.source}</p>
                  <p className="mt-1 text-slate-900">{first.target}</p>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={busy || !entries.length}
        onClick={() => onUse(entries)}
        className="mt-3 rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        data-testid="terms-apply"
      >
        {t('terms.apply', { count: entries.length })}
      </button>
    </section>
  );
}
