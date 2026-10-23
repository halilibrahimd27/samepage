import { useState } from 'react';
import type { PdfReport } from '../../pdf/pipeline';
import { useI18n } from '../i18n';
import { SegmentEditor } from './SegmentEditor';

const STATUS_BADGE = {
  green: 'bg-emerald-100 text-emerald-900',
  yellow: 'bg-amber-100 text-amber-900',
  red: 'bg-red-100 text-red-900',
} as const;

const STATUS_STYLE = {
  translated: 'bg-emerald-100 text-emerald-900',
  warning: 'bg-amber-100 text-amber-900',
  untranslated: 'bg-red-100 text-red-900',
  'kept-original': 'bg-red-100 text-red-900',
} as const;

export function PdfReportPanel({
  report,
  edits,
  onEdit,
}: {
  report: PdfReport;
  edits: Record<string, string>;
  onEdit: (sourceTagged: string, targetTagged: string) => void;
}) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const attention = report.units.filter(
    (u) =>
      u.manual ||
      u.sourceTagged in edits ||
      u.status !== 'translated' ||
      u.scale < 1 ||
      u.layoutIssues.length > 0 ||
      u.fallback,
  );
  const list = showAll ? report.units : attention;
  const { missingGlyphs, issues, repairs, score, status, overflowNotes, ...counts } =
    report.summary;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      data-testid="pdf-report"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">{t('report.title')}</h3>
        <span
          className={`rounded px-2 py-0.5 text-sm ${STATUS_BADGE[status]}`}
          data-testid="pdf-score"
        >
          {t('pdfReport.score', { score })} · {t(`pdfReport.status.${status}`)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {report.pages.map((p) => (
          <span key={p.index} className={`rounded px-1.5 py-0.5 ${STATUS_BADGE[p.status]}`}>
            {t('pdfReport.pageScore', { page: p.index + 1, score: p.score })}
          </span>
        ))}
      </div>
      <p className="text-sm" data-testid="pdf-report-summary">
        {t('pdfReport.summary', counts)}
      </p>
      {missingGlyphs.length > 0 && (
        <p className="text-sm text-red-800">MISSING_GLYPH: {missingGlyphs.join(' ')}</p>
      )}
      {overflowNotes > 0 && (
        <p className="text-sm">{t('pdfReport.overflowNotes', { count: overflowNotes })}</p>
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
                {(u.manual || u.sourceTagged in edits) && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-900">
                    {t('review.manual')}
                  </span>
                )}
                {u.fallback && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-900">
                    {t(`pdfReport.fallback.${u.fallback}`)}
                  </span>
                )}
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
              {editing === u.id ? (
                <SegmentEditor
                  tagged={edits[u.sourceTagged] ?? u.targetTagged}
                  source={u.sourceTagged}
                  onSave={(tagged) => {
                    onEdit(u.sourceTagged, tagged);
                    setEditing(null);
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  {u.target && <p className="mt-1">{u.target}</p>}
                  <button
                    type="button"
                    className="mt-1 text-xs text-blue-700 underline"
                    onClick={() => setEditing(u.id)}
                  >
                    {t('review.edit')}
                  </button>
                </>
              )}
              {(u.layoutIssues.length > 0 || u.repairs.length > 0) && (
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                  {u.layoutIssues.map((issue, i) => (
                    <li
                      key={`l${i}`}
                      className={
                        issue.severity === 'error'
                          ? 'text-red-800'
                          : issue.severity === 'warning'
                            ? 'text-amber-800'
                            : ''
                      }
                    >
                      <span className="font-mono">{issue.code}</span> — {issue.message}
                    </li>
                  ))}
                  {u.repairs.map((r, i) => (
                    <li key={`r${i}`}>
                      <span className="font-mono">{r.code}</span> — {r.note}
                    </li>
                  ))}
                </ul>
              )}
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
