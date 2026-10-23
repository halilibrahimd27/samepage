import { expose, transfer } from 'comlink';
import {
  addHistory,
  deleteHistory,
  getHistoryEntry,
  IdbCache,
  listHistory,
  loadGlossary,
  saveGlossary,
} from '../core/cache/idb';
import { buildGlossarySample } from '../core/glossary/glossary';
import { estimateCost, translateSegments } from '../core/pipeline/translate';
import { plainText } from '../core/segment/codec';
import { parsePlaygroundMarkup } from '../core/segment/markup';
import { createBrowserPageEngine } from '../engines/browserPage';
import { createChromeEngine, type ChromeTranslatorBridge } from '../engines/chromeBuiltin';
import { docxParagraphs, translateDocx } from '../docx/pipeline';
import { DocxRejectedError } from '../docx/unzip';
import { createEngine } from '../engines';
import { EngineError, type SegmentRequest, type TranslationEngine } from '../engines/types';
import { inspectPdf } from '../pdf/engine';
import { redactSecrets } from '../security/redact';
import { LIMITS } from '../security/limits';
import type { DocxJob, JobError, PipelineApi, TextJob } from './api';

const THUMBNAIL_WIDTH = 240;
const cache = new IdbCache();
const controllers = new Map<string, AbortController>();

function engineFor(job: TextJob | DocxJob, chrome?: ChromeTranslatorBridge): TranslationEngine {
  if (job.engine.id === 'chrome-builtin' || job.engine.id === 'browser') {
    if (!chrome) throw new EngineError('unavailable', 'Main-thread translation bridge missing.');
    return job.engine.id === 'browser'
      ? createBrowserPageEngine(chrome)
      : createChromeEngine(chrome);
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
  if (error instanceof DocxRejectedError) {
    return { ok: false, code: 'rejected', message: error.rejection.reason };
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

  async translateDocx(job, onProgress, chrome) {
    const controller = new AbortController();
    controllers.set(job.jobId, controller);
    try {
      const { bytes, report } = await translateDocx(new Uint8Array(await job.file.arrayBuffer()), {
        engine: engineFor(job, chrome),
        pair: job.pair,
        glossary: job.glossary,
        numberLocalization: job.numberLocalization,
        fidelityCheck: job.fidelityCheck,
        translateComments: job.translateComments,
        translateReferences: job.translateReferences,
        translateMetadata: job.translateMetadata,
        cache,
        signal: controller.signal,
        ...(onProgress ? { onProgress: (d: number, t: number) => void onProgress(d, t) } : {}),
      });
      if (job.saveHistory) {
        const name = job.file instanceof File ? job.file.name : 'document.docx';
        await addHistory(
          {
            id: job.jobId,
            createdAt: Date.now(),
            name,
            outputName: `${name.replace(/\.docx$/i, '')}.${job.pair.target}.docx`,
            kind: 'docx',
            pair: job.pair,
            engine: job.engine.id,
            ...(job.engine.model ? { model: job.engine.model } : {}),
            summary: {
              segments: report.summary.segments,
              translated: report.summary.translated,
              warnings: report.summary.warnings,
              untranslated: report.summary.untranslated,
            },
            sizeBytes: bytes.byteLength,
          },
          bytes.slice(),
          report,
        ).catch(() => undefined); // history is best effort (storage may be full or disabled)
      }
      return transfer({ ok: true as const, bytes, report }, [bytes.buffer]);
    } catch (error) {
      return toJobError(error, controller.signal);
    } finally {
      controllers.delete(job.jobId);
    }
  },

  async extractDocxGlossary(job) {
    const controller = new AbortController();
    controllers.set(job.jobId, controller);
    try {
      const engine = engineFor(job);
      if (!engine.extractGlossary) {
        return { ok: false, code: 'unavailable', message: 'This engine cannot build a glossary.' };
      }
      const paragraphs = await docxParagraphs(new Uint8Array(await job.file.arrayBuffer()));
      const entries = await engine.extractGlossary(
        buildGlossarySample(paragraphs),
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

  listHistory: () => listHistory(),
  async getHistoryEntry(id) {
    const row = await getHistoryEntry(id);
    if (!row) return null;
    const bytes = row.bytes.slice();
    return transfer({ bytes, report: row.report }, [bytes.buffer]);
  },
  deleteHistory: (id) => deleteHistory(id),

  loadGlossary: (pair) => loadGlossary(pair.source, pair.target),
  saveGlossary: (pair, entries) => saveGlossary(pair.source, pair.target, entries),
  clearCache: () => cache.clear(),
};

expose(api);
