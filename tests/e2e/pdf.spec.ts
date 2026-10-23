import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('PDF is translated in the browser with report, previews and downloads', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/two-column.pdf');
  await expect(page.getByTestId('page-count')).toContainText('2 pages', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Translate', exact: true }).click();

  await expect(page.getByTestId('pdf-report-summary')).toContainText('translated', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('pdf-preview-1')).toBeVisible({ timeout: 30_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toBe('two-column.en.pdf');
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');

  const [dual] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-dual').click(),
  ]);
  expect(dual.suggestedFilename()).toBe('two-column.tr-en.dual.pdf');
});
