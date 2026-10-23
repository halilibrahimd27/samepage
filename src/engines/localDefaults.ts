export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The hosted build's CSP only allows local servers (ADR-004). */
export function isLocalBaseUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
