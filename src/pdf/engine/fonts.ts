import { readFaceMetrics, type FaceMetrics } from '../typeset/fontMetrics';
import { FACE_FILES, LAZY_FILES, type FaceKey, type Measurer } from '../typeset/types';
import { loadMupdf, type MupdfModule } from './mupdf';

type MupdfFont = InstanceType<MupdfModule['Font']>;

export interface LoadedFaces extends Measurer {
  /** MuPDF font objects for the writer (owned by this set; call destroy()). */
  font(face: FaceKey): MupdfFont;
  bytes(face: FaceKey): Uint8Array;
  /** Fetches the on-demand faces (math symbols) if any of `text` is missing from the others. */
  ensure(text: string): Promise<void>;
  destroy(): void;
}

/**
 * Loads the bundled Noto faces lazily (only the files that are asked for) and measures text with
 * MuPDF's glyph advances. `fetchFont` returns the bytes of a file in public/fonts.
 */
export async function loadFaces(
  fetchFont: (file: string) => Promise<Uint8Array>,
): Promise<LoadedFaces> {
  const mupdf = await loadMupdf();
  const fonts = new Map<
    string,
    { font: MupdfFont; bytes: Uint8Array; metrics: FaceMetrics; advances: Map<number, number> }
  >();
  const add = async (file: string) => {
    const bytes = await fetchFont(file);
    fonts.set(file, {
      font: new mupdf.Font(file.replace(/\.ttf$/, ''), bytes),
      bytes,
      metrics: readFaceMetrics(bytes),
      advances: new Map(),
    });
  };
  const files = [...new Set(Object.values(FACE_FILES))].filter((f) => !LAZY_FILES.has(f)).sort();
  await Promise.all(files.map(add));
  const get = (face: FaceKey) => fonts.get(FACE_FILES[face])!;
  const advance = (face: FaceKey, cp: number) => {
    const f = get(face);
    let a = f.advances.get(cp);
    if (a === undefined) {
      const gid = f.font.encodeCharacter(cp);
      a = gid > 0 ? f.font.advanceGlyph(gid) : 0;
      f.advances.set(cp, a);
    }
    return a;
  };
  return {
    width(text, face, size) {
      let em = 0;
      for (const ch of text) em += advance(face, ch.codePointAt(0)!);
      return em * size;
    },
    covers(text, face) {
      if (!fonts.has(FACE_FILES[face])) return false;
      const f = get(face).font;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp > 0x20 && cp !== 0xa0 && cp !== 0x200b && cp !== 0xad && f.encodeCharacter(cp) === 0)
          return false;
      }
      return true;
    },
    metrics: (face) => get(face).metrics,
    font: (face) => get(face).font,
    bytes: (face) => get(face).bytes,
    async ensure(text) {
      const lazy = [...LAZY_FILES].filter((f) => !fonts.has(f));
      if (!lazy.length) return;
      const base = files.map((f) => fonts.get(f)!.font);
      for (const ch of new Set(text)) {
        const cp = ch.codePointAt(0)!;
        if (cp <= 0x20 || base.some((f) => f.encodeCharacter(cp) !== 0)) continue;
        for (const file of lazy.sort()) await add(file);
        return;
      }
    },
    destroy() {
      for (const f of fonts.values()) f.font.destroy();
      fonts.clear();
    },
  };
}
