import { proxy } from 'comlink';
import { useState } from 'react';
import type { ProgressPhase } from '../../core/pipeline/translate';
import type { JobError, PdfJob, PdfJobResult } from '../../workers/api';
import { sheetStore } from '../bridges/browserTranslator';
import { engineBridge, runErrorText } from '../engineBridge';
import { downloadBlob } from '../download';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { ProgressBar } from './ProgressBar';
import { TranslationSheet } from './TranslationSheet';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { useGlossary, useTermSuggestions } from '../useGlossary';
import { GlossaryPanel } from './GlossaryPanel';
import { PdfPreview } from './PdfPreview';
import { AiStatement } from './AiStatement';
import { PdfReportPanel } from './PdfReportPanel';

const LONG_JOB_MS = 2 * 60 * 60_000;

export function PdfTranslator(props: {
  file: File;
  pageCount: number;
  config: EngineConfig;
  settings: Settings;
}) {
  const { file, config, settings } = props;
  const { t } = useI18n();
  const pair = { source: config.source, target: config.target };
  const glossary = useGlossary(pair);
  const suggestions = useTermSuggestions(file, 'pdf', pair, glossary.entries);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    phase?: ProgressPhase | undefined;
  } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [result, setResult] = useState<(PdfJobResult & { ok: true }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(props.pageCount);
  /** Review-step corrections (tagged source → tagged target), applied on rebuild. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const base = file.name.replace(/\.pdf$/i, '');
  const problem = config.problem(t);
  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;

  async function run() {
    if (problem) return setError(problem);
    setError(null);
    setResult(null);
    const jobId = crypto.randomUUID();
    setRunning(jobId);
    setProgress(null);
    try {
      const bridge = await engineBridge(config.engine, pair, setDownload);
      const job: PdfJob = {
        jobId,
        file,
        engine: config.spec(),
        pair,
        glossary: glossary.usable,
        numberLocalization: false,
        fidelityCheck: settings.fidelityCheck,
        localCitations: settings.localCitations,
        translateReferences: settings.translateReferences,
        dual: true,
        translateMetadata: settings.translateMetadata,
        ...(from > 1 || to < props.pageCount
          ? { pageRange: { from: Math.max(0, from - 1), to: Math.min(props.pageCount, to) - 1 } }
          : {}),
        ...(Object.keys(edits).length ? { overrides: edits } : {}),
      };
      const res = await pipelineClient.call<PdfJobResult>(
        (api) =>
          api.translatePdf(
            job,
            proxy((done: number, total: number, phase?: ProgressPhase) =>
              setProgress({ done, total, phase }),
            ),
            bridge,
          ),
        LONG_JOB_MS,
      );
      if (res.ok) {
        setResult(res);
        setApplied(edits);
      } else setError(jobErrorText(res));
    } catch (e) {
      setError(runErrorText(e, t));
    } finally {
      setRunning(null);
      setDownload(null);
    }
  }

  const mono = result ? new Blob([result.mono.slice()], { type: 'application/pdf' }) : null;
  const dual = result?.dual ? new Blob([result.dual.slice()], { type: 'application/pdf' }) : null;

  return (
    <div className="flex flex-col gap-6">
      <GlossaryPanel
        entries={glossary.entries}
        onChange={glossary.update}
        extracting={false}
        fileName={`glossary.${config.source}-${config.target}.csv`}
        suggestions={suggestions}
      />
      {props.pageCount > 1 && (
        <fieldset className="flex flex-wrap items-center gap-2 text-sm">
          <legend className="mb-1 font-medium">{t('pdf.pageRange')}</legend>
          <label className="flex items-center gap-1">
            {t('pdf.pageFrom')}
            <input
              type="number"
              min={1}
              max={to}
              value={from}
              onChange={(e) => setFrom(Math.max(1, Math.min(to, Number(e.target.value) || 1)))}
              className="w-20 rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-1">
            {t('pdf.pageTo')}
            <input
              type="number"
              min={from}
              max={props.pageCount}
              value={to}
              onChange={(e) =>
                setTo(
                  Math.max(
                    from,
                    Math.min(props.pageCount, Number(e.target.value) || props.pageCount),
                  ),
                )
              }
              className="w-20 rounded border border-slate-300 px-2 py-1"
            />
          </label>
        </fieldset>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running !== null}
            className="w-full rounded-md bg-blue-600 px-5 py-2.5 font-medium text-white sm:w-auto hover:bg-blue-700 disabled:opacity-50"
          >
            {t('config.translate')}
          </button>
          {running && (
            <button
              type="button"
              onClick={() => {
                sheetStore.cancel();
                void pipelineClient.call((api) => api.cancel(running));
              }}
              className="rounded-md border border-slate-300 px-4 py-2"
            >
              {t('playground.cancel')}
            </button>
          )}
          {running && (
            <span className="text-sm text-slate-600" aria-live="polite">
              {download !== null
                ? t('playground.downloading', { percent: download })
                : progress
                  ? t(
                      progress.phase === 'check'
                        ? 'workspace.checking'
                        : progress.phase === 'ocr'
                          ? 'workspace.ocr'
                          : 'workspace.translating',
                      progress,
                    )
                  : t('file.reading')}
            </span>
          )}
        </div>
        {running && progress && (
          <ProgressBar done={progress.done} total={progress.total} phase={progress.phase} />
        )}
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
        <TranslationSheet />
      </div>
      {result && mono && (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
              onClick={() => downloadBlob(mono, `${base}.${config.target}.pdf`)}
              data-testid="download-pdf"
            >
              {t('download.pdf')}
            </button>
            {dual && (
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2"
                onClick={() =>
                  downloadBlob(dual, `${base}.${config.source}-${config.target}.dual.pdf`)
                }
                data-testid="download-dual"
              >
                {t('download.dual')}
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2"
              onClick={() =>
                downloadBlob(
                  new Blob([JSON.stringify(result.report, null, 2)], { type: 'application/json' }),
                  `${base}.${config.target}.report.json`,
                )
              }
            >
              {t('download.report')}
            </button>
          </div>
          {Object.keys(edits).some((k) => applied[k] !== edits[k]) && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm">
              <span>
                {t('review.pending', {
                  count: Object.keys(edits).filter((k) => applied[k] !== edits[k]).length,
                })}
              </span>
              <button
                type="button"
                disabled={running !== null}
                onClick={() => void run()}
                className="rounded bg-violet-700 px-3 py-1.5 text-white disabled:opacity-50"
                data-testid="pdf-apply-edits"
              >
                {running ? t('review.applying') : t('review.apply')}
              </button>
            </div>
          )}
          <PdfReportPanel
            pair={pair}
            report={result.report}
            edits={edits}
            onEdit={(src, tgt) => setEdits((e) => ({ ...e, [src]: tgt }))}
          />
          <AiStatement engine={config.engine} pair={pair} />
          <PdfPreview original={file} translated={mono} pageCount={result.report.summary.pages} />
        </>
      )}
    </div>
  );
}
