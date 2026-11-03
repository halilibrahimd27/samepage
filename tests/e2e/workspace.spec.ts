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
  await expect(page.getByText('Makalenizi çevirin. Her anlam korunur.')).toBeVisible();
  await expect(page.getByTestId('privacy-pseudo')).toHaveText('Cihazda');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
});

test('polishing flagged sentences with Claude asks for the user’s own key', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/one-column-basic.pdf');
  await expect(page.getByTestId('thumbnail')).toBeVisible({ timeout: 30_000 });
  // Offered with the default engine (Google) under "Engine and quality", off until chosen.
  await page.getByText('Engine and quality').click();
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

test('flagged sentences can be polished free by Chrome’s own model where it writes the language', async ({
  page,
}) => {
  // Chrome's Prompt API, as Chrome 156 answers: English it writes, Turkish it does not.
  await page.addInitScript(() => {
    (globalThis as { LanguageModel?: unknown }).LanguageModel = {
      availability: (o: { expectedOutputs?: { languages: string[] }[] }) =>
        Promise.resolve(
          o.expectedOutputs?.[0]?.languages[0] === 'en' ? 'available' : 'unavailable',
        ),
      create: () => Promise.reject(new Error('not in this test')),
    };
  });
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/one-column-basic.pdf');
  await expect(page.getByTestId('thumbnail')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Engine and quality').click();
  await page.getByTestId('polish-toggle').check();
  await page.getByLabel('Target language', { exact: true }).selectOption('en');
  await page.getByTestId('polish-on-device').check();
  // No key asked for: the model is the browser's own.
  await expect(page.getByLabel('Anthropic API key', { exact: true })).toBeHidden();
  await expect(page.getByTestId('engine-options').locator('summary')).toContainText('+ Chrome AI');
  // Into Turkish Chrome's model does not write: only Claude is offered.
  await page.getByLabel('Target language', { exact: true }).selectOption('tr');
  await page.getByLabel('Source language', { exact: true }).selectOption('en');
  await expect(page.getByTestId('polish-with')).toBeHidden();
  await expect(page.getByLabel('Anthropic API key', { exact: true })).toBeVisible();
});
