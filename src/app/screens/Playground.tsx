import { proxy } from 'comlink';
import { useEffect, useState } from 'react';
import type { CostEstimate } from '../../core/pipeline/translate';
import { decode, type DecodedRun } from '../../core/segment/codec';
import type { InlineStyle } from '../../core/segment/markup';
import type { GlossaryEntry } from '../../core/validate/validate';
import type { ChromeTranslatorBridge } from '../../engines/chromeBuiltin';
import type { JobError, PipelineApi, TextJob, TextJobResult, TextSegment } from '../../workers/api';
import { browserTranslationBridge, sheetStore } from '../bridges/browserTranslator';
import { chromeTranslatorBridge, prepareChromeTranslator } from '../bridges/chromeTranslator';
import { EngineConfigPanel } from '../components/EngineConfigPanel';
import { GlossaryPanel } from '../components/GlossaryPanel';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import { TranslationSheet } from '../components/TranslationSheet';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { TURKISH_SAMPLE } from './playgroundSample';

const LONG_JOB_MS = 30 * 60_000;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
}

function StyledTranslation({ segment }: { segment: TextSegment }) {
  const { outcome } = segment;
  let runs: DecodedRun<InlineStyle>[] | null;
  try {
    runs = decode(outcome.text, segment);
  } catch {
    runs = null;
  }
  if (!runs) return <>{outcome.text}</>;
  return (
    <>
      {runs.map((run, i) => {
        if (run.type === 'atom') return <code key={i}>${run.text}$</code>;
        const s = run.style ?? {};
        const text = s.bold ? <strong>{run.text}</strong> : run.text;
        return <span key={i}>{s.italic ? <em>{text}</em> : text}</span>;
      })}
    </>
  );
}

export function Playground({ config, settings }: { config: EngineConfig; settings: Settings }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [numberLocalization, setNumberLocalization] = useState(false);
  const [useCache, setUseCache] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [result, setResult] = useState<(TextJobResult & { ok: true }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);

  const pair = { source: config.source, target: config.target };
  const job = (jobId: string, paragraphs: string[]): TextJob => ({
    jobId,
    engine: config.spec(),
    pair,
    paragraphs,
    glossary: glossary.filter((g) => g.source.trim() && g.target.trim()),
    numberLocalization,
    fidelityCheck: settings.fidelityCheck,
    useCache,
  });

  // Glossary is stored per language pair in IndexedDB (via the worker).
  useEffect(() => {
    let active = true;
    void pipelineClient
      .call((api) => api.loadGlossary({ source: config.source, target: config.target }))
      .then((entries) => active && setGlossary(entries));
    return () => {
      active = false;
    };
  }, [config.source, config.target]);

  const changeGlossary = (entries: GlossaryEntry[]) => {
    setGlossary(entries);
    void pipelineClient.call((api) => api.saveGlossary(pair, entries));
  };

  const paragraphs = splitParagraphs(text);
  const paid = config.engine === 'anthropic' || config.engine === 'openai-compatible';
  const estimateKey = JSON.stringify([
    paragraphs,
    config.engine,
    config.anthropicModel,
    glossary,
    settings.fidelityCheck,
    pair,
  ]);
  useEffect(() => {
    if (!paid || paragraphs.length === 0) return;
    let active = true;
    const timer = setTimeout(() => {
      const spec = { ...job('estimate', paragraphs), engine: { ...config.spec(), apiKey: '' } };
      void pipelineClient.call((api) => api.estimate(spec)).then((e) => active && setEstimate(e));
    }, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- estimateKey captures the inputs
  }, [estimateKey, paid]);

  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;

  const precheck = (): string | null => {
    if (paragraphs.length === 0) return t('playground.empty');
    if (config.source === config.target) return t('config.sameLanguage');
    if (config.engine === 'anthropic' && !config.apiKey.key) return t('config.needKey');
    if (config.engine === 'openai-compatible' && !config.localModel.trim())
      return t('config.needLocalModel');
    return null;
  };

  async function run() {
    const problem = precheck();
    if (problem) return setError(problem);
    setError(null);
    setResult(null);
    setSeconds(null);
    const jobId = crypto.randomUUID();
    setRunning(jobId);
    setProgress({ done: 0, total: paragraphs.length });
    const started = performance.now();
    try {
      let bridge: ChromeTranslatorBridge | undefined;
      if (config.engine === 'chrome-builtin') {
        // Must run inside the click handler: Chrome requires a user gesture to create translators.
        await prepareChromeTranslator(pair, (f) => setDownload(Math.round(f * 100)));
        setDownload(null);
        bridge = proxy(chromeTranslatorBridge);
      } else if (config.engine === 'browser') {
        bridge = proxy(browserTranslationBridge);
      }
      const res = await pipelineClient.call<TextJobResult>(
        (api) =>
          api.translateText(
            job(jobId, paragraphs),
            proxy((done: number, total: number) => setProgress({ done, total })),
            bridge,
          ),
        LONG_JOB_MS,
      );
      if (res.ok) {
        setResult(res);
        setSeconds(Math.round((performance.now() - started) / 100) / 10);
      } else setError(jobErrorText(res));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
      setDownload(null);
    }
  }

  async function extract() {
    const problem = precheck();
    if (problem) return setError(problem);
    setExtracting(true);
    try {
      const res = await pipelineClient.call<Awaited<ReturnType<PipelineApi['extractGlossary']>>>(
        (api) => api.extractGlossary(job(crypto.randomUUID(), paragraphs)),
        LONG_JOB_MS,
      );
      if (res.ok) {
        const known = new Set(glossary.map((g) => g.source.toLowerCase()));
        changeGlossary([
          ...glossary,
          ...res.entries.filter((e) => !known.has(e.source.toLowerCase())),
        ]);
      } else setError(jobErrorText(res));
    } finally {
      setExtracting(false);
    }
  }

  const summary = result && {
    ok: result.segments.filter((s) => !s.outcome.untranslated && s.outcome.issues.length === 0)
      .length,
    warnings: result.segments.filter((s) => !s.outcome.untranslated && s.outcome.issues.length > 0)
      .length,
    untranslated: result.segments.filter((s) => s.outcome.untranslated).length,
    cached: result.segments.filter((s) => s.outcome.cached).length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <a href="#" className="text-sm text-blue-700 underline">
          {t('playground.back')}
        </a>
        <h2 className="mt-2 text-2xl font-semibold">{t('playground.title')}</h2>
        <p className="mt-1 text-sm text-slate-600">{t('playground.description')}</p>
      </div>

      <EngineConfigPanel config={config} settings={settings} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="playground-input" className="text-sm font-medium">
            {t('playground.input')}
          </label>
          <button
            type="button"
            className="text-sm text-blue-700 underline"
            onClick={() => setText(TURKISH_SAMPLE)}
          >
            {t('playground.sample')}
          </button>
        </div>
        <textarea
          id="playground-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="rounded-md border border-slate-300 bg-white p-3 font-serif"
        />
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={numberLocalization}
              onChange={(e) => setNumberLocalization(e.target.checked)}
            />
            {t('playground.numberLocalization')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useCache}
              onChange={(e) => setUseCache(e.target.checked)}
            />
            {t('playground.useCache')}
          </label>
        </div>
      </div>

      <GlossaryPanel
        entries={glossary}
        onChange={changeGlossary}
        {...(config.engine === 'anthropic' ? { onExtract: () => void extract() } : {})}
        extracting={extracting}
        fileName={`glossary.${config.source}-${config.target}.csv`}
      />

      <div className="flex flex-col gap-2">
        {paid && estimate && paragraphs.length > 0 && (
          <p className="text-sm text-slate-600" data-testid="estimate">
            {t('playground.estimate', {
              requests: estimate.requests,
              input: estimate.inputTokens.toLocaleString(),
              output: estimate.outputTokens.toLocaleString(),
            })}
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={running !== null}
            className="rounded-md bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('playground.translate')}
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
          {running && progress && (
            <span className="text-sm text-slate-600" aria-live="polite">
              {download !== null
                ? t('playground.downloading', { percent: download })
                : t('playground.progress', progress)}
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-800">
            {error}
          </p>
        )}
        <TranslationSheet />
      </div>

      {result && summary && (
        <section className="flex flex-col gap-3" data-testid="results">
          <p className="text-sm font-medium" data-testid="summary">
            {t('playground.summary', summary)}
            {result.tagSurvival.total > 0 &&
              ` · ${t('playground.tagSurvival', result.tagSurvival)}`}
            {seconds !== null && ` · ${t('playground.duration', { seconds })}`}
          </p>
          {result.segments.map((s) => (
            <article
              key={s.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
              data-testid="segment"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-slate-500">{s.id}</span>
                {s.outcome.untranslated ? (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-900">
                    {t('result.untranslated')}
                  </span>
                ) : (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
                    {t('result.ok')}
                  </span>
                )}
                {s.outcome.cached && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{t('result.cached')}</span>
                )}
                {s.outcome.attempts > 1 && (
                  <span className="text-slate-600">
                    {t('result.attempts', { count: s.outcome.attempts })}
                  </span>
                )}
              </div>
              <p className="mt-2 font-serif" lang={config.target}>
                <StyledTranslation segment={s} />
              </p>
              {s.outcome.issues.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {s.outcome.issues.map((issue, i) => (
                    <li
                      key={i}
                      className={issue.severity === 'error' ? 'text-red-800' : 'text-amber-800'}
                      data-testid="issue"
                    >
                      <span className="font-mono">{issue.code}</span> — {issue.detail}
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-2 text-sm text-slate-600">
                <summary className="cursor-pointer">{t('config.source')}</summary>
                <p className="mt-1 font-mono text-xs break-words">{s.source}</p>
              </details>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
