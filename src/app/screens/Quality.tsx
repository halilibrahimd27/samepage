import { languageName } from '../../core/languages';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import corpus from '../quality/corpus.json';

interface Paper {
  source: string;
  target: string;
  field: string;
  pages: number;
  units: number;
  score: number;
  keptOriginal: number;
  untranslated: number;
}

const papers = corpus.papers as Paper[];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

function groups(key: (p: Paper) => string) {
  const by = new Map<string, Paper[]>();
  for (const p of papers) by.set(key(p), [...(by.get(key(p)) ?? []), p]);
  return [...by]
    .map(([k, list]) => ({
      key: k,
      papers: list.length,
      pages: list.reduce((n, p) => n + p.pages, 0),
      mean: mean(list.map((p) => p.score)),
      min: Math.min(...list.map((p) => p.score)),
    }))
    .sort((a, b) => b.papers - a.papers || a.key.localeCompare(b.key));
}

/** Public quality page (P9.10): layout scores of the real-paper corpus by language and field. */
export function Quality() {
  const { t, lang } = useI18n();
  const fmt = (n: number) =>
    new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
  const languages = groups((p) => p.source);
  const fields = groups((p) => p.field);
  const table = (rows: ReturnType<typeof groups>, label: (k: string) => string, head: string) => (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-slate-300 text-left">
          <th scope="col" className="py-1.5 pr-3 font-medium">
            {head}
          </th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">
            {t('quality.papers')}
          </th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">
            {t('quality.pages')}
          </th>
          <th scope="col" className="py-1.5 pr-3 text-right font-medium">
            {t('quality.mean')}
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            {t('quality.lowest')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-slate-100">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal">
              {label(r.key)}
            </th>
            <td className="py-1.5 pr-3 text-right tabular-nums">{r.papers}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{r.pages}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.mean)}</td>
            <td className="py-1.5 text-right tabular-nums">{fmt(r.min)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <section className="flex flex-col gap-5" data-testid="quality">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{t('quality.title')}</h2>
        <p data-testid="quality-summary">
          {t('quality.summary', {
            papers: papers.length,
            languages: languages.length,
            pages: papers.reduce((n, p) => n + p.pages, 0),
            mean: fmt(mean(papers.map((p) => p.score))),
            high: papers.filter((p) => p.score >= 99).length,
          })}
        </p>
        <p className="text-sm text-slate-600">
          {t('quality.method', { engine: corpus.engine, date: corpus.run })}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        {table(languages, (k) => languageName(k, lang), t('quality.language'))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
        {table(fields, (k) => t(`quality.field.${k}` as MessageKey), t('quality.field'))}
      </div>
      <p className="text-sm text-slate-600">{t('quality.honest')}</p>
      <a href="#" className="self-start text-sm text-blue-700 underline">
        {t('quality.back')}
      </a>
    </section>
  );
}
