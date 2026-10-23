import { useState } from 'react';
import type { DocxReport } from '../../docx/pipeline';
import { useI18n } from '../i18n';

const STATUS_STYLE = {
  translated: 'bg-emerald-100 text-emerald-900',
  warning: 'bg-amber-100 text-amber-900',
  untranslated: 'bg-red-100 text-red-900',
  skipped: 'bg-slate-100 text-slate-700',
} as const;

export function DocxReportPanel({ report }: { report: DocxReport }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const attention = report.segments.filter(
    (s) => s.status === 'warning' || s.status === 'untranslated',
  );
  const list = showAll ? report.segments : attention;
  const { repairs, ...counts } = report.summary;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      data-testid="report"
    >
      <h3 className="text-lg font-semibold">{t('report.title')}</h3>
      <p className="text-sm" data-testid="report-summary">
        {t('report.summary', counts)}
      </p>
      {report.repairs.length > 0 && (
        <div>
          <h4 className="text-sm font-medium">{t('report.repairs')}</h4>
          <ul className="mt-1 list-disc pl-5 text-sm" data-testid="repairs">
            {report.repairs.map((r, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{r.code}</span> — {t(`report.repair.${r.code}`)}{' '}
                ({r.part})
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-3 text-sm">
        <button
          type="button"
          className={showAll ? 'underline' : 'font-medium'}
          onClick={() => setShowAll(false)}
        >
          {t('report.attention')} ({attention.length})
        </button>
        <button
          type="button"
          className={showAll ? 'font-medium' : 'underline'}
          onClick={() => setShowAll(true)}
        >
          {t('report.allSegments')} ({report.segments.length})
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-slate-600">{t('report.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((s) => (
            <li key={s.id} className="rounded border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[s.status]}`}>
                  {t(`report.status.${s.status}`)}
                </span>
                <span className="text-slate-500">
                  {s.part} · {s.role}
                </span>
              </div>
              <p className="mt-1 text-slate-600">{s.source}</p>
              {s.target && <p className="mt-1">{s.target}</p>}
              {s.issues.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {s.issues.map((issue, i) => (
                    <li
                      key={i}
                      className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}
                    >
                      <span className="font-mono">{issue.code}</span> — {issue.detail}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
