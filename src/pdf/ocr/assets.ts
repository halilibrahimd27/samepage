/**
 * Browser loader for the OCR engine: the WebAssembly build and the language models are files of
 * this site (Vite copies them from node_modules); nothing is fetched from anywhere else. They are
 * downloaded only when a scanned page is met, and the service worker keeps them once used.
 */
import lstmWasm from 'tesseract.js-core/tesseract-core-lstm.wasm?url';
import simdWasm from 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url';
import bul from '@tesseract.js-data/bul/4.0.0_best_int/bul.traineddata.gz?url';
import ces from '@tesseract.js-data/ces/4.0.0_best_int/ces.traineddata.gz?url';
import deu from '@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz?url';
import ell from '@tesseract.js-data/ell/4.0.0_best_int/ell.traineddata.gz?url';
import eng from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';
import fra from '@tesseract.js-data/fra/4.0.0_best_int/fra.traineddata.gz?url';
import hun from '@tesseract.js-data/hun/4.0.0_best_int/hun.traineddata.gz?url';
import ita from '@tesseract.js-data/ita/4.0.0_best_int/ita.traineddata.gz?url';
import nld from '@tesseract.js-data/nld/4.0.0_best_int/nld.traineddata.gz?url';
import pol from '@tesseract.js-data/pol/4.0.0_best_int/pol.traineddata.gz?url';
import por from '@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz?url';
import ron from '@tesseract.js-data/ron/4.0.0_best_int/ron.traineddata.gz?url';
import rus from '@tesseract.js-data/rus/4.0.0_best_int/rus.traineddata.gz?url';
import spa from '@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz?url';
import swe from '@tesseract.js-data/swe/4.0.0_best_int/swe.traineddata.gz?url';
import tur from '@tesseract.js-data/tur/4.0.0_best_int/tur.traineddata.gz?url';
import ukr from '@tesseract.js-data/ukr/4.0.0_best_int/ukr.traineddata.gz?url';
import type { OcrLoader, TessFactory } from './tesseract';

const MODELS: Record<string, string> = {
  bul,
  ces,
  deu,
  ell,
  eng,
  fra,
  hun,
  ita,
  nld,
  pol,
  por,
  ron,
  rus,
  spa,
  swe,
  tur,
  ukr,
};

/** The smallest module using a SIMD instruction (as in wasm-feature-detect). */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
]);

/** Decompresses a gzip body unless the server already did (Content-Encoding). */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const browserOcrLoader: OcrLoader = {
  async core() {
    const simd = WebAssembly.validate(SIMD_PROBE);
    const mod = (
      simd
        ? await import('tesseract.js-core/tesseract-core-simd-lstm.js')
        : await import('tesseract.js-core/tesseract-core-lstm.js')
    ) as { default: TessFactory };
    return { factory: mod.default, wasmUrl: simd ? simdWasm : lstmWasm };
  },
  async model(lang) {
    const url = MODELS[lang];
    if (!url) throw new Error(`No OCR model for ${lang}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OCR model ${lang} could not be loaded (${res.status})`);
    return gunzip(new Uint8Array(await res.arrayBuffer()));
  },
};
