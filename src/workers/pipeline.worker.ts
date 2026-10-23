import { expose, transfer } from 'comlink';
import { IdbCache, loadGlossary, saveGlossary } from '../core/cache/idb';
import { buildGlossarySample } from '../core/glossary/glossary';
import { estimateCost, translateSegments } from '../core/pipeline/translate';
import { plainText } from '../core/segment/codec';
import { parsePlaygroundMarkup } from '../core/segment/markup';
import { createChromeEngine } from '../engines/chromeBuiltin';
import { createEngine } from '../engines';
import { EngineError, type SegmentRequest, type TranslationEngine } from '../engines/types';
import { inspectPdf } from '../pdf/engine';
import { redactSecrets } from '../security/redact';
import { LIMITS } from '../security/limits';
import type { JobError, PipelineApi, TextJob } from './api';

const THUMBNAIL_WIDTH = 240;
const cache = new IdbCache();
const controllers = new Map<string, AbortController>();

function engineFor(
  job: TextJob,
  chrome?: Parameters<PipelineApi['translateText']>[2],
): TranslationEngine {
  if (job.engine.id === 'chrome-builtin') {
    if (!chrome) throw new EngineError('unavailable', 'Chrome built-in translator bridge missing.');
    return createChromeEngine(chrome);
  }
  return createEngine(job.engine.id, job.engine);
}

function encodeParagraphs(job: TextJob) {
  return job.paragraphs.map((p, i) => ({ id: `s${i + 1}`, ...parsePlaygroundMarkup(p) }));
}

function toJobError(error: unknown, signal?: AbortSignal): JobError {
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return { ok: false, code: 'cancelled', message: 'Cancelled.' };
  }
  if (
    error instanceof EngineError &&
    error.code !== 'refusal' &&
    error.code !== 'truncated' &&
    error.code !== 'bad-response'
  ) {
    return { ok: false, code: error.code, message: redactSecrets(error.message) };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, code: 'internal', message: redactSecrets(message) };
}

const api: PipelineApi = {
  ping() {
    return 'pong';
  },

  async inspectPdf(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await inspectPdf(bytes, {
      maxPages: LIMITS.pdfMaxPages,
      thumbnailWidth: THUMBNAIL_WIDTH,
    });
    return result.ok ? transfer(result, [result.thumbnail.png.buffer]) : result;
  },

  async translateText(job, onProgress, chrome) {
    const controller = new AbortController();
    controllers.set(job.jobId, controller);
    try {
      const engine = engineFor(job, chrome);
      const encoded = encodeParagraphs(job);
      const requests: SegmentRequest[] = encoded.map((e) => ({
        id: e.id,
        text: e.source,
        role: 'body',
      }));
      const outcomes = await translateSegments({
        engine,
        segments: requests,
        ctx: { pair: job.pair, glossary: job.glossary, numberLocalization: job.numberLocalization },
        signal: controller.signal,
        ...(job.useCache ? { cache } : {}),
        fidelityCheck: job.fidelityCheck,
        ...(onProgress ? { onProgress: (d: number, t: number) => void onProgress(d, t) } : {}),
      });
      let survived = 0;
      let total = 0;
      for (const o of outcomes) {
        if (o.notes.includes('tags-survived')) survived++;
        if (o.notes.includes('tags-survived') || o.notes.includes('tags-lost')) total++;
      }
      return {
        ok: true,
        tagSurvival: { survived, total },
        segments: encoded.map((e, i) => ({
          id: e.id,
          source: e.source,
          baseStyle: e.baseStyle,
          tags: e.tags,
          placeholders: e.placeholders,
          outcome: outcomes[i]!,
        })),
      };
    } catch (error) {
      return toJobError(error, controller.signal);
    } finally {
      controllers.delete(job.jobId);
    }
  },

  cancel(jobId) {
    controllers.get(jobId)?.abort();
  },

  estimate(job) {
    const engine =
      job.engine.id === 'chrome-builtin' ? null : createEngine(job.engine.id, job.engine);
    if (!engine) return { requests: 0, inputTokens: 0, outputTokens: 0 };
    const segments: SegmentRequest[] = encodeParagraphs(job).map((e) => ({
      id: e.id,
      text: e.source,
      role: 'body',
    }));
    return estimateCost({
      engine,
      segments,
      ctx: { pair: job.pair, glossary: job.glossary, numberLocalization: job.numberLocalization },
      fidelityCheck: job.fidelityCheck,
    });
  },

  async extractGlossary(job) {
    const controller = new AbortController();
    controllers.set(job.jobId, controller);
    try {
      const engine = engineFor(job);
      if (!engine.extractGlossary) {
        return { ok: false, code: 'unavailable', message: 'This engine cannot build a glossary.' };
      }
      const sample = buildGlossarySample(
        encodeParagraphs(job).map((e) => ({ text: plainText(e.source), role: 'body' })),
      );
      const entries = await engine.extractGlossary(
        sample,
        { pair: job.pair, glossary: [], numberLocalization: job.numberLocalization },
        controller.signal,
      );
      return { ok: true, entries };
    } catch (error) {
      return toJobError(error, controller.signal);
    } finally {
      controllers.delete(job.jobId);
    }
  },

  loadGlossary: (pair) => loadGlossary(pair.source, pair.target),
  saveGlossary: (pair, entries) => saveGlossary(pair.source, pair.target, entries),
  clearCache: () => cache.clear(),
};

expose(api);
