import { test as base, expect } from '@playwright/test';

/**
 * Every e2e test automatically asserts (SECURITY.md §2, §8):
 * - zero CSP violations;
 * - no network request leaves the site origin (pseudo engine / no engine selected).
 * Tests that exercise a real provider pass the allowed origins via `allowedOrigins`.
 */
export const test = base.extend<{ allowedOrigins: string[]; guard: void }>({
  allowedOrigins: [[], { option: true }],
  guard: [
    async ({ page, baseURL, allowedOrigins }, use) => {
      const origin = new URL(baseURL ?? 'http://localhost').origin;
      const offOrigin: string[] = [];
      page.on('request', (req) => {
        const url = new URL(req.url());
        if (['data:', 'blob:'].includes(url.protocol)) return;
        if (url.origin !== origin && !allowedOrigins.includes(url.origin))
          offOrigin.push(req.url());
      });
      await page.addInitScript(() => {
        const w = window as unknown as { __cspViolations: string[] };
        w.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
        });
      });

      await use();

      const violations = await page.evaluate(
        () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
      );
      expect(violations, 'CSP violations').toEqual([]);
      expect(offOrigin, 'off-origin requests').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
