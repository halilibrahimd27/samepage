import { expect, test } from './fixtures';

test('a scanned PDF is recognised (OCR) and translated in the browser', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/scanned.pdf');
  await expect(page.getByTestId('scanned-notice')).toContainText('Scanned PDF', {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('pdf-report-summary')).toContainText('translated', {
    timeout: 180_000,
  });
  await page.getByTestId('pdf-report').locator('summary').first().click();
  await expect(page.getByTestId('pdf-ocr')).toContainText('mean confidence');

  // The abstract mode reads the scan too.
  await page.getByTestId('mode-abstract').click();
  await expect(page.getByTestId('abstract-title')).toHaveValue(/Anlam Kayması/, {
    timeout: 120_000,
  });
});
