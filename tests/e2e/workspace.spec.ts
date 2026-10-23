import { expect, test } from './fixtures';

const PDF = 'tests/corpus/pdf/smoke-2pages.pdf';
const ENCRYPTED = 'tests/corpus/pdf/encrypted.pdf';

test('dropping a PDF shows its page count and a thumbnail', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles(PDF);
  await expect(page.getByTestId('page-count')).toContainText('2 pages', { timeout: 30_000 });
  const thumb = page.getByTestId('thumbnail');
  await expect(thumb).toBeVisible();
  expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
});

test('invalid and encrypted files fail gracefully', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles({
    name: 'fake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(page.getByRole('alert')).toContainText('not a PDF or DOCX');

  await page.getByRole('button', { name: 'Choose another file' }).click();
  await page.getByTestId('file-input').setInputFiles(ENCRYPTED);
  await expect(page.getByRole('alert')).toContainText('password-protected', { timeout: 30_000 });
});

test('UI language and settings persist; engines show privacy badges', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('privacy-anthropic')).toHaveText('Text sent to Anthropic');
  await expect(page.getByTestId('privacy-pseudo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Türkçe').check();
  await page.getByLabel('Test motorunu göster').check();
  await page.getByRole('button', { name: 'Kapat' }).click();

  await page.reload();
  await expect(page.getByText('PDF ve DOCX belgelerini düzenini koruyarak çevirin.')).toBeVisible();
  await expect(page.getByTestId('privacy-pseudo')).toHaveText('Cihazda');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});
