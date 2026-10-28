import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('a PDF handed over by the browser extension opens like a dropped one', async ({ page }) => {
  await page.goto('./');
  const base64 = readFileSync('tests/corpus/pdf/smoke-2pages.pdf').toString('base64');
  // What extension/background.js runs in the samepage tab.
  await page.evaluate(
    (data) =>
      window.postMessage(
        { type: 'samepage:file', name: 'paper.pdf', base64: data },
        window.location.origin,
      ),
    base64,
  );
  await expect(page.getByTestId('page-count')).toContainText('2 pages', { timeout: 30_000 });
  await expect(page.getByText('paper.pdf')).toBeVisible();
});

test('malformed hand-over messages are ignored', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => {
    const origin = window.location.origin;
    window.postMessage({ type: 'samepage:file', name: 'x.pdf', base64: 42 }, origin);
    window.postMessage({ type: 'other', name: 'y.pdf', base64: 'JVBERi0=' }, origin);
    window.postMessage({ type: 'samepage:file', name: 'z.pdf', base64: '%%%not base64' }, origin);
  });
  await page.waitForTimeout(500);
  for (const name of ['x.pdf', 'y.pdf', 'z.pdf']) await expect(page.getByText(name)).toHaveCount(0);
  await expect(page.getByTestId('file-input')).toBeAttached();
});
