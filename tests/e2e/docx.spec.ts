import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test } from './fixtures';

test('DOCX is translated end-to-end with report, previews and download', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();

  await expect(page.getByTestId('report-summary')).toContainText('0 untranslated', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('repairs')).toContainText('D1_ROW_HEIGHT');

  // Both previews render inside sandboxed iframes.
  for (const label of ['Original', 'Translated']) {
    const frame = page.frameLocator(`[data-testid="preview-${label}"]`);
    await expect(frame.locator('body')).toContainText(label === 'Original' ? 'Giriş' : 'Ğırış', {
      timeout: 30_000,
    });
  }

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-docx').click(),
  ]);
  expect(download.suggestedFilename()).toBe('academic.en.docx');
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Ğırış');
  expect(xml).toContain('<m:oMath');
});
