import JSZip from 'jszip';
import { LIMITS } from '../security/limits';

export type UnzipRejection =
  | { reason: 'not-zip' }
  | { reason: 'too-many-entries'; count: number }
  | { reason: 'too-large-uncompressed'; bytes: number }
  | { reason: 'zip-bomb'; entry: string; ratio: number }
  | { reason: 'macro-enabled' }
  | { reason: 'not-docx' };

export class DocxRejectedError extends Error {
  readonly rejection: UnzipRejection;
  constructor(rejection: UnzipRejection) {
    super(`DOCX rejected: ${rejection.reason}`);
    this.name = 'DocxRejectedError';
    this.rejection = rejection;
  }
}

interface CdEntry {
  name: string;
  compressed: number;
  uncompressed: number;
}

/** Reads the ZIP central directory without inflating anything. */
export function readCentralDirectory(bytes: Uint8Array): CdEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: CdEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return null;
    const nameLen = view.getUint16(p + 28, true);
    entries.push({
      compressed: view.getUint32(p + 20, true),
      uncompressed: view.getUint32(p + 24, true),
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

/** Validates the archive against SECURITY.md §3 limits before JSZip inflates anything. */
export function checkArchive(bytes: Uint8Array, kind: OfficeKind = 'docx'): void {
  const entries = readCentralDirectory(bytes);
  if (!entries) throw new DocxRejectedError({ reason: 'not-zip' });
  if (entries.length > LIMITS.docxMaxEntries) {
    throw new DocxRejectedError({ reason: 'too-many-entries', count: entries.length });
  }
  const total = entries.reduce((n, e) => n + e.uncompressed, 0);
  if (total > LIMITS.docxMaxUncompressedBytes) {
    throw new DocxRejectedError({ reason: 'too-large-uncompressed', bytes: total });
  }
  for (const e of entries) {
    const ratio = e.uncompressed / Math.max(1, e.compressed);
    if (e.uncompressed > 1024 * 1024 && ratio > LIMITS.docxMaxCompressionRatio) {
      throw new DocxRejectedError({ reason: 'zip-bomb', entry: e.name, ratio: Math.round(ratio) });
    }
  }
  if (entries.some((e) => /^(word|ppt)\/vbaProject\.bin$/i.test(e.name))) {
    throw new DocxRejectedError({ reason: 'macro-enabled' });
  }
  const main = kind === 'pptx' ? 'ppt/presentation.xml' : 'word/document.xml';
  if (!entries.some((e) => e.name === main)) throw new DocxRejectedError({ reason: 'not-docx' });
}

/** Per-part ceiling on inflated XML (central-directory sizes can lie). */
const MAX_PART_CHARS = 200 * 1024 * 1024;

export interface DocxPackage {
  zip: JSZip;
  readText(path: string): Promise<string | null>;
}

/** Word or PowerPoint: both are Office Open XML packages. */
export type OfficeKind = 'docx' | 'pptx';

/** The kind of an Office package, from its main part. */
export function officeKind(bytes: Uint8Array): OfficeKind {
  return readCentralDirectory(bytes)?.some((e) => e.name === 'ppt/presentation.xml')
    ? 'pptx'
    : 'docx';
}

export async function openDocx(bytes: Uint8Array, kind: OfficeKind = 'docx'): Promise<DocxPackage> {
  checkArchive(bytes, kind);
  const zip = await JSZip.loadAsync(bytes);
  return {
    zip,
    async readText(path) {
      const file = zip.file(path);
      if (!file) return null;
      const text = await file.async('string');
      if (text.length > MAX_PART_CHARS) {
        throw new DocxRejectedError({ reason: 'zip-bomb', entry: path, ratio: Infinity });
      }
      return text;
    },
  };
}
