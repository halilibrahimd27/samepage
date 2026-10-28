import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The quality report is folded by default. */
async function openReport(page: Page) {
  const report = page.getByTestId('report');
  if (!(await report.evaluate((e) => (e as HTMLDetailsElement).open)))
    await report.locator('summary').first().click();
}

test('a saved project reopens with its translation, without translating again', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
  await page.getByTestId('file-input').setInputFiles('tests/corpus/pdf/two-column.pdf');
  await expect(page.getByTestId('page-count')).toContainText('2 pages', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  const summary = page.getByTestId('pdf-report-summary');
  await expect(summary).toContainText('translated', { timeout: 120_000 });
  const before = await summary.innerText();

  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-project').click(),
  ]);
  expect(saved.suggestedFilename()).toBe('two-column.samepage');
  const project = readFileSync(await saved.path());
  expect(project.subarray(0, 2).toString()).toBe('PK');

  // A fresh start with Google selected: reopening must not reach any engine.
  await page.reload();
  await page.getByRole('radio', { name: /Google/ }).check();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.getByTestId('file-input').setInputFiles({
    name: 'two-column.samepage',
    mimeType: 'application/octet-stream',
    buffer: project,
  });
  await expect(page.getByTestId('project-opened')).toBeVisible({ timeout: 30_000 });
  await expect(summary).toHaveText(before, { timeout: 60_000 });
  expect(requests.filter((u) => /google|translate\.html/.test(u))).toEqual([]);
});

test('a Word project reopens with its corrections applied', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  const summary = page.getByTestId('report-summary');
  await expect(summary).toContainText('0 untranslated', { timeout: 60_000 });
  // A correction, applied without translating again, is saved with the project.
  await openReport(page);
  await page.getByRole('tab', { name: /All paragraphs/ }).click();
  const heading = page.getByTestId('report').locator('li', { hasText: '1. Giriş' });
  await heading.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('segment-editor').fill('1. Introduction');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('apply-edits').click();
  await expect(page.getByTestId('apply-edits')).toHaveCount(0, { timeout: 60_000 });
  const before = await summary.innerText();
  const [saved] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('save-project').click(),
  ]);
  expect(saved.suggestedFilename()).toBe('academic.samepage');

  await page.reload();
  await page.getByTestId('file-input').setInputFiles(await saved.path());
  await expect(page.getByTestId('project-opened')).toBeVisible({ timeout: 30_000 });
  await expect(summary).toHaveText(before, { timeout: 60_000 });
  const [docx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-docx').click(),
  ]);
  const xml = await (
    await JSZip.loadAsync(readFileSync(await docx.path()))
  )
    .file('word/document.xml')!
    .async('string');
  expect(xml).toContain('1. Introduction');
});

test('a damaged project file fails gracefully', async ({ page }) => {
  await page.goto('./');
  // A ZIP whose manifest is not JSON.
  const zip = new JSZip();
  zip.file('samepage.json', '{ not json');
  await page.getByTestId('file-input').setInputFiles({
    name: 'broken.samepage',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(await zip.generateAsync({ type: 'uint8array' })),
  });
  await expect(page.getByRole('alert')).toContainText('project file could not be opened');
});
