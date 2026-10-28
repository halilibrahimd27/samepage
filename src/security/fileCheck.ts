import { LIMITS, PROJECT_MAX_BYTES } from './limits';

/** The manifest of a `.samepage` project (core/project.ts). */
const PROJECT_MANIFEST = 'samepage.json';

export type DocKind = 'pdf' | 'docx' | 'pptx';
/** A document, or a samepage project file (P9.5). */
export type FileKind = DocKind | 'project';

export type FileRejection =
  | { reason: 'empty' }
  | { reason: 'unsupported' }
  | { reason: 'docm' }
  | { reason: 'too-large'; kind: FileKind; limitBytes: number };

export type FileCheckResult =
  { ok: true; kind: FileKind } | { ok: false; rejection: FileRejection };

/** Bytes needed from the start and the end of a file to classify it. */
export const HEAD_BYTES = 1024;
export const TAIL_BYTES = 22 + 0xffff; // ZIP end-of-central-directory record + max comment

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_LOCAL = 0x04034b50;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

function indexOfBytes(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Lists entry names from the ZIP central directory found in `tail` (the last bytes of a file
 * of `size` bytes). Returns null when the directory is not fully inside `tail`.
 */
export function zipEntryNames(tail: Uint8Array, size: number): string[] | null {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const tailStart = size - tail.length;
  let p = cdOffset - tailStart;
  if (p < 0 || cdOffset + cdSize > size) return null;
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > tail.length || view.getUint32(p, true) !== ZIP_CENTRAL) return null;
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    names.push(decoder.decode(tail.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/**
 * Classifies a file by magic bytes, not by extension (SECURITY.md §3). DOCX and PPTX are
 * recognised by their ZIP central directory (word/document.xml, ppt/presentation.xml);
 * macro-enabled files are rejected.
 * Deep checks (zip-bomb ratios, entry limits) run in the worker when the file is unzipped.
 */
export function classifyFile(
  name: string,
  size: number,
  head: Uint8Array,
  tail: Uint8Array,
): FileCheckResult {
  if (size === 0) return { ok: false, rejection: { reason: 'empty' } };
  if (/\.(docm|dotm|pptm|potm|ppsm)$/i.test(name))
    return { ok: false, rejection: { reason: 'docm' } };

  let kind: FileKind | null = null;
  if (indexOfBytes(head, PDF_MAGIC) >= 0) {
    kind = 'pdf';
  } else if (
    head.length >= 4 &&
    new DataView(head.buffer, head.byteOffset).getUint32(0, true) === ZIP_LOCAL
  ) {
    const names = zipEntryNames(tail, size);
    const office = names?.includes('word/document.xml')
      ? ('docx' as const)
      : names?.includes('ppt/presentation.xml')
        ? ('pptx' as const)
        : null;
    // A project file holds a document of its own; its manifest marks it (checked in the worker).
    if (names?.includes(PROJECT_MANIFEST)) kind = 'project';
    else if (office) {
      if (names!.some((n) => /^(word|ppt)\/vbaProject\.bin$/i.test(n))) {
        return { ok: false, rejection: { reason: 'docm' } };
      }
      kind = office;
    }
  }
  if (!kind) return { ok: false, rejection: { reason: 'unsupported' } };

  const limitBytes =
    kind === 'project'
      ? PROJECT_MAX_BYTES
      : kind === 'pdf'
        ? LIMITS.pdfMaxBytes
        : kind === 'pptx'
          ? LIMITS.pptxMaxBytes
          : LIMITS.docxMaxBytes;
  if (size > limitBytes) return { ok: false, rejection: { reason: 'too-large', kind, limitBytes } };
  return { ok: true, kind };
}

/** Reads only the head and tail of `file` and classifies it. */
export async function checkFile(file: Blob & { name: string }): Promise<FileCheckResult> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - TAIL_BYTES)).arrayBuffer());
  return classifyFile(file.name, file.size, head, tail);
}
