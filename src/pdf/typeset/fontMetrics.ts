/** Vertical metrics read from a TrueType/OpenType file (head, hhea, OS/2 tables). */
export interface FaceMetrics {
  unitsPerEm: number;
  /** In em units (fractions of the font size). */
  ascender: number;
  descender: number;
  xHeight: number;
  capHeight: number;
}

export function readFaceMetrics(bytes: Uint8Array): FaceMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4));
    tables.set(tag, view.getUint32(rec + 8));
  }
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const os2 = tables.get('OS/2');
  if (head === undefined || hhea === undefined) throw new Error('Not a TrueType/OpenType font');
  const upm = view.getUint16(head + 18);
  const ascender = view.getInt16(hhea + 4) / upm;
  const descender = view.getInt16(hhea + 6) / upm;
  let xHeight = 0.5;
  let capHeight = 0.7;
  if (os2 !== undefined && view.getUint16(os2) >= 2) {
    xHeight = view.getInt16(os2 + 86) / upm;
    capHeight = view.getInt16(os2 + 88) / upm;
  }
  return { unitsPerEm: upm, ascender, descender, xHeight, capHeight };
}
