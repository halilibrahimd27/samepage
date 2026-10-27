import { proxy } from 'comlink';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { wordCount, type PaperParts } from '../../core/abstract';
import { paperLabels } from '../../core/glossary/academic';
import { languageName } from '../../core/languages';
import type { ProgressPhase } from '../../core/pipeline/translate';
import { decode, plainText } from '../../core/segment/codec';
import type { JobError, TextJob, TextJobResult, TextSegment } from '../../workers/api';
import { sheetStore } from '../bridges/browserTranslator';
import { downloadBlob } from '../download';
import { engineBridge, runErrorText } from '../engineBridge';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import type { ShownIssue } from '../issues';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { useGlossary, useTermSuggestions } from '../useGlossary';
import { GlossaryPanel } from './GlossaryPanel';
import { BackTranslation } from './BackTranslation';
import { IssueList } from './IssueList';
import { ProgressBar } from './ProgressBar';
import { TranslationSheet } from './TranslationSheet';

const JOB_MS = 30 * 60_000;

type Fields = { title: string; abstract: string; keywords: string };
type Part = { source: string; text: string; issues: ShownIssue[]; back?: string };
interface Result {
  title: Part | null;
  abstract: Part[];
  keywords: Part | null;
  /** Source word count of the abstract. */
  sourceWords: number;
}

const paragraphsOf = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

/** The translation as plain text (identifiers and URLs kept verbatim are put back). */
function translated(segment: TextSegment): Part {
  let text: string;
  try {
    text = decode(segment.outcome.text, segment)
      .map((r) => r.text)
      .join('');
  } catch {
    text = plainText(segment.outcome.text);
  }
  const issues = segment.outcome.issues.filter((i) => i.severity !== 'info');
  const source = decode(segment.source, segment)
    .map((r) => r.text)
    .join('');
  return { source, text, issues, ...(segment.outcome.back ? { back: segment.outcome.back } : {}) };
}

/** The title, abstract and keywords of a paper, found in the file, edited and translated. */
export function AbstractTranslator({
  file,
  kind,
  config,
  settings,
}: {
  file: File;
  kind: 'pdf' | 'docx';
  config: EngineConfig;
  settings: Settings;
}) {
  const { t, lang } = useI18n();
  const pair = { source: config.source, target: config.target };
  const glossary = useGlossary(pair);
  const suggestions = useTermSuggestions(file, kind, pair, glossary.entries);
  /** What the search found for a source language (bilingual papers have two abstracts). */
  const [searched, setSearched] = useState<{ source: string; parts: PaperParts | null } | null>(
    null,
  );
  const [fields, setFields] = useState<Fields>({ title: '', abstract: '', keywords: '' });
  const edited = useRef(false);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    phase?: ProgressPhase | undefined;
  } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const source = config.source;
    void pipelineClient
      .call<PaperParts | null>((api) => api.paperParts(file, kind, source), 60_000)
      .catch(() => null)
      .then((parts) => {
        if (!active) return;
        setSearched({ source, parts });
        if (parts && !edited.current) {
          setFields({
            title: parts.title,
            abstract: parts.abstract.join('\n\n'),
            keywords: parts.keywords,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [file, kind, config.source]);

  const found = searched?.source === config.source ? searched.parts : null;
  const search = searched?.source !== config.source ? 'searching' : found ? 'found' : 'missing';

  const edit = (key: keyof Fields) => (e: ChangeEvent<HTMLTextAreaElement>) => {
    edited.current = true;
    setFields((f) => ({ ...f, [key]: e.target.value }));
  };

  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;
  const problem = config.problem(t);

  async function run() {
    if (problem) return setError(problem);
    const title = fields.title.replace(/\s+/g, ' ').trim();
    const abstract = paragraphsOf(fields.abstract);
    const keywords = fields.keywords.replace(/\s+/g, ' ').trim();
    if (!abstract.length && !title && !keywords) return setError(t('abstract.empty'));
    setError(null);
    setResult(null);
    const jobId = crypto.randomUUID();
    setRunning(jobId);
    setProgress(null);
    try {
      const bridge = await engineBridge(config.engine, pair, setDownload);
      const paragraphs = [...(title ? [title] : []), ...abstract, ...(keywords ? [keywords] : [])];
      const job: TextJob = {
        jobId,
        engine: config.spec(),
        pair,
        paragraphs,
        plain: true,
        glossary: glossary.usable,
        numberLocalization: false,
        fidelityCheck: settings.fidelityCheck,
        localCitations: settings.localCitations,
        useCache: true,
      };
      const res = await pipelineClient.call<TextJobResult>(
        (api) =>
          api.translateText(
            job,
            proxy((done: number, total: number, phase?: ProgressPhase) =>
              setProgress({ done, total, phase }),
            ),
            bridge,
          ),
        JOB_MS,
      );
      if (!res.ok) return setError(jobErrorText(res));
      const parts = res.segments.map(translated);
      setResult({
        title: title ? parts.shift()! : null,
        keywords: keywords ? parts.pop()! : null,
        abstract: parts,
        sourceWords: wordCount(abstract.join(' ')),
      });
    } catch (e) {
      setError(runErrorText(e, t));
    } finally {
      setRunning(null);
      setDownload(null);
    }
  }

  const labels = paperLabels(config.target);
  const allText = result
    ? [
        result.title?.text,
        result.abstract.length
          ? `${labels.abstract}\n${result.abstract.map((p) => p.text).join('\n\n')}`
          : '',
        result.keywords ? `${labels.keywords}: ${result.keywords.text}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
    : '';

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      setError(t('abstract.copyFailed'));
    }
  }

  const copyButton = (id: string, text: string) => (
    <button
      type="button"
      onClick={() => void copy(id, text)}
      className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
      data-testid={`copy-${id}`}
    >
      {copied === id
        ? t('abstract.copied')
        : t(id === 'all' ? 'abstract.copyAll' : 'abstract.copy')}
    </button>
  );

  const field = (key: keyof Fields, rows: number) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex items-baseline justify-between font-medium">
        {t(`abstract.${key}`)}
        {key === 'abstract' && fields.abstract.trim() && (
          <span className="text-xs font-normal text-slate-500">
            {t('abstract.words', { count: wordCount(fields.abstract) })}
          </span>
        )}
      </span>
      <textarea
        value={fields[key]}
        onChange={edit(key)}
        rows={rows}
        className="rounded-md border border-slate-300 p-2 font-normal leading-relaxed"
        data-testid={`abstract-${key}`}
      />
    </label>
  );

  const compare = (p: Part) =>
    p.back && (
      <BackTranslation
        source={p.source}
        target={p.text}
        back={p.back}
        sourceLang={config.source}
        targetLang={config.target}
      />
    );

  const otherInTarget = found?.otherAbstracts.includes(config.target);
  const notSource = found?.lang && found.lang !== config.source;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <p
          className={`text-sm ${search === 'missing' ? 'text-amber-800' : 'text-slate-600'}`}
          role="status"
          data-testid="abstract-search"
        >
          {t(`abstract.${search}`)}
        </p>
        {notSource && (
          <p className="text-sm text-amber-800">
            {t('abstract.otherLang', { lang: languageName(found.lang!, lang) })}
          </p>
        )}
        {otherInTarget && (
          <p className="text-sm text-slate-600">
            {t('abstract.alreadyTarget', { lang: languageName(config.target, lang) })}
          </p>
        )}
        {field('title', 2)}
        {field('abstract', 10)}
        {field('keywords', 2)}
      </section>

      <GlossaryPanel
        entries={glossary.entries}
        onChange={glossary.update}
        extracting={false}
        fileName={`glossary.${config.source}-${config.target}.csv`}
        suggestions={suggestions}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running !== null || search === 'searching'}
            className="w-full rounded-md bg-blue-600 px-5 py-2.5 font-medium text-white sm:w-auto hover:bg-blue-700 disabled:opacity-50"
            data-testid="translate-abstract"
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

      {result && (
        <section
          className="flex flex-col gap-4 rounded-xl border border-emerald-200 bg-white p-4"
          data-testid="abstract-result"
          lang={config.target}
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">
              {t('abstract.result', { lang: languageName(config.target, lang) })}
            </h2>
            {copyButton('all', allText)}
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() =>
                downloadBlob(
                  new Blob([`${allText}\n`], { type: 'text/plain;charset=utf-8' }),
                  `${file.name.replace(/\.(pdf|docx)$/i, '')}.abstract.${config.target}.txt`,
                )
              }
            >
              {t('abstract.download')}
            </button>
          </div>
          {result.title && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold" data-testid="abstract-result-title">
                  {result.title.text}
                </p>
                {copyButton('title', result.title.text)}
              </div>
              <IssueList issues={result.title.issues} />
              {compare(result.title)}
            </div>
          )}
          {result.abstract.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold">{labels.abstract}</h3>
                <span className="mr-auto text-xs text-slate-500">
                  {t('abstract.wordsCompare', {
                    source: result.sourceWords,
                    target: wordCount(result.abstract.map((p) => p.text).join(' ')),
                  })}
                </span>
                {copyButton('abstract', result.abstract.map((p) => p.text).join('\n\n'))}
              </div>
              {result.abstract.map((p, i) => (
                <div key={i}>
                  <p className="leading-relaxed" data-testid="abstract-result-paragraph">
                    {p.text}
                  </p>
                  <IssueList issues={p.issues} />
                  {compare(p)}
                </div>
              ))}
            </div>
          )}
          {result.keywords && (
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <p>
                  <span className="font-semibold">{labels.keywords}:</span>{' '}
                  <span data-testid="abstract-result-keywords">{result.keywords.text}</span>
                </p>
                {copyButton('keywords', result.keywords.text)}
              </div>
              <IssueList issues={result.keywords.issues} />
              {compare(result.keywords)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
