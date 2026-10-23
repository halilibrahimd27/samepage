/** Redacts API-key-like strings from any text shown to the user or logged (SECURITY.md §4). */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-…[redacted]')
    .replace(/(authorization|x-api-key)\s*[:=]\s*\S+/gi, '$1: [redacted]');
}
