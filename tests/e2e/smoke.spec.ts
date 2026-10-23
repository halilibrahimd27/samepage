import { expect, test } from './fixtures';

test('production build loads with CSP and a live worker', async ({ page }) => {
  await page.goto('./');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('samepage');
  await expect(page.getByTestId('worker-status')).toHaveAttribute('data-state', 'ready');
});
