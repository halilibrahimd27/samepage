import { proxy } from 'comlink';
import { useEffect, useRef, useState } from 'react';
import { detectLanguage } from '../../core/detectLanguage';
import { LANGUAGES, languageName, type LanguageCode } from '../../core/languages';
import type { TermPair, TermVariance } from '../../core/glossary/consistency';
import { mergeGlossaries } from '../../core/glossary/glossary';
import type { ProgressPhase } from '../../core/pipeline/translate';
import type { LangPair } from '../../engines/types';
import type { PdfInspection } from '../../pdf/engine';
import { checkFile } from '../../security/fileCheck';
import { LIMITS } from '../../security/limits';
import type {
  DocxJob,
  DocxJobResult,
  JobError,
  LatexJobResult,
  PdfJob,
  PdfJobResult,
} from '../../workers/api';
import { sheetStore } from '../bridges/browserTranslator';
import { downloadBlob } from '../download';
import { useWakeLock } from '../wakeLock';
import { engineBridge, runErrorText } from '../engineBridge';
import type { EngineConfig } from '../engineConfig';
import { latexSample, rejectionMessage } from '../fileInfo';
import { formatBytes, phaseMessage } from '../format';
import { useI18n } from '../i18n';
import { fromMemory } from '../issues';
import { pipelineClient } from '../pipelineClient';
import type { Settings } from '../settings';
import { ProgressBar } from './ProgressBar';
import { TermConsistency } from './TermConsistency';
import { TranslationSheet } from './TranslationSheet';

const LONG_JOB_MS = 2 * 60 * 60_000;
/** Files translated in one go. */
export const BATCH_MAX_FILES = 20;
const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  tex: 'text/x-tex',
  zip: 'application/zip',
};

type Kind = 'pdf' | 'docx' | 'pptx' | 'latex';
type Status = 'reading' | 'ready' | 'queued' | 'translating' | 'done' | 'failed' | 'skipped';

interface Item {
  id: string;
  file: File;
  status: Status;
  kind?: Kind;
  pageCount?: number;
  detected?: LanguageCode;
  /** The language this file goes into, when chosen for it alone. */
  target?: LanguageCode;
  message?: string;
  progress?: { done: number; total: number; phase?: ProgressPhase | undefined };
  outputs?: { name: string; blob: Blob }[];
  summary?: {
    translated: number;
    warnings: number;
    untranslated: number;
    score?: number;
    /** Paragraphs taken from the translation memory instead of the engine. */
    memory: number;
  };
  /** The pair it was translated in, and its engine's paragraphs (for the terms across files). */
  pair?: LangPair;
  pairs?: TermPair[];
}

/** Paragraphs the engine translated, ids made unique across the files. */
function enginePairs(
  item: string,
  paragraphs: {
    id: string;
    role: string;
    source: string;
    target: string;
    status: string;
    manual: boolean;
    issues: { code: string }[];
  }[],
): TermPair[] {
  return paragraphs
    .filter((p) => (p.status === 'translated' || p.status === 'warning') && !p.manual)
    .filter((p) => p.role !== 'reference' && !p.issues.some((i) => i.code === 'FROM_MEMORY'))
    .map((p) => ({ id: `${item}\u0000${p.id}`, source: p.source, target: p.target }));
}

/**
 * Several files translated one after another: each from its own language (detected from its
 * text) into the chosen one, with the same engine and settings. Each result can be downloaded
 * as it is done, and all of them as one .zip.
 */
export function BatchTranslator({
  files,
  config,
  settings,
  onClear,
}: {
  files: File[];
  config: EngineConfig;
  settings: Settings;
  onClear: () => void;
}) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Item[]>(() =>
    files
      .slice(0, BATCH_MAX_FILES)
      .map((file, k) => ({ id: `${k}-${file.name}`, file, status: 'reading' as const })),
  );
  const [running, setRunning] = useState(false);
  useWakeLock(running);
  const [download, setDownload] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Terms rendered two ways across the files of each language pair. */
  const [terms, setTerms] = useState<{ pair: LangPair; list: TermVariance[] }[]>([]);
  const stopped = useRef(false);
  const jobId = useRef<string | null>(null);
  const update = (id: string, patch: Partial<Item>) =>
    setItems((all) => all.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  /**
   * The language a file goes into: its own choice, or the one chosen for all — and for a file
   * already in that language, the other one of the pair, as one file alone does ("Türkçe →
   * İngilizce" chosen, an English paper goes into Turkish).
   */
  const targetOf = (it: Item): LanguageCode => {
    if (it.target) return it.target;
    if (it.detected !== config.target) return config.target;
    if (config.source !== config.target) return config.source;
    return config.target === 'en' ? 'tr' : 'en';
  };
  const jobErrorText = (e: JobError) =>
    e.code === 'cancelled' ? t('jobError.cancelled') : `${t(`jobError.${e.code}`)} ${e.message}`;

  // Each file is checked and its language read, one after another.
  useEffect(() => {
    let active = true;
    void (async () => {
      for (const it of items) {
        if (!active) return;
        const check = await checkFile(it.file);
        if (!check.ok) {
          update(it.id, { status: 'failed', message: rejectionMessage(check.rejection, t, lang) });
          continue;
        }
        if (check.kind === 'project') {
          update(it.id, { status: 'failed', message: t('batch.project') });
          continue;
        }
        const kind = check.kind;
        try {
          let sample = '';
          let pageCount: number | undefined;
          if (kind === 'pdf') {
            const inspected = await pipelineClient.call<PdfInspection>(
              (api) => api.inspectPdf(it.file),
              60_000,
            );
            if (!inspected.ok) {
              update(it.id, {
                status: 'failed',
                message:
                  inspected.reason === 'encrypted'
                    ? t('error.encrypted')
                    : inspected.reason === 'too-many-pages'
                      ? t('error.tooManyPages', {
                          count: inspected.pageCount,
                          limit: LIMITS.pdfMaxPages,
                        })
                      : t('error.corrupt'),
              });
              continue;
            }
            sample = inspected.sample;
            pageCount = inspected.pageCount;
          } else if (kind === 'latex') sample = await latexSample(it.file);
          else
            sample = await pipelineClient
              .call<string>((api) => api.sampleDocx(it.file), 60_000)
              .catch(() => '');
          const detected = detectLanguage(sample)?.lang;
          update(it.id, {
            status: 'ready',
            kind,
            ...(pageCount !== undefined ? { pageCount } : {}),
            ...(detected ? { detected } : {}),
          });
        } catch (e) {
          update(it.id, { status: 'failed', message: runErrorText(e, t) });
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the files chosen
  }, []);

  async function translate(it: Item): Promise<Partial<Item>> {
    const source = it.detected ?? config.source;
    const target = targetOf(it);
    if (source === target) return { status: 'skipped' };
    const pair = { source, target };
    const id = crypto.randomUUID();
    jobId.current = id;
    const glossary = await pipelineClient
      .call((api) => api.loadGlossary(pair))
      .then((entries) => entries.filter((g) => g.source.trim() && g.target.trim()))
      .catch(() => []);
    const bridge = await engineBridge(config.engine, pair, setDownload, config.polishOnDevice);
    setDownload(null);
    const onProgress = proxy((done: number, total: number, phase?: ProgressPhase) =>
      update(it.id, { progress: { done, total, phase } }),
    );
    const common = {
      jobId: id,
      file: it.file,
      engine: config.spec(),
      ...config.extras(),
      pair,
      glossary,
      numberLocalization: false,
      fidelityCheck: settings.fidelityCheck,
      localCitations: settings.localCitations,
      translateReferences: settings.translateReferences,
      referenceTitles: settings.referenceTitles,
      officialTitles: settings.officialTitles,
      translateMetadata: settings.translateMetadata,
    };
    const base = it.file.name.replace(/\.(pdf|docx|pptx|tex|zip)$/i, '');
    if (it.kind === 'pdf') {
      // A long PDF comes without its Word file (opened alone, it is made on request): a phone
      // holds the batch.
      const job: PdfJob = { ...common, dual: false, editable: (it.pageCount ?? 0) <= 150 };
      const res = await pipelineClient.call<PdfJobResult>(
        (api) => api.translatePdf(job, onProgress, bridge),
        LONG_JOB_MS,
      );
      if (!res.ok) return { status: 'failed', message: jobErrorText(res) };
      const s = res.report.summary;
      return {
        status: 'done',
        summary: {
          translated: s.translated,
          warnings: s.warnings,
          untranslated: s.untranslated,
          score: s.score,
          memory: res.report.units.filter(fromMemory).length,
        },
        pair,
        pairs: enginePairs(it.id, res.report.units),
        outputs: [
          { name: `${base}.${target}.pdf`, blob: new Blob([res.mono.slice()], { type: MIME.pdf }) },
          ...(res.editable
            ? [
                {
                  name: `${base}.${target}.docx`,
                  blob: new Blob([res.editable.slice()], { type: MIME.docx }),
                },
              ]
            : []),
        ],
      };
    }
    const job: DocxJob = { ...common, translateComments: settings.translateComments };
    const res = await pipelineClient.call<DocxJobResult | LatexJobResult>(
      (api) =>
        it.kind === 'latex'
          ? api.translateLatex(job, onProgress, bridge)
          : api.translateDocx(job, onProgress, bridge),
      LONG_JOB_MS,
    );
    if (!res.ok) return { status: 'failed', message: jobErrorText(res) };
    const ext =
      it.kind === 'latex' ? ('zip' in res && res.zip ? 'zip' : 'tex') : (it.kind ?? 'docx');
    const s = res.report.summary;
    return {
      status: 'done',
      summary: {
        translated: s.translated,
        warnings: s.warnings,
        untranslated: s.untranslated,
        memory: res.report.segments.filter(fromMemory).length,
      },
      pair,
      pairs: enginePairs(it.id, res.report.segments),
      outputs: [
        {
          name: `${base}.${target}.${ext}`,
          blob: new Blob([res.bytes.slice()], { type: MIME[ext as keyof typeof MIME] }),
        },
      ],
    };
  }

  async function translateAll(again?: Item[]) {
    const problem = config.problem(t);
    if (problem) return setError(problem);
    setError(null);
    setTerms([]);
    stopped.current = false;
    setRunning(true);
    const todo =
      again ??
      items.filter(
        (it) => it.status === 'ready' || it.status === 'failed' || it.status === 'skipped',
      );
    const finished = new Map<string, Item>();
    setItems((all) =>
      all.map((it) =>
        todo.some((x) => x.id === it.id) && it.kind ? { ...it, status: 'queued' } : it,
      ),
    );
    for (const it of todo) {
      if (stopped.current) break;
      if (!it.kind) continue;
      update(it.id, { status: 'translating', progress: undefined, message: undefined });
      try {
        const result = await translate(it);
        update(it.id, result);
        if (result.status === 'done') finished.set(it.id, { ...it, ...result });
      } catch (e) {
        update(it.id, { status: 'failed', message: runErrorText(e, t) });
      }
    }
    // What the stop left waiting can go again.
    setItems((all) => all.map((it) => (it.status === 'queued' ? { ...it, status: 'ready' } : it)));
    if (!stopped.current)
      await checkTerms([
        ...items.filter((it) => it.status === 'done' && !finished.has(it.id)),
        ...finished.values(),
      ]);
    jobId.current = null;
    setRunning(false);
    setDownload(null);
  }

  /**
   * Terms the files of one language pair render two ways, read across all of them and confirmed
   * by the engine: a thesis's chapters, a series of papers say a term one way.
   */
  async function checkTerms(done: Item[]) {
    const groups = new Map<string, { pair: LangPair; pairs: TermPair[] }>();
    for (const it of done) {
      if (!it.pair || !it.pairs?.length) continue;
      const key = `${it.pair.source}>${it.pair.target}`;
      const g = groups.get(key) ?? { pair: it.pair, pairs: [] };
      g.pairs.push(...it.pairs);
      groups.set(key, g);
    }
    const found: { pair: LangPair; list: TermVariance[] }[] = [];
    for (const { pair, pairs } of groups.values()) {
      const glossary = await pipelineClient.call((api) => api.loadGlossary(pair)).catch(() => []);
      const bridge = await engineBridge(config.engine, pair, setDownload).catch(() => undefined);
      const id = crypto.randomUUID();
      jobId.current = id;
      const list = await pipelineClient
        .call((api) =>
          api.termsAcross({ jobId: id, engine: config.spec(), pair, glossary, pairs }, bridge),
        )
        .catch(() => []);
      if (list.length) found.push({ pair, list });
    }
    setTerms(found);
  }

  /** The chosen renderings into the pair's glossary, and its files translated again. */
  async function applyTerms(pair: LangPair, entries: { source: string; target: string }[]) {
    const stored = await pipelineClient.call((api) => api.loadGlossary(pair)).catch(() => []);
    await pipelineClient.call((api) => api.saveGlossary(pair, mergeGlossaries(stored, entries)));
    const again = items.filter(
      (it) =>
        it.status === 'done' && it.pair?.source === pair.source && it.pair.target === pair.target,
    );
    await translateAll(again);
  }

  function stop() {
    stopped.current = true;
    sheetStore.cancel();
    const id = jobId.current;
    if (id) void pipelineClient.call((api) => api.cancel(id));
  }

  async function downloadAll() {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const it of items) for (const o of it.outputs ?? []) zip.file(o.name, o.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `samepage.${config.target}.zip`);
  }

  const reading = items.some((it) => it.status === 'reading');
  const done = items.filter((it) => it.status === 'done');
  const current = items.find((it) => it.status === 'translating');
  const position = current ? items.indexOf(current) + 1 : 0;
  const statusText = (it: Item) =>
    it.status === 'skipped'
      ? t('batch.skipped', { lang: languageName(config.target, lang) })
      : t(`batch.${it.status}`);

  return (
    <section className="flex flex-col gap-4" data-testid="batch">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{t('batch.title', { count: items.length })}</h2>
        <button
          type="button"
          className="text-sm text-blue-700 underline disabled:opacity-50"
          onClick={onClear}
          disabled={running}
        >
          {t('batch.clear')}
        </button>
      </div>
      {files.length > BATCH_MAX_FILES && (
        <p role="status" className="text-sm text-amber-800">
          {t('batch.tooMany', { limit: BATCH_MAX_FILES })}
        </p>
      )}
      <p className="text-sm text-slate-600">{t('batch.hint')}</p>
      <ul className="flex flex-col divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
        {items.map((it) => (
          <li key={it.id} className="flex flex-col gap-2 p-4" data-testid="batch-item">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{it.file.name}</span>
                <span className="text-sm text-slate-600">
                  {it.kind ? `${it.kind.toUpperCase()} · ` : ''}
                  {formatBytes(it.file.size, lang)}
                  {it.pageCount !== undefined
                    ? ` · ${t('file.pages', { count: it.pageCount })}`
                    : ''}
                </span>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  it.status === 'done'
                    ? 'bg-emerald-100 text-emerald-900'
                    : it.status === 'failed'
                      ? 'bg-red-100 text-red-900'
                      : it.status === 'translating'
                        ? 'bg-blue-100 text-blue-900'
                        : 'bg-slate-100 text-slate-700'
                }`}
                data-testid="batch-status"
              >
                {statusText(it)}
              </span>
            </div>
            {it.kind && it.status !== 'failed' && (
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                <span>{languageName(it.detected ?? config.source, lang)} →</span>
                <select
                  value={targetOf(it)}
                  disabled={running}
                  aria-label={t('batch.targetFor', { name: it.file.name })}
                  onChange={(e) =>
                    update(it.id, {
                      target: e.target.value as LanguageCode,
                      ...(it.status === 'skipped' ? { status: 'ready' as const } : {}),
                    })
                  }
                  className="rounded-md border border-slate-300 bg-white px-2 py-1"
                  data-testid="batch-target"
                >
                  {LANGUAGES.map((code) => ({ code, name: languageName(code, lang) }))
                    .sort((a, b) => a.name.localeCompare(b.name, lang))
                    .map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {it.status === 'translating' && it.progress && (
              <>
                <span className="text-sm text-slate-600">
                  {t(phaseMessage(it.progress.phase), it.progress)}
                </span>
                <ProgressBar
                  done={it.progress.done}
                  total={it.progress.total}
                  phase={it.progress.phase}
                />
              </>
            )}
            {it.message && (
              <p role="alert" className="text-sm text-red-800">
                {it.message}
              </p>
            )}
            {it.status === 'done' && it.summary && (
              <p className="text-sm text-slate-700" data-testid="batch-summary">
                {t('batch.summary', it.summary)}
                {it.summary.memory > 0
                  ? ` · ${t('batch.memory', { count: it.summary.memory })}`
                  : ''}
                {it.summary.score !== undefined
                  ? ` · ${t('batch.score', {
                      score: it.summary.score.toLocaleString(lang, { maximumFractionDigits: 1 }),
                    })}`
                  : ''}
              </p>
            )}
            {it.outputs && (
              <div className="flex flex-wrap gap-2">
                {it.outputs.map((o) => (
                  <button
                    key={o.name}
                    type="button"
                    onClick={() => downloadBlob(o.blob, o.name)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                  >
                    {o.name.endsWith('.pdf')
                      ? t('download.pdf')
                      : t('batch.download', { name: o.name })}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void translateAll()}
          disabled={
            running ||
            reading ||
            !items.some((it) => ['ready', 'failed', 'skipped'].includes(it.status))
          }
          className="w-full rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white shadow-sm shadow-blue-900/20 transition-colors sm:w-auto hover:bg-blue-800 disabled:opacity-50"
          data-testid="batch-translate"
        >
          {t('batch.translateAll')}
        </button>
        {running && (
          <button
            type="button"
            onClick={stop}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            {t('playground.cancel')}
          </button>
        )}
        {done.length > 1 && !running && (
          <button
            type="button"
            onClick={() => void downloadAll()}
            className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white shadow-sm hover:bg-emerald-800"
            data-testid="batch-download-all"
          >
            {t('batch.downloadAll')}
          </button>
        )}
        {running && current && (
          <span className="text-sm text-slate-600" aria-live="polite">
            {download !== null
              ? t('playground.downloading', { percent: download })
              : t('batch.progress', { n: position, total: items.length, name: current.file.name })}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {!running &&
        terms.map(({ pair, list }) => (
          <TermConsistency
            key={`${pair.source}>${pair.target}`}
            terms={list}
            example={(id) => {
              const [item] = id.split('\u0000');
              return items.find((it) => it.id === item)?.pairs?.find((p) => p.id === id);
            }}
            busy={running}
            onUse={(entries) => void applyTerms(pair, entries)}
          />
        ))}
      <TranslationSheet />
    </section>
  );
}
