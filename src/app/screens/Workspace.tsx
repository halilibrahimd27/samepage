import { useEffect, useRef, useState } from 'react';
import { detectLanguage } from '../../core/detectLanguage';
import { languageName, type LanguageCode } from '../../core/languages';
import { WorkerFailedError } from '../../core/pipeline/workerClient';
import type { ProjectManifest } from '../../core/project';
import type { OpenedProject } from '../../core/projectFile';
import type { PdfInspection } from '../../pdf/engine';
import { checkFile, type DocKind, type FileRejection } from '../../security/fileCheck';
import { LIMITS } from '../../security/limits';
import { AbstractTranslator } from '../components/AbstractTranslator';
import { DocxTranslator } from '../components/DocxTranslator';
import { PdfTranslator } from '../components/PdfTranslator';
import { DropZone } from '../components/DropZone';
import { EngineConfigPanel } from '../components/EngineConfigPanel';
import type { EngineConfig } from '../engineConfig';
import { extensionFile } from '../extension';
import { formatBytes } from '../format';
import { useI18n, type Translate } from '../i18n';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';

type Thumb = { url: string; width: number; height: number };

type DocState =
  | { status: 'reading'; file: File }
  | {
      status: 'ready';
      file: File;
      kind: DocKind;
      pageCount?: number;
      thumb?: Thumb;
      detected?: LanguageCode;
      /** Detection ran and found no clear language: the user must check the source language. */
      undetected?: boolean;
      /** A scanned PDF: its text is recognised (OCR) when translating. */
      scanned?: boolean;
    }
  | { status: 'error'; file: File; message: string; workerFailed?: boolean };

function rejectionMessage(r: FileRejection, t: Translate, lang: string): string {
  switch (r.reason) {
    case 'empty':
      return t('error.empty');
    case 'unsupported':
      return t('error.unsupported');
    case 'docm':
      return t('error.docm');
    case 'too-large':
      return t('error.tooLarge', {
        kind: r.kind.toUpperCase(),
        limit: formatBytes(r.limitBytes, lang),
      });
  }
}

/** Prose of a LaTeX file for language detection: commands, math and comments removed. */
async function latexSample(file: File): Promise<string> {
  // A project .zip is not read here: the language is checked by the user.
  if (!/\.tex$/i.test(file.name)) return '';
  const text = await file.slice(0, 200_000).text();
  return text
    .replace(/%.*$/gm, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/[{}]/g, ' ');
}

export function Workspace({ settings, config }: { settings: Settings; config: EngineConfig }) {
  const { t, lang } = useI18n();
  const [doc, setDoc] = useState<DocState | null>(null);
  /** Translate the whole document, or only its title, abstract and keywords. */
  const [mode, setMode] = useState<'document' | 'abstract'>('document');
  /** The project file the document came from (P9.5): its translations are reopened. */
  const [project, setProject] = useState<ProjectManifest | null>(null);
  const request = useRef(0);

  // The samepage browser extension (P9.12) hands over the PDF the user chose: a message from this
  // window and this origin only (the extension's script runs in this page). The file then goes
  // through the same checks as a dropped one.
  const openRef = useRef<(file: File) => void>(() => {});
  useEffect(() => {
    openRef.current = (file) => void openFile(file);
  });
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const file = extensionFile(e.data);
      if (file) openRef.current(file);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const thumbUrl = doc?.status === 'ready' ? doc.thumb?.url : undefined;
  useEffect(() => {
    return () => {
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    };
  }, [thumbUrl]);

  /** Sets the source language from a text sample; keeps the pair valid. */
  function applyDetected(sample: string): LanguageCode | undefined {
    const found = detectLanguage(sample);
    if (!found) return undefined;
    if (found.lang === config.target) {
      config.setTarget(
        config.source !== found.lang ? config.source : found.lang === 'en' ? 'tr' : 'en',
      );
    }
    config.setSource(found.lang);
    return found.lang;
  }

  async function openFile(file: File, from?: ProjectManifest) {
    const id = ++request.current;
    const current = () => id === request.current;
    setDoc({ status: 'reading', file });
    setProject(from ?? null);

    const check = await checkFile(file);
    if (!current()) return;
    if (!check.ok) {
      setDoc({ status: 'error', file, message: rejectionMessage(check.rejection, t, lang) });
      return;
    }
    if (check.kind === 'project') {
      // A project inside a project is not a document.
      if (from) {
        setDoc({ status: 'error', file, message: t('error.project') });
        return;
      }
      const opened = await pipelineClient
        .call<OpenedProject>((api) => api.readProject(file), 120_000)
        .catch(() => ({ ok: false as const, reason: 'invalid' as const }));
      if (!current()) return;
      if (!opened.ok) {
        setDoc({ status: 'error', file, message: t('error.project') });
        return;
      }
      const { manifest } = opened;
      config.setSource(manifest.pair.source as LanguageCode);
      config.setTarget(manifest.pair.target as LanguageCode);
      setMode('document');
      await openFile(new File([opened.source.slice()], manifest.file.name), manifest);
      return;
    }
    // The project's language pair stands; detection runs on new documents only.
    const detect = (sample: string) => (from ? undefined : applyDetected(sample));
    if (check.kind === 'docx' || check.kind === 'pptx' || check.kind === 'latex') {
      const kind = check.kind;
      setDoc({ status: 'ready', file, kind });
      const sample =
        kind === 'latex'
          ? await latexSample(file)
          : await pipelineClient
              .call<string>((api) => api.sampleDocx(file), 60_000)
              .catch(() => '');
      if (!current()) return;
      const detected = detect(sample);
      setDoc(
        detected
          ? { status: 'ready', file, kind, detected }
          : { status: 'ready', file, kind, ...(from ? {} : { undetected: true }) },
      );
      return;
    }

    try {
      const result = await pipelineClient.call<PdfInspection>(
        (api) => api.inspectPdf(file),
        60_000,
      );
      if (!current()) return;
      if (result.ok) {
        const { png, width, height } = result.thumbnail;
        const url = URL.createObjectURL(new Blob([png.slice()], { type: 'image/png' }));
        const detected = detect(result.sample);
        setDoc({
          status: 'ready',
          file,
          kind: 'pdf',
          pageCount: result.pageCount,
          thumb: { url, width, height },
          ...(detected ? { detected } : from ? {} : { undetected: true }),
          ...(result.scanned ? { scanned: true } : {}),
        });
      } else {
        const message =
          result.reason === 'encrypted'
            ? t('error.encrypted')
            : result.reason === 'too-many-pages'
              ? t('error.tooManyPages', { count: result.pageCount, limit: LIMITS.pdfMaxPages })
              : t('error.corrupt');
        setDoc({ status: 'error', file, message });
      }
    } catch (error) {
      if (!current()) return;
      const timeout = error instanceof WorkerFailedError && error.kind === 'timeout';
      setDoc({
        status: 'error',
        file,
        message: t(timeout ? 'error.workerTimeout' : 'error.workerCrash'),
        workerFailed: error instanceof WorkerFailedError,
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {doc === null ? (
        <DropZone onFile={(f) => void openFile(f)} />
      ) : (
        <section
          className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4"
          aria-live="polite"
        >
          {doc.status === 'ready' && doc.thumb && (
            <img
              src={doc.thumb.url}
              width={doc.thumb.width / 2}
              height={doc.thumb.height / 2}
              alt={t('file.thumbnail', { name: doc.file.name })}
              data-testid="thumbnail"
              className="h-auto w-30 rounded border border-slate-200"
            />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate font-medium">{doc.file.name}</p>
            <p className="text-sm text-slate-600">
              {doc.status === 'ready' && doc.kind.toUpperCase()} ·{' '}
              {formatBytes(doc.file.size, lang)}
              {doc.status === 'ready' && doc.pageCount !== undefined && (
                <span data-testid="page-count"> · {t('file.pages', { count: doc.pageCount })}</span>
              )}
            </p>
            {doc.status === 'ready' && doc.detected && (
              <p className="text-sm text-slate-600" data-testid="detected-language">
                {t('file.detected', { lang: languageName(doc.detected, lang) })}
              </p>
            )}
            {doc.status === 'ready' && project && (
              <p role="status" className="text-sm text-emerald-800" data-testid="project-opened">
                {t('project.opened', { engine: t(`engine.${project.engine.id}.label`) })}
              </p>
            )}
            {doc.status === 'ready' && doc.scanned && (
              <p role="status" className="text-sm text-amber-800" data-testid="scanned-notice">
                {t('file.scanned')}
              </p>
            )}
            {doc.status === 'ready' && doc.undetected && !doc.scanned && (
              <p role="status" className="text-sm text-amber-800" data-testid="language-undetected">
                {t('file.undetected')}
              </p>
            )}
            {doc.status === 'reading' && (
              <p className="text-sm text-slate-600">{t('file.reading')}</p>
            )}
            {doc.status === 'error' && (
              <p role="alert" className="text-sm text-red-800">
                {doc.message}{' '}
                {doc.workerFailed && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void openFile(doc.file)}
                  >
                    {t('error.restart')}
                  </button>
                )}
              </p>
            )}
            <button
              type="button"
              className="mt-2 self-start text-sm text-blue-700 underline"
              onClick={() => {
                request.current++;
                setDoc(null);
                setProject(null);
              }}
            >
              {t('file.change')}
            </button>
          </div>
        </section>
      )}

      <EngineConfigPanel config={config} settings={settings} />

      {doc?.status === 'ready' && (doc.kind === 'pdf' || doc.kind === 'docx') && (
        <div role="group" aria-label={t('mode.label')} className="flex flex-wrap gap-2">
          {(['document', 'abstract'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full border px-4 py-1.5 text-sm ${
                mode === m
                  ? 'border-blue-600 bg-blue-50 font-medium text-blue-800'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              data-testid={`mode-${m}`}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>
      )}

      {doc?.status === 'ready' &&
      mode === 'abstract' &&
      (doc.kind === 'pdf' || doc.kind === 'docx') ? (
        <AbstractTranslator
          key={`${doc.file.name}-${doc.file.size}`}
          file={doc.file}
          kind={doc.kind}
          config={config}
          settings={settings}
        />
      ) : doc?.status === 'ready' && doc.kind === 'pdf' ? (
        <PdfTranslator
          key={`${doc.file.name}-${doc.file.size}-${project ? 'project' : ''}`}
          file={doc.file}
          pageCount={doc.pageCount ?? 1}
          config={config}
          settings={settings}
          {...(project ? { project } : {})}
        />
      ) : doc?.status === 'ready' &&
        (doc.kind === 'docx' || doc.kind === 'pptx' || doc.kind === 'latex') ? (
        <DocxTranslator
          key={`${doc.file.name}-${doc.file.size}-${project ? 'project' : ''}`}
          file={doc.file}
          format={doc.kind}
          config={config}
          settings={settings}
          {...(project ? { project } : {})}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled
            className="self-start rounded-md bg-blue-600 px-5 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('config.translate')}
          </button>
          {doc?.status === 'ready' && doc.kind === 'pdf' && (
            <p className="text-sm text-slate-600">{t('workspace.pdfSoon')}</p>
          )}
        </div>
      )}
    </div>
  );
}
