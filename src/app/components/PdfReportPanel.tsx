import { useState } from 'react';
import type { PdfReport } from '../../pdf/pipeline';
import { useI18n } from '../i18n';
import { urgency, type ShownIssue } from '../issues';
import { IssueList } from './IssueList';
import type { LangPair } from '../../engines/types';
import { BackTranslation } from './BackTranslation';
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
  pair,
}: {
  report: PdfReport;
  edits: Record<string, string>;
  onEdit: (sourceTagged: string, targetTagged: string) => void;
  pair: LangPair;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<'attention' | 'meaning' | 'all'>('attention');
  const [editing, setEditing] = useState<string | null>(null);
  const shown = (u: PdfReport['units'][number]): ShownIssue[] => [
    ...u.layoutIssues.map((i) => ({ code: i.code, severity: i.severity, detail: i.message })),
    ...u.issues,
  ];
  const attention = report.units
    .filter(
      (u) =>
        u.manual ||
        u.sourceTagged in edits ||
        u.status !== 'translated' ||
        // Slight reductions are summarised above, not listed per paragraph.
        u.scale < 0.75 ||
        u.repairs.some((r) => r.code === 'R4_BLOCK_SCALE') ||
        u.layoutIssues.length > 0 ||
        u.fallback,
    )
    .map((u, order) => ({ u, order, rank: urgency(shown(u)) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((x) => x.u);
  const meaning = report.units.filter((u) => u.issues.some((i) => i.code === 'MEANING_DRIFT'));
  const list = view === 'all' ? report.units : view === 'meaning' ? meaning : attention;
  const { missingGlyphs, issues, repairs, score, status, overflowNotes, ocr, ...counts } =
    report.summary;

  return (
    // Folded by default: the score and counts are in the summary line, details on demand.
    <details
      className="group rounded-xl border border-slate-200 bg-white p-4"
      data-testid="pdf-report"
    >
      <summary className="flex cursor-pointer list-none flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-90">
            ▸
          </span>
          <h3 className="text-lg font-semibold">{t('report.title')}</h3>
          <span
            className={`rounded px-2 py-0.5 text-sm ${STATUS_BADGE[status]}`}
            data-testid="pdf-score"
          >
            {t('pdfReport.score', { score })} · {t(`pdfReport.status.${status}`)}
          </span>
          {meaning.length > 0 && (
            <span className="rounded bg-violet-100 px-2 py-0.5 text-sm text-violet-900">
              {t('report.meaningFilter')}: {meaning.length}
            </span>
          )}
        </span>
        <span className="pl-5 text-sm text-slate-700" data-testid="pdf-report-summary">
          {t('pdfReport.summary', counts)}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-1 text-xs">
          {report.pages.map((p) => (
            <span key={p.index} className={`rounded px-1.5 py-0.5 ${STATUS_BADGE[p.status]}`}>
              {t('pdfReport.pageScore', { page: p.index + 1, score: p.score })}
            </span>
          ))}
        </div>
        {missingGlyphs.length > 0 && (
          <p className="text-sm text-red-800">MISSING_GLYPH: {missingGlyphs.join(' ')}</p>
        )}
        {report.sanitization.removed.length > 0 && (
          <p className="text-sm">
            {t('pdfReport.sanitized', { items: report.sanitization.removed.join('; ') })}
          </p>
        )}
        {ocr && (
          <p className="text-sm" data-testid="pdf-ocr">
            {t('pdfReport.ocr', { pages: ocr.pages, confidence: ocr.confidence })}
          </p>
        )}
        {overflowNotes > 0 && (
          <p className="text-sm">{t('pdfReport.overflowNotes', { count: overflowNotes })}</p>
        )}
        <div className="flex flex-wrap gap-2 text-sm" role="tablist">
          {(
            [
              ['attention', t('report.attention'), attention.length],
              ['meaning', t('report.meaningFilter'), meaning.length],
              ['all', t('report.allSegments'), report.units.length],
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
                    {t('pdfReport.pages', { pages: u.pages.map((p) => p + 1).join(', ') })} ·{' '}
                    {u.role}
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
                    {u.back && u.target && !(u.sourceTagged in edits) && (
                      <BackTranslation
                        source={u.source}
                        target={u.target}
                        back={u.back}
                        sourceLang={pair.source}
                        targetLang={pair.target}
                      />
                    )}
                    <button
                      type="button"
                      className="mt-1 text-xs text-blue-700 underline"
                      onClick={() => setEditing(u.id)}
                    >
                      {t('review.edit')}
                    </button>
                  </>
                )}
                <IssueList issues={shown(u)} />
                {u.repairs.length > 0 && (
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer">{t('report.technical')}</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {u.repairs.map((r, i) => (
                        <li key={`r${i}`}>
                          <span className="font-mono">{r.code}</span> — {r.note}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
