import { useState } from 'react';
import type { DocxReport } from '../../docx/pipeline';
import { urgency } from '../issues';
import { IssueList } from './IssueList';
import { SegmentEditor } from './SegmentEditor';
import { useI18n } from '../i18n';

const STATUS_STYLE = {
  translated: 'bg-emerald-100 text-emerald-900',
  warning: 'bg-amber-100 text-amber-900',
  untranslated: 'bg-red-100 text-red-900',
  skipped: 'bg-slate-100 text-slate-700',
} as const;

export function DocxReportPanel({
  report,
  edits,
  onEdit,
}: {
  report: DocxReport;
  edits: Record<string, string>;
  onEdit: (sourceTagged: string, targetTagged: string) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<'attention' | 'meaning' | 'all'>('attention');
  const [editing, setEditing] = useState<string | null>(null);
  const attention = report.segments
    .filter(
      (s) =>
        s.status === 'warning' ||
        s.status === 'untranslated' ||
        s.manual ||
        s.sourceTagged in edits,
    )
    .map((seg, order) => ({ seg, order, rank: urgency(seg.issues) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((x) => x.seg);
  const meaning = report.segments.filter((s) => s.issues.some((i) => i.code === 'MEANING_DRIFT'));
  const list = view === 'all' ? report.segments : view === 'meaning' ? meaning : attention;
  const { repairs, ...counts } = report.summary;

  return (
    // Folded by default: the counts are in the summary line, details on demand.
    <details className="group rounded-xl border border-slate-200 bg-white p-4" data-testid="report">
      <summary className="flex cursor-pointer list-none flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-90">
            ▸
          </span>
          <h3 className="text-lg font-semibold">{t('report.title')}</h3>
          {meaning.length > 0 && (
            <span className="rounded bg-violet-100 px-2 py-0.5 text-sm text-violet-900">
              {t('report.meaningFilter')}: {meaning.length}
            </span>
          )}
        </span>
        <span className="pl-5 text-sm text-slate-700" data-testid="report-summary">
          {t('report.summary', counts)}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        {report.repairs.length > 0 && (
          <div>
            <h4 className="text-sm font-medium">{t('report.repairs')}</h4>
            <ul className="mt-1 list-disc pl-5 text-sm" data-testid="repairs">
              {report.repairs.map((r, i) => (
                <li key={i}>
                  <span className="font-mono text-xs">{r.code}</span> —{' '}
                  {t(`report.repair.${r.code}`)} ({r.part})
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2 text-sm" role="tablist">
          {(
            [
              ['attention', t('report.attention'), attention.length],
              ['meaning', t('report.meaningFilter'), meaning.length],
              ['all', t('report.allSegments'), report.segments.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              className={`rounded-full border px-3 py-1 ${
                view === key
                  ? 'border-blue-700 bg-blue-700 text-white'
                  : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
              }`}
              onClick={() => setView(key)}
            >
              {label} ({count})
            </button>
          ))}
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
                  {(s.manual || s.sourceTagged in edits) && (
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-violet-900">
                      {t('review.manual')}
                    </span>
                  )}
                  <span className="text-slate-500">
                    {s.part} · {s.role}
                  </span>
                </div>
                <p className="mt-1 text-slate-600">{s.source}</p>
                {editing === s.id ? (
                  <SegmentEditor
                    tagged={edits[s.sourceTagged] ?? s.targetTagged}
                    source={s.sourceTagged}
                    onSave={(tagged) => {
                      onEdit(s.sourceTagged, tagged);
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <>
                    {s.target && <p className="mt-1">{s.target}</p>}
                    {s.status !== 'skipped' && (
                      <button
                        type="button"
                        className="mt-1 text-xs text-blue-700 underline"
                        onClick={() => setEditing(s.id)}
                      >
                        {t('review.edit')}
                      </button>
                    )}
                  </>
                )}
                <IssueList issues={s.issues} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
