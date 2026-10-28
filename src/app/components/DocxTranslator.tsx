import { proxy } from 'comlink';
import { useEffect, useRef, useState } from 'react';
import type { ProjectManifest, ProjectOptions, StoredOutcome } from '../../core/project';
import { languageName } from '../../core/languages';
import type { ProgressPhase } from '../../core/pipeline/translate';
import type { DocxJob, DocxJobResult, JobError, PipelineApi } from '../../workers/api';
import { sheetStore } from '../bridges/browserTranslator';
import { engineBridge, runErrorText } from '../engineBridge';
import { downloadBlob } from '../download';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { ProgressBar } from './ProgressBar';
import { phaseMessage } from '../format';
import { TranslationSheet } from './TranslationSheet';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { useGlossary, useTermSuggestions } from '../useGlossary';
import { useProject } from '../useProject';
import { DocxPreview } from './DocxPreview';
import { AiStatement } from './AiStatement';
import { DocxReportPanel } from './DocxReportPanel';
import { GlossaryPanel } from './GlossaryPanel';

const LONG_JOB_MS = 2 * 60 * 60_000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME = {
  docx: DOCX_MIME,
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Word documents and PowerPoint presentations (both Office Open XML packages). */
export function DocxTranslator({
  file,
  format = 'docx',
  config,
  settings,
  project,
}: {
  file: File;
  format?: 'docx' | 'pptx';
  config: EngineConfig;
  settings: Settings;
  /** A reopened project (P9.5): shown without translating again. */
  project?: ProjectManifest;
}) {
  const { t, lang } = useI18n();
  const pair = { source: config.source, target: config.target };
  const glossary = useGlossary(pair);
  const suggestions = useTermSuggestions(file, 'docx', pair, glossary.entries);
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
  const [edits, setEdits] = useState<Record<string, string>>(project?.edits ?? {});
  const [applied, setApplied] = useState<Record<string, string>>({});
  const projectFile = useProject(project, file, format);
  const missingTerms = projectFile.missingTerms(glossary.entries);
  const current: ProjectOptions = {
    fidelityCheck: settings.fidelityCheck,
    localCitations: settings.localCitations,
    translateComments: settings.translateComments,
    translateReferences: settings.translateReferences,
    translateMetadata: settings.translateMetadata,
  };

  const job = (
    jobId: string,
    reuse: Record<string, StoredOutcome> | null = null,
    options: ProjectOptions = current,
  ): DocxJob => ({
    jobId,
    file,
    engine: config.spec(),
    ...(reuse ? { replay: reuse } : config.extras()),
    pair,
    glossary: glossary.usable,
    numberLocalization: false,
    fidelityCheck: options.fidelityCheck,
    localCitations: options.localCitations,
    translateComments: options.translateComments ?? settings.translateComments,
    translateReferences: options.translateReferences,
    translateMetadata: options.translateMetadata,
    ...(Object.keys(edits).length ? { overrides: edits } : {}),
  });
  const base = file.name.replace(/\.(docx|pptx)$/i, '');
  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;
  const problem = config.problem(t);

  /**
   * `fresh`: translate with the engine. Otherwise (corrections applied, a project reopened) the
   * translations shown are reused and no engine is called.
   */
  async function run(fresh: boolean) {
    const reuse = projectFile.reuse(fresh, pair);
    if (!reuse && problem) return setError(problem);
    setError(null);
    setResult(null);
    const jobId = crypto.randomUUID();
    setRunning(jobId);
    setProgress(null);
    try {
      const bridge = reuse ? undefined : await engineBridge(config.engine, pair, setDownload);
      const spec = config.spec();
      const options = projectFile.options(reuse !== null, current);
      const res = await pipelineClient.call<DocxJobResult>(
        (api) =>
          api.translateDocx(
            job(jobId, reuse, options),
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
        projectFile.finished(res.translations, reuse !== null, spec, options, pair);
      } else setError(jobErrorText(res));
    } catch (e) {
      setError(runErrorText(e, t));
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

  // A reopened project shows its translation at once.
  const reopened = useRef(false);
  useEffect(() => {
    if (!project || reopened.current) return;
    reopened.current = true;
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the project opens
  }, []);

  const outBlob = result ? new Blob([result.bytes.slice()], { type: MIME[format] }) : null;
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
      {missingTerms.length > 0 && (
        <button
          type="button"
          className="self-start rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900"
          onClick={() => glossary.update([...glossary.entries, ...missingTerms])}
          data-testid="project-glossary"
        >
          {t('project.glossary', { count: missingTerms.length })}
        </button>
      )}
      <GlossaryPanel
        entries={glossary.entries}
        onChange={glossary.update}
        {...(config.engine === 'anthropic' ? { onExtract: () => void extract() } : {})}
        extracting={extracting}
        fileName={`glossary.${config.source}-${config.target}.csv`}
        suggestions={suggestions}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run(true)}
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
                  ? t(phaseMessage(progress.phase), progress)
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
              onClick={() => downloadBlob(outBlob, `${base}.${config.target}.${format}`)}
              data-testid="download-docx"
            >
              {t(format === 'pptx' ? 'download.pptx' : 'download.docx')}
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
            {projectFile.canSave && (
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2"
                onClick={() =>
                  void projectFile
                    .save(glossary.usable, edits)
                    .catch((e: unknown) => setError(runErrorText(e, t)))
                }
                title={t('project.saveHint')}
                data-testid="save-project"
              >
                {t('project.save')}
              </button>
            )}
          </div>
          {pendingEdits > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm">
              <span>{t('review.pending', { count: pendingEdits })}</span>
              <button
                type="button"
                disabled={running !== null}
                onClick={() => void run(false)}
                className="rounded bg-violet-700 px-3 py-1.5 text-white disabled:opacity-50"
                data-testid="apply-edits"
              >
                {running ? t('review.applying') : t('review.apply')}
              </button>
            </div>
          )}
          <DocxReportPanel
            pair={pair}
            report={result.report}
            edits={edits}
            onEdit={(src, tgt) => setEdits((e) => ({ ...e, [src]: tgt }))}
          />
          <AiStatement engine={config.engine} pair={pair} />
          {/* The preview renders Word documents only; slides are checked in the report. */}
          {format === 'docx' && (
            <section className="grid gap-4 lg:grid-cols-2">
              <DocxPreview data={file} label={t('preview.original')} />
              <DocxPreview data={outBlob} label={t('preview.translated')} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
