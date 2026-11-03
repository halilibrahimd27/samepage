import { proxy } from 'comlink';
import { useEffect, useRef, useState } from 'react';
import { languageName } from '../../core/languages';
import type { ProjectManifest, ProjectOptions } from '../../core/project';
import type { ProgressPhase } from '../../core/pipeline/translate';
import type { JobError, PdfJob, PdfJobResult } from '../../workers/api';
import { sheetStore } from '../bridges/browserTranslator';
import { engineBridge, runErrorText } from '../engineBridge';
import { downloadBlob } from '../download';
import { useWakeLock } from '../wakeLock';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { ProgressBar } from './ProgressBar';
import { phaseMessage } from '../format';
import { TranslationSheet } from './TranslationSheet';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { useGlossary, useTermSuggestions } from '../useGlossary';
import { useProject } from '../useProject';
import { GlossaryPanel } from './GlossaryPanel';
import { PdfPreview } from './PdfPreview';
import { AiStatement } from './AiStatement';
import { PdfReportPanel } from './PdfReportPanel';
import { TermConsistency } from './TermConsistency';
import type { GlossaryEntry } from '../../core/validate/validate';

const LONG_JOB_MS = 2 * 60 * 60_000;
/**
 * Pages from which the Word files and the side-by-side PDF are made on request, from the
 * translation: made at once they double what a phone holds of a thousand-page book.
 */
const LONG_DOCUMENT = 150;

export function PdfTranslator(props: {
  file: File;
  pageCount: number;
  config: EngineConfig;
  settings: Settings;
  /** A reopened project (P9.5): shown without translating again. */
  project?: ProjectManifest;
}) {
  const { file, config, settings, project } = props;
  const { t, lang } = useI18n();
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
  const range = project?.options.pageRange;
  const [from, setFrom] = useState(range ? range.from + 1 : 1);
  const [to, setTo] = useState(range ? range.to + 1 : props.pageCount);
  /** Review-step corrections (tagged source → tagged target), applied on rebuild. */
  const [edits, setEdits] = useState<Record<string, string>>(project?.edits ?? {});
  const projectFile = useProject(project, file, 'pdf');
  const missingTerms = projectFile.missingTerms(glossary.entries);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const long = Math.min(props.pageCount, to) - Math.max(1, from) + 1 > LONG_DOCUMENT;
  useWakeLock(running !== null);
  const base = file.name.replace(/\.pdf$/i, '');

  /** Source and translation side by side in Word, unit by unit, with its page and what to check. */
  async function downloadBilingual() {
    if (!result) return;
    const rows = result.report.units.map((u) => ({
      source: u.source,
      target: u.target,
      notes: [
        t('pdfReport.pages', { pages: u.pages.map((p) => p + 1).join(', ') }),
        u.status === 'translated' ? '' : t(`pdfReport.status.${u.status}`),
        u.manual ? t('review.manual') : '',
        ...u.issues.map((i) => `${i.code}: ${i.detail}`),
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
      new Blob([bytes.slice()], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      `${base}.${config.source}-${config.target}.review.docx`,
    );
  }
  const problem = config.problem(t);
  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;

  /**
   * `fresh`: translate with the engine. Otherwise (corrections applied, a project reopened) the
   * translations shown are reused and no engine is called.
   */
  async function run(
    fresh: boolean,
    terms?: GlossaryEntry[],
    outputs: { dual: boolean; editable: boolean } = { dual: !long, editable: !long },
  ) {
    const reuse = projectFile.reuse(fresh, pair);
    if (!reuse && problem) return setError(problem);
    setError(null);
    setResult(null);
    const jobId = crypto.randomUUID();
    setRunning(jobId);
    setProgress(null);
    try {
      const bridge = reuse
        ? undefined
        : await engineBridge(config.engine, pair, setDownload, config.polishOnDevice);
      const spec = config.spec();
      const options = projectFile.options(reuse !== null, {
        fidelityCheck: settings.fidelityCheck,
        localCitations: settings.localCitations,
        translateReferences: settings.translateReferences,
        referenceTitles: settings.referenceTitles,
        translateMetadata: settings.translateMetadata,
        ...(from > 1 || to < props.pageCount
          ? { pageRange: { from: Math.max(0, from - 1), to: Math.min(props.pageCount, to) - 1 } }
          : {}),
      } satisfies ProjectOptions);
      const job: PdfJob = {
        jobId,
        file,
        engine: spec,
        ...(reuse ? { replay: reuse } : config.extras()),
        pair,
        glossary: terms ?? glossary.usable,
        numberLocalization: false,
        fidelityCheck: options.fidelityCheck,
        localCitations: options.localCitations,
        translateReferences: options.translateReferences,
        referenceTitles: options.referenceTitles ?? false,
        officialTitles: settings.officialTitles,
        dual: outputs.dual,
        editable: outputs.editable,
        translateMetadata: options.translateMetadata,
        ...(options.pageRange ? { pageRange: options.pageRange } : {}),
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
        projectFile.finished(res.translations, reuse !== null, spec, options, pair);
      } else setError(jobErrorText(res));
    } catch (e) {
      setError(runErrorText(e, t));
    } finally {
      setRunning(null);
      setDownload(null);
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

  const mono = result ? new Blob([result.mono.slice()], { type: 'application/pdf' }) : null;
  const dual = result?.dual ? new Blob([result.dual.slice()], { type: 'application/pdf' }) : null;
  const word = result?.editable
    ? new Blob([result.editable.slice()], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    : null;
  const wordFlow = result?.editableFlow
    ? new Blob([result.editableFlow.slice()], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    : null;

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
        extracting={false}
        pair={{ source: config.source, target: config.target }}
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
            onClick={() => void run(true)}
            disabled={running !== null}
            className="w-full rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white shadow-sm shadow-blue-900/20 transition-colors sm:w-auto hover:bg-blue-800 disabled:opacity-50"
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
              className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
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
      {result && mono && (
        <>
          <section
            className="rounded-xl border border-emerald-200 bg-white p-5 shadow-sm"
            aria-labelledby="result-title"
          >
            <div className="flex items-center gap-2">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-6 w-6 text-emerald-600">
                <circle cx="10" cy="10" r="9" className="fill-emerald-100" />
                <path fill="currentColor" d="M8.4 13.4 5.3 10.3l1-1 2.1 2.1 5.3-5.3 1 1z" />
              </svg>
              <h2 id="result-title" className="text-lg font-semibold text-slate-900">
                {t('result.ready')}
              </h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {t('result.integrity', {
                translated: result.report.summary.translated + result.report.summary.warnings,
                review: result.report.summary.warnings,
                untranslated: result.report.summary.untranslated,
              })}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-md bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800"
                onClick={() => downloadBlob(mono, `${base}.${config.target}.pdf`)}
                data-testid="download-pdf"
              >
                {t('download.pdf')}
              </button>
              {word && (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                  onClick={() => downloadBlob(word, `${base}.${config.target}.docx`)}
                  title={t('download.wordHint')}
                  data-testid="download-word"
                >
                  {t('download.word')}
                </button>
              )}
              {wordFlow && (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                  onClick={() => downloadBlob(wordFlow, `${base}.${config.target}.flow.docx`)}
                  title={t('download.wordFlowHint')}
                  data-testid="download-word-flow"
                >
                  {t('download.wordFlow')}
                </button>
              )}
              {dual && (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
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
                className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                onClick={() => void downloadBilingual()}
                data-testid="download-bilingual"
              >
                {t('download.bilingual')}
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                onClick={() =>
                  downloadBlob(
                    new Blob([JSON.stringify(result.report, null, 2)], {
                      type: 'application/json',
                    }),
                    `${base}.${config.target}.report.json`,
                  )
                }
              >
                {t('download.report')}
              </button>
              {long && !word && (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  disabled={running !== null}
                  onClick={() => void run(false, undefined, { dual: !!dual, editable: true })}
                  title={t('long.later')}
                  data-testid="make-word"
                >
                  {t('long.makeWord')}
                </button>
              )}
              {long && !dual && (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  disabled={running !== null}
                  onClick={() => void run(false, undefined, { dual: true, editable: !!word })}
                  title={t('long.later')}
                  data-testid="make-dual"
                >
                  {t('long.makeDual')}
                </button>
              )}
              {projectFile.canSave && (
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
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
          </section>
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
                onClick={() => void run(false)}
                className="rounded bg-violet-700 px-3 py-1.5 text-white disabled:opacity-50"
                data-testid="pdf-apply-edits"
              >
                {running ? t('review.applying') : t('review.apply')}
              </button>
            </div>
          )}
          {result.report.terms?.length ? (
            <TermConsistency
              terms={result.report.terms}
              example={(id) => result.report.units.find((u) => u.id === id)}
              busy={running !== null}
              onUse={(entries) => {
                const next = [...glossary.entries, ...entries];
                glossary.update(next);
                void run(
                  true,
                  next.filter((g) => g.source.trim() && g.target.trim()),
                );
              }}
            />
          ) : null}
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
