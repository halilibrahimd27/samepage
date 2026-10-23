import { proxy } from 'comlink';
import { useState } from 'react';
import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { DocxJob, DocxJobResult, JobError, PipelineApi } from '../../workers/api';
import { chromeTranslatorBridge, prepareChromeTranslator } from '../bridges/chromeTranslator';
import { downloadBlob } from '../download';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { useGlossary } from '../useGlossary';
import { DocxPreview } from './DocxPreview';
import { DocxReportPanel } from './DocxReportPanel';
import { GlossaryPanel } from './GlossaryPanel';

const LONG_JOB_MS = 2 * 60 * 60_000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function DocxTranslator({
  file,
  config,
  settings,
}: {
  file: File;
  config: EngineConfig;
  settings: Settings;
}) {
  const { t } = useI18n();
  const pair = { source: config.source, target: config.target };
  const glossary = useGlossary(pair);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [result, setResult] = useState<(DocxJobResult & { ok: true }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const job = (jobId: string): DocxJob => ({
    jobId,
    file,
    engine: config.spec(),
    pair,
    glossary: glossary.usable,
    numberLocalization: false,
    fidelityCheck: settings.fidelityCheck,
    translateComments: settings.translateComments,
    translateReferences: settings.translateReferences,
    translateMetadata: settings.translateMetadata,
    saveHistory: settings.saveHistory,
  });
  const base = file.name.replace(/\.docx$/i, '');
  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;
  const problem = config.problem(t);

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
        // Chrome requires a user gesture to create translators: stay inside the click handler.
        await prepareChromeTranslator(pair, (f) => setDownload(Math.round(f * 100)));
        setDownload(null);
        bridge = proxy(chromeTranslatorBridge);
      }
      const res = await pipelineClient.call<DocxJobResult>(
        (api) =>
          api.translateDocx(
            job(jobId),
            proxy((done: number, total: number) => setProgress({ done, total })),
            bridge,
          ),
        LONG_JOB_MS,
      );
      if (res.ok) setResult(res);
      else setError(jobErrorText(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
      setDownload(null);
    }
  }

  async function extract() {
    if (problem) return setError(problem);
    setExtracting(true);
    try {
      const res = await pipelineClient.call<
        Awaited<ReturnType<PipelineApi['extractDocxGlossary']>>
      >((api) => api.extractDocxGlossary(job(crypto.randomUUID())), LONG_JOB_MS);
      if (res.ok) {
        const known = new Set(glossary.entries.map((g) => g.source.toLowerCase()));
        glossary.update([
          ...glossary.entries,
          ...res.entries.filter((e) => !known.has(e.source.toLowerCase())),
        ]);
      } else setError(jobErrorText(res));
    } finally {
      setExtracting(false);
    }
  }

  const outBlob = result ? new Blob([result.bytes.slice()], { type: DOCX_MIME }) : null;

  return (
    <div className="flex flex-col gap-6">
      <GlossaryPanel
        entries={glossary.entries}
        onChange={glossary.update}
        {...(config.engine === 'anthropic' ? { onExtract: () => void extract() } : {})}
        extracting={extracting}
        fileName={`glossary.${config.source}-${config.target}.csv`}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
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
              onClick={() => void pipelineClient.call((api) => api.cancel(running))}
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

      {result && outBlob && (
        <>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
              onClick={() => downloadBlob(outBlob, `${base}.${config.target}.docx`)}
              data-testid="download-docx"
            >
              {t('download.docx')}
            </button>
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
          <DocxReportPanel report={result.report} />
          <section className="grid gap-4 lg:grid-cols-2">
            <DocxPreview data={file} label={t('preview.original')} />
            <DocxPreview data={outBlob} label={t('preview.translated')} />
          </section>
        </>
      )}
    </div>
  );
}
