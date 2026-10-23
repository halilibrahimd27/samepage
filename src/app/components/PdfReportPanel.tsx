import { useState } from 'react';
import type { PdfReport } from '../../pdf/pipeline';
import { useI18n } from '../i18n';

const STATUS_STYLE = {
  translated: 'bg-emerald-100 text-emerald-900',
  warning: 'bg-amber-100 text-amber-900',
  untranslated: 'bg-red-100 text-red-900',
  'kept-original': 'bg-red-100 text-red-900',
} as const;

export function PdfReportPanel({ report }: { report: PdfReport }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const attention = report.units.filter((u) => u.status !== 'translated' || u.scale < 1);
  const list = showAll ? report.units : attention;
  const { missingGlyphs, ...counts } = report.summary;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      data-testid="pdf-report"
    >
      <h3 className="text-lg font-semibold">{t('report.title')}</h3>
      <p className="text-sm" data-testid="pdf-report-summary">
        {t('pdfReport.summary', counts)}
      </p>
      {missingGlyphs.length > 0 && (
        <p className="text-sm text-red-800">MISSING_GLYPH: {missingGlyphs.join(' ')}</p>
      )}
      <p className="text-xs text-slate-500">{t('pdf.note')}</p>
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
          {t('report.allSegments')} ({report.units.length})
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-slate-600">{t('report.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((u) => (
            <li key={u.id} className="rounded border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[u.status]}`}>
                  {t(`pdfReport.status.${u.status}`)}
                </span>
                {u.scale < 1 && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">
                    {t('pdfReport.scale', { percent: Math.round(u.scale * 100) })}
                  </span>
                )}
                <span className="text-slate-500">
                  {t('pdfReport.pages', { pages: u.pages.map((p) => p + 1).join(', ') })} · {u.role}
                </span>
              </div>
              <p className="mt-1 text-slate-600">{u.source}</p>
              {u.target && <p className="mt-1">{u.target}</p>}
              {u.issues.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {u.issues.map((issue, i) => (
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
