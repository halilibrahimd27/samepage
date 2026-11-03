import type { DocParagraph } from '../../core/abstract';
import type { TermText } from '../../core/glossary/detect';
import type { BlockIR, PageIR } from '../../core/ir/types';
import { openPdfForExtraction } from '../engine';
import {
  layerPage,
  needsOcr,
  OCR_SCALE,
  ocrPage,
  textOverPicture,
  unseenText,
  type OcrPageInfo,
} from '../ocr/page';
import type { OcrEngine } from '../ocr/tesseract';
import { hyphenEvidence, joinHyphen } from '../typeset/segments';
import { analyzePage, blockText, finishDocument, type PagePass } from './analyze';

export { analyzeDocument, blockText } from './analyze';

/** Text recognition for scanned pages, started on the first one. */
export interface OcrOptions {
  engine: () => Promise<OcrEngine>;
  /** Pages to recognise (0-based); others are read as they are. Default: all. */
  pages?: (index: number) => boolean;
  onPage?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** How a long PDF is read: which pages, and how far it has got. */
export interface ReadOptions {
  /** Pages to read (0-based); the others keep only their size. Default: all. */
  pages?: (index: number) => boolean;
  /** Pages read so far, of all. */
  onPage?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Lets the worker answer and tell its progress between pages of a long document. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Extracts and analyses up to `maxPages` pages of a PDF, page by page: each page's characters are
 * analysed as soon as it is read and let go (a thousand pages on a phone). With `ocr`, scanned
 * pages (no text, a page-size image) get their text from recognition. Pages left out of `read`
 * keep their size only.
 */
export async function extractAndAnalyze(
  bytes: Uint8Array,
  maxPages: number,
  ocr?: OcrOptions,
  read: ReadOptions = {},
): Promise<PageIR[]> {
  const pdf = await openPdfForExtraction(bytes);
  let engine: OcrEngine | null = null;
  try {
    const count = Math.min(pdf.pageCount, maxPages);
    const passes: PagePass[] = [];
    const infos = new Map<number, OcrPageInfo>();
    let recognised = 0;
    for (let i = 0; i < count; i++) {
      read.signal?.throwIfAborted();
      ocr?.signal?.throwIfAborted();
      if (!(read.pages?.(i) ?? true)) {
        passes.push(analyzePage(pdf.pageShell(i)));
        continue;
      }
      read.onPage?.(i, count);
      let p = pdf.extractPage(i);
      if (ocr && needsOcr(p) && (ocr.pages?.(i) ?? true)) {
        ocr.onPage?.(recognised++, count);
        engine ??= await ocr.engine();
        const { png, pixels } = pdf.renderPage(i, OCR_SCALE);
        const result = ocrPage(p, engine.recognize(png), pixels, OCR_SCALE);
        p = result.page;
        infos.set(i, result.info);
      } else if (textOverPicture(p)) {
        // A text layer unseen over a picture of the page (a deck saved as pictures and recognised
        // elsewhere): taken off, it changes no pixel. Read like a scan, it is covered and set anew;
        // left as text, the translation was written over the picture's own words.
        const scale = 1;
        const { pixels } = pdf.renderPage(i, scale);
        if (unseenText(p, pixels, pdf.renderWithoutText(i, scale), scale)) {
          const result = layerPage(p, pdf.renderPage(i, OCR_SCALE).pixels, OCR_SCALE);
          p = result.page;
          infos.set(i, result.info);
        }
      }
      passes.push(analyzePage(p));
      if (i % 8 === 7) await breathe();
    }
    read.onPage?.(count, count);
    if (recognised) ocr?.onPage?.(recognised, recognised);
    const pages = finishDocument(passes);
    for (const page of pages) {
      const info = infos.get(page.index);
      if (!info) continue;
      const { cards, ...ocrInfo } = info;
      page.ocr = ocrInfo;
      // After the analysis, which reads the text as the layer gave it: shapes for the layout only.
      for (const bbox of cards ?? [])
        page.vectors.push({ bbox, isRectangle: true, isStroked: false, picture: true });
    }
    return pages;
  } finally {
    engine?.close();
    pdf.close();
  }
}

/** The size most of the block's characters are set in. */
function mainSize(block: BlockIR): number {
  const chars = new Map<number, number>();
  for (const line of block.lines) {
    for (const s of line.spans) chars.set(s.size, (chars.get(s.size) ?? 0) + s.text.length);
  }
  return [...chars].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
}

/** Paragraphs in reading order; blocks of one paragraph chain (columns, pages) are joined. */
export function pdfParagraphs(pages: PageIR[]): DocParagraph[] {
  const out: DocParagraph[] = [];
  const byChain = new Map<string, DocParagraph>();
  const evidence = hyphenEvidence(pages);
  for (const page of pages) {
    for (const block of [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder)) {
      const text = blockText(block, (t, next) => joinHyphen(t, next, evidence));
      const lines = block.lines.map((l) => l.spans.map((s) => s.text).join(''));
      const open = block.chain && block.chain.index > 0 && byChain.get(block.chain.paragraphId);
      if (open) {
        open.text =
          /[\p{L}]-$/u.test(open.text) && /^\p{Ll}/u.test(text)
            ? joinHyphen(open.text, text, evidence) + text
            : `${open.text} ${text}`;
        open.lines!.push(...lines);
        continue;
      }
      const p: DocParagraph = {
        text,
        role: block.role,
        size: mainSize(block),
        page: page.index,
        lines,
      };
      if (block.chain) byChain.set(block.chain.paragraphId, p);
      out.push(p);
    }
  }
  return out;
}

/** Block texts with the pieces set in a code font (term suggestions); page furniture left out. */
export function pdfTermTexts(pages: PageIR[]): TermText[] {
  const out: TermText[] = [];
  const skip = new Set(['header', 'footer', 'page-number', 'formula', 'code']);
  for (const page of pages) {
    for (const block of page.blocks) {
      if (skip.has(block.role)) continue;
      const mono: string[] = [];
      for (const line of block.lines) {
        let piece = '';
        for (const span of line.spans) {
          if (span.font.family === 'mono' && !span.font.isMath) piece += span.text;
          else if (piece) {
            mono.push(piece);
            piece = '';
          }
        }
        if (piece) mono.push(piece);
      }
      out.push({ text: blockText(block), mono });
    }
  }
  return out;
}
