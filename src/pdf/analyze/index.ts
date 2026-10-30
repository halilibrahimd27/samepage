import type { DocParagraph } from '../../core/abstract';
import type { TermText } from '../../core/glossary/detect';
import type { BlockIR, PageIR } from '../../core/ir/types';
import { openPdfForExtraction } from '../engine';
import { needsOcr, OCR_SCALE, ocrPage, type OcrPageInfo } from '../ocr/page';
import type { OcrEngine } from '../ocr/tesseract';
import { hyphenEvidence, joinHyphen } from '../typeset/segments';
import { analyzeDocument, blockText } from './analyze';

export { analyzeDocument, blockText } from './analyze';

/** Text recognition for scanned pages, started on the first one. */
export interface OcrOptions {
  engine: () => Promise<OcrEngine>;
  /** Pages to recognise (0-based); others are read as they are. Default: all. */
  pages?: (index: number) => boolean;
  onPage?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Extracts and analyses up to `maxPages` pages of a PDF. With `ocr`, scanned pages (no text, a
 * page-size image) get their text from recognition.
 */
export async function extractAndAnalyze(
  bytes: Uint8Array,
  maxPages: number,
  ocr?: OcrOptions,
): Promise<PageIR[]> {
  const pdf = await openPdfForExtraction(bytes);
  let engine: OcrEngine | null = null;
  try {
    const count = Math.min(pdf.pageCount, maxPages);
    const raw = Array.from({ length: count }, (_, i) => pdf.extractPage(i));
    const scanned = ocr ? raw.filter((p) => needsOcr(p) && (ocr.pages?.(p.index) ?? true)) : [];
    const infos = new Map<number, OcrPageInfo>();
    for (const [k, p] of scanned.entries()) {
      ocr!.signal?.throwIfAborted();
      ocr!.onPage?.(k, scanned.length);
      engine ??= await ocr!.engine();
      const { png, pixels } = pdf.renderPage(p.index, OCR_SCALE);
      const words = engine.recognize(png);
      const result = ocrPage(p, words, pixels, OCR_SCALE);
      raw[p.index] = result.page;
      infos.set(p.index, result.info);
    }
    if (scanned.length) ocr!.onPage?.(scanned.length, scanned.length);
    const pages = analyzeDocument(raw);
    for (const page of pages) {
      const info = infos.get(page.index);
      if (info) page.ocr = info;
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
      const text = blockText(block);
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
