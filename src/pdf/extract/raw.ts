import type { Rect } from '../../core/ir/types';

/** Plain-data output of the MuPDF adapter (no WASM objects cross this boundary). */
export interface RawChar {
  c: string;
  /** Baseline origin. */
  x: number;
  y: number;
  bbox: Rect;
  font: string;
  size: number;
  color: [number, number, number];
  /** Set on a badge drawn behind it (a word on a pill inside a line). */
  chip?: Chip;
}

/** A badge's colours: its fill, and its border when it has one. */
export interface Chip {
  fill: [number, number, number];
  stroke?: [number, number, number];
  /** Its box round the letters, in ems of their size: beside them, above and below the baseline. */
  box?: { pad: number; above: number; below: number };
}

export interface RawLine {
  bbox: Rect;
  dir: [number, number];
  wmode: number;
  chars: RawChar[];
}

export interface RawTextBlock {
  bbox: Rect;
  lines: RawLine[];
}

export interface RawFont {
  name: string;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
}

export interface RawPage {
  index: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  blocks: RawTextBlock[];
  images: { bbox: Rect }[];
  vectors: {
    bbox: Rect;
    isRectangle: boolean;
    isStroked: boolean;
    color: [number, number, number];
  }[];
  links: { bbox: Rect; uri: string }[];
  /** Font flags by (subset-stripped) font name. */
  fonts: Record<string, RawFont>;
}
