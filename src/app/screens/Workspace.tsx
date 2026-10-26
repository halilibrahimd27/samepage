import { useEffect, useRef, useState } from 'react';
import { detectLanguage } from '../../core/detectLanguage';
import { languageName, type LanguageCode } from '../../core/languages';
import { WorkerFailedError } from '../../core/pipeline/workerClient';
import type { PdfInspection } from '../../pdf/engine';
import { checkFile, type DocKind, type FileRejection } from '../../security/fileCheck';
import { LIMITS } from '../../security/limits';
import { DocxTranslator } from '../components/DocxTranslator';
import { PdfTranslator } from '../components/PdfTranslator';
import { DropZone } from '../components/DropZone';
import { EngineConfigPanel } from '../components/EngineConfigPanel';
import type { EngineConfig } from '../engineConfig';
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

export function Workspace({ settings, config }: { settings: Settings; config: EngineConfig }) {
  const { t, lang } = useI18n();
  const [doc, setDoc] = useState<DocState | null>(null);
  const request = useRef(0);

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

  async function openFile(file: File) {
    const id = ++request.current;
    const current = () => id === request.current;
    setDoc({ status: 'reading', file });

    const check = await checkFile(file);
    if (!current()) return;
    if (!check.ok) {
      setDoc({ status: 'error', file, message: rejectionMessage(check.rejection, t, lang) });
      return;
    }
    if (check.kind === 'docx') {
      setDoc({ status: 'ready', file, kind: 'docx' });
      const sample = await pipelineClient
        .call<string>((api) => api.sampleDocx(file), 60_000)
        .catch(() => '');
      if (!current()) return;
      const detected = applyDetected(sample);
      if (detected) setDoc({ status: 'ready', file, kind: 'docx', detected });
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
        const detected = applyDetected(result.sample);
        setDoc({
          status: 'ready',
          file,
          kind: 'pdf',
          pageCount: result.pageCount,
          thumb: { url, width, height },
          ...(detected ? { detected } : {}),
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
              }}
            >
              {t('file.change')}
            </button>
          </div>
        </section>
      )}

      <EngineConfigPanel config={config} settings={settings} />

      {doc?.status === 'ready' && doc.kind === 'pdf' ? (
        <PdfTranslator
          key={`${doc.file.name}-${doc.file.size}`}
          file={doc.file}
          pageCount={doc.pageCount ?? 1}
          config={config}
          settings={settings}
        />
      ) : doc?.status === 'ready' && doc.kind === 'docx' ? (
        <DocxTranslator
          key={`${doc.file.name}-${doc.file.size}`}
          file={doc.file}
          config={config}
          settings={settings}
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
