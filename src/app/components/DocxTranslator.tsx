import { proxy } from 'comlink';
import { useState } from 'react';
import { languageName } from '../../core/languages';
import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { ProgressPhase } from '../../core/pipeline/translate';
import type { DocxJob, DocxJobResult, JobError, PipelineApi } from '../../workers/api';
import { browserTranslationBridge, sheetStore } from '../bridges/browserTranslator';
import { chromeTranslatorBridge, prepareChromeTranslator } from '../bridges/chromeTranslator';
import { downloadBlob } from '../download';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { ProgressBar } from './ProgressBar';
import { TranslationSheet } from './TranslationSheet';
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
  const { t, lang } = useI18n();
  const pair = { source: config.source, target: config.target };
  const glossary = useGlossary(pair);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    phase?: ProgressPhase | undefined;
  } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [result, setResult] = useState<(DocxJobResult & { ok: true }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  /** Review-step corrections (tagged source → tagged target), applied on rebuild. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<Record<string, string>>({});

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
    ...(Object.keys(edits).length ? { overrides: edits } : {}),
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
      } else if (config.engine === 'browser') {
        bridge = proxy(browserTranslationBridge);
      }
      const res = await pipelineClient.call<DocxJobResult>(
        (api) =>
          api.translateDocx(
            job(jobId),
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
      const message = e instanceof Error ? e.message : String(e);
      // Chrome refuses to create the translator when its language download failed.
      setError(
        /Unable to create translator|cannot translate this language pair|download stalled/i.test(
          message,
        )
          ? t('error.chromeTranslator')
          : message,
      );
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
  const pendingEdits = Object.keys(edits).filter((k) => applied[k] !== edits[k]).length;

  async function downloadBilingual() {
    if (!result) return;
    const rows = result.report.segments.map((s) => ({
      source: s.source,
      target: s.target,
      notes: [
        s.status === 'skipped'
          ? t('report.status.skipped')
          : s.status === 'untranslated'
            ? t('report.status.untranslated')
            : '',
        s.manual ? t('review.manual') : '',
        ...s.issues.map((i) => `${i.code}: ${i.detail}`),
      ]
        .filter(Boolean)
        .join('\n'),
    }));
    const bytes = await pipelineClient.call((api) =>
      api.bilingualDocx(rows, {
        title: t('bilingual.title', { name: file.name }),
        source: languageName(config.source, lang),
        target: languageName(config.target, lang),
        notes: t('bilingual.notes'),
      }),
    );
    downloadBlob(
      new Blob([bytes.slice()], { type: DOCX_MIME }),
      `${base}.${config.source}-${config.target}.review.docx`,
    );
  }

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
                      progress.phase === 'check' ? 'workspace.checking' : 'workspace.translating',
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
            <button
              type="button"
              className="rounded-md border border-slate-300 px-4 py-2"
              onClick={() => void downloadBilingual()}
              data-testid="download-bilingual"
            >
              {t('download.bilingual')}
            </button>
          </div>
          {pendingEdits > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm">
              <span>{t('review.pending', { count: pendingEdits })}</span>
              <button
                type="button"
                disabled={running !== null}
                onClick={() => void run()}
                className="rounded bg-violet-700 px-3 py-1.5 text-white disabled:opacity-50"
                data-testid="apply-edits"
              >
                {running ? t('review.applying') : t('review.apply')}
              </button>
            </div>
          )}
          <DocxReportPanel
            report={result.report}
            edits={edits}
            onEdit={(src, tgt) => setEdits((e) => ({ ...e, [src]: tgt }))}
          />
          <section className="grid gap-4 lg:grid-cols-2">
            <DocxPreview data={file} label={t('preview.original')} />
            <DocxPreview data={outBlob} label={t('preview.translated')} />
          </section>
        </>
      )}
    </div>
  );
}
