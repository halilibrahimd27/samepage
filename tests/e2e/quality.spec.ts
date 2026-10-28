import { expect, test } from './fixtures';

test('the quality page shows the corpus scores, in the interface language', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('quality-link').click();
  await expect(page.getByTestId('quality-summary')).toContainText(
    '88 open-access papers in 17 languages',
  );
  await expect(page.getByRole('rowheader', { name: 'Turkish' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Medicine and health' })).toBeVisible();

  // The same page in German, one of the new interface languages.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Deutsch').check();
  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(page.getByTestId('quality-summary')).toContainText('88 Open-Access-Artikel');
  await expect(page.getByRole('rowheader', { name: 'Türkisch' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});
