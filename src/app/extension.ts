import { LIMITS } from '../security/limits';

/** A file sent by the browser extension: {type: 'samepage:file', name, base64}. */
export function extensionFile(data: unknown): File | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'samepage:file' || typeof d.name !== 'string' || typeof d.base64 !== 'string')
    return null;
  // The largest document the app opens, in base64.
  if (d.base64.length > Math.ceil((LIMITS.pdfMaxBytes * 4) / 3) + 4) return null;
  try {
    const binary = atob(d.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const name = d.name.replace(/[\\/]/g, '_').slice(0, 200) || 'paper.pdf';
    return new File([bytes], name);
  } catch {
    return null;
  }
}
