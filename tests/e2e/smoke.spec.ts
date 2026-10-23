import { expect, test } from '@playwright/test';

test('production build loads', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('samepage');
});
