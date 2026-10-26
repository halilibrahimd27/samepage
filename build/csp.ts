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

/**
 * Translation helper page (translate.html, ADR-021): Google's website translator runs here, only
 * when the user translates with Google. Its loader needs inline script; the page holds no data
 * and renders document text through DOM APIs only.
 */
export const HELPER_CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    'https://translate.google.com',
    'https://translate.googleapis.com',
    'https://translate-pa.googleapis.com',
    'https://www.gstatic.com',
  ],
  'style-src': [
    "'self'",
    "'unsafe-inline'",
    'https://translate.googleapis.com',
    'https://www.gstatic.com',
  ],
  'img-src': [
    "'self'",
    'data:',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://fonts.gstatic.com',
    'https://translate.google.com',
    'https://translate.googleapis.com',
  ],
  'connect-src': ['https://translate.googleapis.com', 'https://translate-pa.googleapis.com'],
  'frame-src': ["'self'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};
