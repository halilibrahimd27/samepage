import { proxy } from 'comlink';
import { useState } from 'react';
import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { JobError, PdfJob, PdfJobResult } from '../../workers/api';
import { browserTranslationBridge, sheetStore } from '../bridges/browserTranslator';
import { chromeTranslatorBridge, prepareChromeTranslator } from '../bridges/chromeTranslator';
import { downloadBlob } from '../download';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { useGlossary } from '../useGlossary';
import { GlossaryPanel } from './GlossaryPanel';
import { PdfPreview } from './PdfPreview';
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
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [result, setResult] = useState<(PdfJobResult & { ok: true }) | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      let bridge: ChromeTranslatorBridge | undefined;
      if (config.engine === 'chrome-builtin') {
        await prepareChromeTranslator(pair, (f) => setDownload(Math.round(f * 100)));
        setDownload(null);
        bridge = proxy(chromeTranslatorBridge);
      } else if (config.engine === 'browser') {
        bridge = proxy(browserTranslationBridge);
      }
      const job: PdfJob = {
        jobId,
        file,
        engine: config.spec(),
        pair,
        glossary: glossary.usable,
        numberLocalization: false,
        fidelityCheck: settings.fidelityCheck,
        translateReferences: settings.translateReferences,
        saveHistory: settings.saveHistory,
        dual: true,
        ...(Object.keys(edits).length ? { overrides: edits } : {}),
      };
      const res = await pipelineClient.call<PdfJobResult>(
        (api) =>
          api.translatePdf(
            job,
            proxy((done: number, total: number) => setProgress({ done, total })),
            bridge,
          ),
        LONG_JOB_MS,
      );
      if (res.ok) {
        setResult(res);
        setApplied(edits);
      } else setError(jobErrorText(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running !== null}
            className="rounded-md bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
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
                  ? t('workspace.translating', progress)
                  : t('file.reading')}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
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
            report={result.report}
            edits={edits}
            onEdit={(src, tgt) => setEdits((e) => ({ ...e, [src]: tgt }))}
          />
          <PdfPreview original={file} translated={mono} pageCount={result.report.summary.pages} />
        </>
      )}
    </div>
  );
}
