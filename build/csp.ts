/**
 * Content Security Policy for the hosted build (SECURITY.md §2, ADR-004).
 * GitHub Pages cannot send headers, so this is emitted as a <meta> tag in production builds.
 * Self-hosters who need another translation endpoint widen `connect-src` here — and only here.
 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'"],
  'connect-src': [
    "'self'",
    'https://api.anthropic.com',
    'http://localhost:*',
    'http://127.0.0.1:*',
  ],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

export function serializeCsp(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
