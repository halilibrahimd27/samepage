import type { PageIR } from '../../core/ir/types';
import { openPdfForExtraction } from '../engine';
import { analyzeDocument } from './analyze';

export { analyzeDocument, blockText } from './analyze';

/** Extracts and analyses up to `maxPages` pages of a PDF. */
export async function extractAndAnalyze(bytes: Uint8Array, maxPages: number): Promise<PageIR[]> {
  const pdf = await openPdfForExtraction(bytes);
  try {
    const count = Math.min(pdf.pageCount, maxPages);
    const raw = Array.from({ length: count }, (_, i) => pdf.extractPage(i));
    return analyzeDocument(raw);
  } finally {
    pdf.close();
  }
}
