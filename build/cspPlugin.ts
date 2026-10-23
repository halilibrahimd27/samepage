import type { Plugin } from 'vite';
import { CSP_DIRECTIVES, serializeCsp } from './csp';

/** Injects the CSP <meta> tag into index.html for production builds only (dev uses inline scripts). */
export function cspPlugin(): Plugin {
  return {
    name: 'samepage-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: serializeCsp(CSP_DIRECTIVES) },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}
