/**
 * Text recognition for scanned pages (P8.4) with Tesseract's WebAssembly build
 * (tesseract.js-core, Apache-2.0) and the "best_int" language models, all self-hosted. It runs
 * in the pipeline worker itself: no extra worker, no network beyond this site's own files.
 */

/** Our language codes → Tesseract's model names. */
export const TESSERACT_LANG: Record<string, string> = {
  tr: 'tur',
  en: 'eng',
  de: 'deu',
  fr: 'fra',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  nl: 'nld',
  pl: 'pol',
  cs: 'ces',
  ro: 'ron',
  hu: 'hun',
  sv: 'swe',
  ru: 'rus',
  uk: 'ukr',
  bg: 'bul',
  el: 'ell',
};

export interface OcrWord {
  text: string;
  /** Tesseract's confidence, 0–100. */
  conf: number;
  /** Pixel box in the rendered image. */
  left: number;
  top: number;
  width: number;
  height: number;
  block: number;
  par: number;
  line: number;
}

/** The parts of the Emscripten module and of TessBaseAPI that are used here. */
interface TessApi {
  Init(datapath: null, lang: string, oem: number): number;
  SetVariable(name: string, value: string): boolean;
  SetImageFile(exif: number, angle: number): number;
  Recognize(monitor: null): number;
  GetTSVText(): string;
  End(): void;
  delete?(): void;
}
export interface TessModule {
  FS: { writeFile(path: string, data: Uint8Array): void; unlink(path: string): void };
  TessBaseAPI: new () => TessApi;
}
export type TessFactory = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<TessModule>;

/** Where the engine and the language models come from (browser assets or Node files). */
export interface OcrLoader {
  core(): Promise<{ factory: TessFactory; wasmUrl?: string }>;
  /** A language model, already decompressed (`.traineddata`). */
  model(tesseractLang: string): Promise<Uint8Array>;
}

export interface OcrEngine {
  recognize(png: Uint8Array): OcrWord[];
  close(): void;
}

const OEM_LSTM_ONLY = 1;
const PSM_AUTO = '3';

/** Parses Tesseract's TSV output; word rows only (level 5) with text. */
export function parseTsv(tsv: string): OcrWord[] {
  const out: OcrWord[] = [];
  for (const row of tsv.split('\n')) {
    const c = row.split('\t');
    if (c[0] !== '5' || c.length < 12) continue;
    const text = c.slice(11).join('\t').trim();
    if (!text) continue;
    out.push({
      block: Number(c[2]),
      par: Number(c[3]),
      line: Number(c[4]),
      left: Number(c[6]),
      top: Number(c[7]),
      width: Number(c[8]),
      height: Number(c[9]),
      conf: Number(c[10]),
      text,
    });
  }
  return out;
}

/** Loads the engine with the given languages (our codes); unknown ones are skipped. */
export async function createOcr(langs: string[], loader: OcrLoader): Promise<OcrEngine> {
  const models = [...new Set(langs.map((l) => TESSERACT_LANG[l]).filter((l): l is string => !!l))];
  if (!models.length) models.push('eng');
  const { factory, wasmUrl } = await loader.core();
  const tess = await factory(wasmUrl ? { locateFile: () => wasmUrl } : {});
  for (const m of models) tess.FS.writeFile(`${m}.traineddata`, await loader.model(m));
  const api = new tess.TessBaseAPI();
  if (api.Init(null, models.join('+'), OEM_LSTM_ONLY) !== 0) {
    throw new Error(`OCR could not start for ${models.join('+')}`);
  }
  api.SetVariable('tessedit_pageseg_mode', PSM_AUTO);
  // Keep the spaces between words as the page has them (no extra space for wide gaps).
  api.SetVariable('preserve_interword_spaces', '0');
  return {
    recognize(png) {
      tess.FS.writeFile('/input', png);
      try {
        if (api.SetImageFile(1, 0) !== 0) throw new Error('OCR could not read the page image');
        api.Recognize(null);
        return parseTsv(api.GetTSVText());
      } finally {
        tess.FS.unlink('/input');
      }
    },
    close() {
      api.End();
      api.delete?.();
    },
  };
}
