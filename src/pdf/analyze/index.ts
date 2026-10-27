import type { DocParagraph } from '../../core/abstract';
import type { TermText } from '../../core/glossary/detect';
import type { BlockIR, PageIR } from '../../core/ir/types';
import { openPdfForExtraction } from '../engine';
import { analyzeDocument, blockText } from './analyze';

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
  for (const page of pages) {
    for (const block of [...page.blocks].sort((a, b) => a.readingOrder - b.readingOrder)) {
      const text = blockText(block);
      const lines = block.lines.map((l) => l.spans.map((s) => s.text).join(''));
      const open = block.chain && block.chain.index > 0 && byChain.get(block.chain.paragraphId);
      if (open) {
        open.text =
          /[\p{L}]-$/u.test(open.text) && /^\p{Ll}/u.test(text)
            ? open.text.slice(0, -1) + text
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
