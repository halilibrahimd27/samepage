/**
 * Intermediate representation shared by the PDF and DOCX pipelines (ARCHITECTURE.md §3).
 * Geometry is in PDF points, origin top-left, y down. Ids are stable: `p{page}-b{block}`.
 */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type Role =
  | 'heading'
  | 'body'
  | 'caption'
  | 'footnote'
  | 'header'
  | 'footer'
  | 'page-number'
  | 'table-cell'
  | 'label'
  | 'formula'
  | 'code'
  | 'reference'
  | 'unknown';

export interface SpanIR {
  text: string;
  bbox: Rect;
  font: {
    name: string;
    family: 'serif' | 'sans' | 'mono';
    bold: boolean;
    italic: boolean;
    isMath: boolean;
  };
  size: number;
  color: [number, number, number];
  linkUri?: string;
  /** Mean baseline (y) of the span's characters; differs from the line's for sub/superscripts. */
  baseline?: number;
  /** Underlined (a thin rule drawn under the text in the source). */
  underline?: boolean;
}

export interface LineIR {
  bbox: Rect;
  baseline: number;
  spans: SpanIR[];
}

export interface BlockIR {
  id: string;
  bbox: Rect;
  role: Role;
  translatable: boolean;
  lines: LineIR[];
  align: 'left' | 'right' | 'center' | 'justify';
  direction: [number, number];
  columnIndex: number;
  readingOrder: number;
  chain?: {
    paragraphId: string;
    index: number;
    next?: string;
    /** This block goes on with a sentence that a display formula interrupted. */
    afterFormula?: boolean;
  };
  tableCell?: { tableId: string; row: number; col: number; cellRect: Rect };
  /** Underline rules drawn under this block's text (removed with it when translated). */
  underlines?: Rect[];
  /** Extra areas removed with this block's text (a drop cap absorbed into the paragraph). */
  extraRedact?: Rect[];
}

export interface PageIR {
  index: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  blocks: BlockIR[];
  images: { bbox: Rect }[];
  vectors: { bbox: Rect; isRectangle: boolean; isStroked: boolean }[];
  columns: Rect[];
  /** The page is a scan and its text was recognised (OCR, P8.4). */
  ocr?: {
    /** Mean word confidence, 0–100. */
    confidence: number;
    /** Recognised lines with their confidence and the paper colour under them. */
    lines: { bbox: Rect; conf: number; background: [number, number, number] }[];
  };
}

export interface DocIR {
  kind: 'pdf' | 'docx';
  sourceLang: string;
  pages: PageIR[];
  meta: { title?: string; pageCount: number };
}
