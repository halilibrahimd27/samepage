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
  await expect(page.getByRole('alert')).toContainText('not a PDF, DOCX or PPTX');

  await page.getByRole('button', { name: 'Choose another file' }).click();
  await page.getByTestId('file-input').setInputFiles(ENCRYPTED);
  await expect(page.getByRole('alert')).toContainText('password-protected', { timeout: 30_000 });
});

test('UI language and settings persist; engines show privacy badges', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('privacy-browser')).toHaveText('Text sent to Google');
  await expect(page.getByTestId('privacy-anthropic')).toHaveCount(0);
  await expect(page.getByTestId('privacy-pseudo')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Türkçe').check();
  await page.getByLabel('Test motorunu göster').check();
  await page.getByRole('button', { name: 'Kapat' }).click();

  await page.reload();
  await expect(
    page.getByText('PDF, Word ve PowerPoint belgelerini düzenini koruyarak çevirin.'),
  ).toBeVisible();
  await expect(page.getByTestId('privacy-pseudo')).toHaveText('Cihazda');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});

test('polishing flagged sentences with Claude asks for the user’s own key', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/one-column-basic.pdf');
  await expect(page.getByTestId('thumbnail')).toBeVisible({ timeout: 30_000 });
  // Offered with the default engine (Google), off until chosen.
  const toggle = page.getByTestId('polish-toggle');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.getByLabel('Anthropic API key', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('Enter your Anthropic API key first.')).toBeVisible();
  // English spelling can be chosen once Claude writes English.
  await page.getByLabel('Target language', { exact: true }).selectOption('en');
  await expect(page.getByLabel('English spelling')).toBeVisible();
});
