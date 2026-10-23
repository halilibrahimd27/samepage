import { expose, transfer } from 'comlink';
import { inspectPdf } from '../pdf/engine';
import { LIMITS } from '../security/limits';
import type { PipelineApi } from './api';

const THUMBNAIL_WIDTH = 240;

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
};

expose(api);
