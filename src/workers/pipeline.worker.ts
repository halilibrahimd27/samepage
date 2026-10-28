import { expose, transfer } from 'comlink';
import { IdbCache, loadGlossary, saveGlossary } from '../core/cache/idb';
import { buildGlossarySample } from '../core/glossary/glossary';
import { estimateCost, translateSegments, type ProgressPhase } from '../core/pipeline/translate';
import { encode, plainText, verbatimOf } from '../core/segment/codec';
import { parsePlaygroundMarkup, styleKey } from '../core/segment/markup';
import { findPaperParts } from '../core/abstract';
import { suggestTerms } from '../core/glossary/detect';
import { readProjectFile, writeProjectFile } from '../core/projectFile';
import { createBrowserPageEngine } from '../engines/browserPage';
import { createChromeEngine, type ChromeTranslatorBridge } from '../engines/chromeBuiltin';
import { buildBilingualDocx } from '../docx/bilingual';
import { docxParagraphs, docxTermTexts, translateDocx } from '../docx/pipeline';
import { DocxRejectedError } from '../docx/unzip';
import { createEngine } from '../engines';
import { EngineError, type SegmentRequest, type TranslationEngine } from '../engines/types';
import { inspectPdf, loadFaces, renderPagePng, type LoadedFaces } from '../pdf/engine';
import { translatePdf } from '../pdf/pipeline';
import { browserOcrLoader } from '../pdf/ocr/assets';
import { createOcr } from '../pdf/ocr/tesseract';
import { extractAndAnalyze, pdfParagraphs, pdfTermTexts } from '../pdf/analyze';
import { redactSecrets } from '../security/redact';
import { LIMITS } from '../security/limits';
import type { DocxJob, JobError, PdfJob, PipelineApi, TextJob } from './api';

const THUMBNAIL_WIDTH = 240;
/** Pages searched for the title, abstract and keywords. */
const FRONT_PAGES = 3;
/** Pages read for glossary suggestions. */
const TERM_PAGES = 40;
const cache = new IdbCache();
const controllers = new Map<string, AbortController>();

/** Bundled Noto faces, fetched from public/fonts on the first PDF job and kept for the session. */
let faces: Promise<LoadedFaces> | null = null;
const getFaces = () =>
  (faces ??= loadFaces(async (file) => {
    const res = await fetch(`${import.meta.env.BASE_URL}fonts/${file}`);
    if (!res.ok) throw new Error(`Font ${file} could not be loaded (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }));

function engineFor(
  job: TextJob | DocxJob | PdfJob,
  chrome?: ChromeTranslatorBridge,
): TranslationEngine {
  // A reopened project translates nothing: its translations replace the engine (never called).
  if ('replay' in job && job.replay) return createEngine('pseudo', { pseudo: IDENTITY });
  if (job.engine.id === 'chrome-builtin' || job.engine.id === 'browser') {
    if (!chrome) throw new EngineError('unavailable', 'Main-thread translation bridge missing.');
    return job.engine.id === 'browser'
      ? createBrowserPageEngine(chrome)
      : createChromeEngine(chrome);
  }
  return createEngine(job.engine.id, job.engine);
}

const IDENTITY = { factor: 1, substitute: false };

/** Hybrid quality (P9.3): Claude under the user's own key revises what the check flags. */
function polishOptions(job: TextJob | DocxJob | PdfJob) {
  return {
    ...(job.polish
      ? {
          postEditor: createEngine('anthropic', {
            apiKey: job.polish.apiKey,
            model: job.polish.model,
          }),
        }
      : {}),
    ...(job.englishSpelling ? { englishSpelling: job.englishSpelling } : {}),
  };
}

function encodeParagraphs(job: TextJob) {
  return job.paragraphs.map((p, i) => ({
    id: `s${i + 1}`,
    ...(job.plain
      ? encode([{ type: 'text' as const, text: p, style: {} }], styleKey)
      : parsePlaygroundMarkup(p)),
  }));
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

  async sampleDocx(file) {
    try {
      const paragraphs = await docxParagraphs(new Uint8Array(await file.arrayBuffer()));
      let text = '';
      for (const p of paragraphs) {
        if (text.length > 8000) break;
        text += `${plainText(p.text)}\n`;
      }
      return text;
    } catch {
      return '';
    }
  },

  async suggestTerms(file, kind, pair, known) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const texts =
        kind === 'pdf'
          ? pdfTermTexts(await extractAndAnalyze(bytes, TERM_PAGES))
          : await docxTermTexts(bytes);
      return suggestTerms(texts, pair.source, pair.target, known);
    } catch {
      return [];
    }
  },

  async paperParts(file, kind, sourceLang) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const paragraphs =
        kind === 'pdf'
          ? pdfParagraphs(
              await extractAndAnalyze(bytes, FRONT_PAGES, {
                engine: () => createOcr([sourceLang, 'en'], browserOcrLoader),
              }),
            )
          : await docxParagraphs(bytes);
      return findPaperParts(paragraphs, sourceLang);
    } catch {
      return null;
    }
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
        ...verbatimOf(e.placeholders, job.pair),
      }));
      const outcomes = await translateSegments({
        engine,
        segments: requests,
        ctx: {
          pair: job.pair,
          glossary: job.glossary,
          numberLocalization: job.numberLocalization,
          ...(job.englishSpelling ? { englishSpelling: job.englishSpelling } : {}),
        },
        signal: controller.signal,
        ...(job.polish ? { postEditor: polishOptions(job).postEditor } : {}),
        ...(job.useCache ? { cache } : {}),
        fidelityCheck: job.fidelityCheck,
        localCitations: job.localCitations ?? false,
        ...(onProgress
          ? { onProgress: (d: number, t: number, p?: ProgressPhase) => void onProgress(d, t, p) }
          : {}),
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
      const { bytes, report, translations } = await translateDocx(
        new Uint8Array(await job.file.arrayBuffer()),
        {
          engine: engineFor(job, chrome),
          pair: job.pair,
          glossary: job.glossary,
          numberLocalization: job.numberLocalization,
          fidelityCheck: job.fidelityCheck,
          localCitations: job.localCitations ?? false,
          // A reopened project: its translations, no engine and no polishing.
          ...(job.replay ? { replay: job.replay } : polishOptions(job)),
          translateComments: job.translateComments,
          translateReferences: job.translateReferences,
          translateMetadata: job.translateMetadata,
          ...(job.overrides ? { overrides: job.overrides } : {}),
          cache,
          signal: controller.signal,
          ...(onProgress
            ? { onProgress: (d: number, t: number, p?: ProgressPhase) => void onProgress(d, t, p) }
            : {}),
        },
      );
      return transfer({ ok: true as const, bytes, report, translations }, [bytes.buffer]);
    } catch (error) {
      return toJobError(error, controller.signal);
    } finally {
      controllers.delete(job.jobId);
    }
  },

  async translatePdf(job, onProgress, chrome) {
    const controller = new AbortController();
    controllers.set(job.jobId, controller);
    try {
      const { mono, dual, editable, report, translations } = await translatePdf(
        new Uint8Array(await job.file.arrayBuffer()),
        {
          engine: engineFor(job, chrome),
          pair: job.pair,
          glossary: job.glossary,
          numberLocalization: job.numberLocalization,
          fidelityCheck: job.fidelityCheck,
          localCitations: job.localCitations ?? false,
          // A reopened project: its translations, no engine and no polishing.
          ...(job.replay ? { replay: job.replay } : polishOptions(job)),
          translateReferences: job.translateReferences,
          ...(job.overrides ? { overrides: job.overrides } : {}),
          translateMetadata: job.translateMetadata,
          ...(job.pageRange ? { pageRange: job.pageRange } : {}),
          faces: await getFaces(),
          // Scanned pages: the source language, and English for the abstract most papers have.
          ocr: { engine: () => createOcr([job.pair.source, 'en'], browserOcrLoader) },
          maxPages: LIMITS.pdfMaxPages,
          dual: job.dual,
          editable: true,
          cache,
          signal: controller.signal,
          ...(onProgress
            ? { onProgress: (d: number, t: number, p?: ProgressPhase) => void onProgress(d, t, p) }
            : {}),
        },
      );
      return transfer({ ok: true as const, mono, dual, editable, report, translations }, [
        mono.buffer,
        ...(dual ? [dual.buffer] : []),
        ...(editable ? [editable.buffer] : []),
      ]);
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

  async writeProject(manifest, source) {
    const bytes = await writeProjectFile(manifest, new Uint8Array(await source.arrayBuffer()));
    return transfer(bytes, [bytes.buffer]);
  },

  async readProject(file) {
    const opened = await readProjectFile(new Uint8Array(await file.arrayBuffer()));
    return opened.ok ? transfer(opened, [opened.source.buffer]) : opened;
  },

  async bilingualDocx(rows, labels) {
    const bytes = await buildBilingualDocx(rows, labels);
    return transfer(bytes, [bytes.buffer]);
  },
  async analyzePdf(file, maxPages) {
    return extractAndAnalyze(new Uint8Array(await file.arrayBuffer()), maxPages);
  },
  async renderPdfPage(file, index, scale) {
    const img = await renderPagePng(new Uint8Array(await file.arrayBuffer()), index, scale);
    return transfer(img, [img.png.buffer]);
  },

  loadGlossary: (pair) => loadGlossary(pair.source, pair.target),
  saveGlossary: (pair, entries) => saveGlossary(pair.source, pair.target, entries),
  clearCache: () => cache.clear(),
};

expose(api);
