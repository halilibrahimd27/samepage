import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function audit(page: Page, label: string) {
  // Legacy mode merges frame results in the page itself: the default mode opens a blank page per
  // audit, which hangs under parallel load once the sandboxed DOCX preview iframe is present.
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .setLegacyMode()
    .analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

test('main screens have no serious accessibility violations', async ({ page }) => {
  await page.goto('./');
  await audit(page, 'home');
  await page.getByRole('button', { name: 'Settings' }).click();
  await audit(page, 'settings');
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('report-summary')).toBeVisible({ timeout: 60_000 });
  await audit(page, 'docx result');
  await page.goto('./#playground');
  await audit(page, 'playground');
});
