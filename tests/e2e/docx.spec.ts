import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/** The quality report is folded by default. */
async function openReport(page: Page, testId: string) {
  const report = page.getByTestId(testId);
  if (!(await report.evaluate((e) => (e as HTMLDetailsElement).open)))
    await report.locator('summary').first().click();
}

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
  await openReport(page, 'report');
  await expect(page.getByTestId('repairs')).toContainText('D1_ROW_HEIGHT');
  // The statement journals ask for, in the manuscript's language (English here).
  await page.getByTestId('ai-statement').locator('summary').click();
  await expect(page.getByTestId('ai-statement-text')).toContainText(
    'with a test engine to translate the manuscript from Turkish into English',
  );

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

test('review step: a manual edit is applied without re-translating; bilingual review downloads', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('report-summary')).toBeVisible({ timeout: 60_000 });

  await openReport(page, 'report');
  await page.getByRole('tab', { name: /All paragraphs/ }).click();
  const heading = page.getByTestId('report').locator('li', { hasText: '1. Giriş' });
  await heading.getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByTestId('segment-editor');
  await editor.fill('1. Introduction');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByTestId('apply-edits').click();
  await expect(page.getByTestId('report-summary')).toBeVisible({ timeout: 60_000 });
  await openReport(page, 'report');
  await expect(page.getByTestId('report').getByText('Edited by you').first()).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-docx').click(),
  ]);
  const xml = await (
    await JSZip.loadAsync(readFileSync(await download.path()))
  )
    .file('word/document.xml')!
    .async('string');
  expect(xml).toContain('1. Introduction');

  const [review] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-bilingual').click(),
  ]);
  expect(review.suggestedFilename()).toBe('academic.tr-en.review.docx');
  const reviewXml = await (
    await JSZip.loadAsync(readFileSync(await review.path()))
  )
    .file('word/document.xml')!
    .async('string');
  expect(reviewXml).toContain('<w:tbl>');
  expect(reviewXml).toContain('1. Giriş');
});
