import type { Plugin } from 'vite';
import { CSP_DIRECTIVES, HELPER_CSP_DIRECTIVES, serializeCsp } from './csp';

/**
 * Injects the CSP <meta> tag into the HTML pages of production builds only (dev uses inline
 * scripts): the app's policy, or the translation helper's own (translate.html).
 */
export function cspPlugin(): Plugin {
  return {
    name: 'samepage-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (_html, ctx) => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: serializeCsp(
              ctx.filename.endsWith('translate.html') ? HELPER_CSP_DIRECTIVES : CSP_DIRECTIVES,
            ),
          },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}
