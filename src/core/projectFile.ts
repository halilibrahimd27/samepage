import JSZip from 'jszip';
import { readCentralDirectory } from '../docx/unzip';
import { LIMITS, PROJECT_MAX_BYTES } from '../security/limits';
import { parseManifest, PROJECT_MANIFEST, type ProjectManifest } from './project';

/** A project file's limits (SECURITY.md §3): one manifest, one document. */
export const PROJECT_LIMITS = {
  maxBytes: PROJECT_MAX_BYTES,
  maxManifestBytes: 64 * 1024 * 1024,
  maxEntries: 8,
} as const;

export type ProjectRejection = 'not-project' | 'too-large' | 'zip-bomb' | 'invalid';

export type OpenedProject =
  | { ok: true; manifest: ProjectManifest; source: Uint8Array }
  | { ok: false; reason: ProjectRejection };

const sourcePath = (name: string) => `source/${name}`;
// Fixed dates: the same project gives the same file.
const DATE = new Date(Date.UTC(2000, 0, 1));

/** Writes a `.samepage` file: the manifest and the source document. */
export async function writeProjectFile(
  manifest: ProjectManifest,
  source: Uint8Array,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(PROJECT_MANIFEST, JSON.stringify(manifest), { date: DATE });
  // Documents are compressed already (PDF streams, DOCX zips): stored as they are.
  zip.file(sourcePath(manifest.file.name), source, { date: DATE, compression: 'STORE' });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** Reads an untrusted `.samepage` file: sizes checked before inflating, manifest validated. */
export async function readProjectFile(bytes: Uint8Array): Promise<OpenedProject> {
  if (bytes.length > PROJECT_LIMITS.maxBytes) return { ok: false, reason: 'too-large' };
  const entries = readCentralDirectory(bytes);
  if (!entries?.some((e) => e.name === PROJECT_MANIFEST))
    return { ok: false, reason: 'not-project' };
  if (entries.length > PROJECT_LIMITS.maxEntries) return { ok: false, reason: 'invalid' };
  for (const e of entries) {
    const limit =
      e.name === PROJECT_MANIFEST ? PROJECT_LIMITS.maxManifestBytes : LIMITS.pdfMaxBytes;
    if (e.uncompressed > limit) return { ok: false, reason: 'too-large' };
    const ratio = e.uncompressed / Math.max(1, e.compressed);
    if (e.uncompressed > 1024 * 1024 && ratio > LIMITS.docxMaxCompressionRatio)
      return { ok: false, reason: 'zip-bomb' };
  }
  let manifest: ProjectManifest | null;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
    const text = await zip.file(PROJECT_MANIFEST)!.async('string');
    if (text.length > PROJECT_LIMITS.maxManifestBytes) return { ok: false, reason: 'zip-bomb' };
    manifest = parseManifest(JSON.parse(text));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!manifest) return { ok: false, reason: 'invalid' };
  const file = zip.file(sourcePath(manifest.file.name));
  if (!file) return { ok: false, reason: 'invalid' };
  const source = await file.async('uint8array');
  if (source.length > LIMITS.pdfMaxBytes) return { ok: false, reason: 'zip-bomb' };
  return { ok: true, manifest, source };
}
