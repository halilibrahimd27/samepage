import type { FaceMetrics } from './fontMetrics';

export type Family = 'serif' | 'sans' | 'mono';
export type FaceKey = `${Family}-${'regular' | 'bold' | 'italic' | 'bolditalic'}`;

export const FACE_FILES: Record<FaceKey, string> = {
  'serif-regular': 'NotoSerif-Regular.ttf',
  'serif-bold': 'NotoSerif-Bold.ttf',
  'serif-italic': 'NotoSerif-Italic.ttf',
  'serif-bolditalic': 'NotoSerif-BoldItalic.ttf',
  'sans-regular': 'NotoSans-Regular.ttf',
  'sans-bold': 'NotoSans-Bold.ttf',
  'sans-italic': 'NotoSans-Italic.ttf',
  'sans-bolditalic': 'NotoSans-BoldItalic.ttf',
  // Noto Sans Mono has no italics: italic mono text uses the upright faces.
  'mono-regular': 'NotoSansMono-Regular.ttf',
  'mono-bold': 'NotoSansMono-Bold.ttf',
  'mono-italic': 'NotoSansMono-Regular.ttf',
  'mono-bolditalic': 'NotoSansMono-Bold.ttf',
};

export function faceKey(family: Family, bold: boolean, italic: boolean): FaceKey {
  return `${family}-${bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'regular'}`;
}

/**
 * Glyph metrics provider used by the pure typesetter. Implemented over MuPDF fonts in the
 * worker (src/pdf/engine/fonts.ts) and in Node tests.
 */
export interface Measurer {
  /** Advance width of `text` in points. */
  width(text: string, face: FaceKey, size: number): number;
  /** True when every character of `text` has a glyph in `face`. */
  covers(text: string, face: FaceKey): boolean;
  metrics(face: FaceKey): FaceMetrics;
}
