import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

async function usePseudoEngine(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
}

test('title, abstract and keywords of a PDF are found, translated and downloaded', async ({
  page,
}) => {
  await usePseudoEngine(page);
  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/one-column-basic.pdf');
  await expect(page.getByTestId('page-count')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('mode-abstract').click();

  await expect(page.getByTestId('abstract-search')).toContainText('Found in the document', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('abstract-title')).toHaveValue(
    'Türkçe Akademik Metinlerde Anlam Kayması',
  );
  await expect(page.getByTestId('abstract-abstract')).toHaveValue(/^Bu çalışmada makine/);
  await page.getByTestId('abstract-keywords').fill('anlam kayması, makine çevirisi');

  await page.getByTestId('translate-abstract').click();
  const result = page.getByTestId('abstract-result');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('abstract-result-title')).not.toBeEmpty();
  await expect(page.getByTestId('abstract-result-paragraph')).toHaveCount(1);
  await expect(page.getByTestId('abstract-result-keywords')).not.toBeEmpty();
  await expect(result).toContainText('Abstract');
  await expect(result).toContainText('Keywords:');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download (.txt)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('one-column-basic.abstract.en.txt');
  const text = readFileSync(await download.path(), 'utf8');
  expect(text).toContain('\n\nAbstract\n');
  expect(text).toContain('\n\nKeywords: ');

  // Back to the whole document.
  await page.getByTestId('mode-document').click();
  await expect(page.getByRole('button', { name: 'Translate', exact: true })).toBeVisible();
});

test('an abstract can be pasted when none is recognised', async ({ page }) => {
  await usePseudoEngine(page);
  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/two-column.pdf');
  await expect(page.getByTestId('page-count')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('mode-abstract').click();
  await expect(page.getByTestId('abstract-search')).toContainText('No abstract was recognised', {
    timeout: 30_000,
  });

  await page.getByTestId('translate-abstract').click();
  await expect(page.getByRole('alert')).toContainText('Enter the abstract');

  await page
    .getByTestId('abstract-abstract')
    .fill('Bu çalışma iki paragraftan oluşur.\n\nİkinci paragraf sonuçları özetler.');
  await page.getByTestId('translate-abstract').click();
  await expect(page.getByTestId('abstract-result-paragraph')).toHaveCount(2, { timeout: 60_000 });
});
