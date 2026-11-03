import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test } from './fixtures';

test('several files are translated one after another and download as one .zip', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  await page
    .getByTestId('file-input')
    .setInputFiles([
      'tests/corpus/docx/academic.docx',
      'tests/corpus/pdf/one-column-basic.pdf',
      'tests/corpus/pdf/encrypted.pdf',
    ]);
  const items = page.getByTestId('batch-item');
  await expect(items).toHaveCount(3);
  // Each file is read on its own: an encrypted PDF fails alone.
  await expect(items.nth(0).getByTestId('batch-status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(items.nth(1).getByTestId('batch-status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(items.nth(2).getByTestId('batch-status')).toHaveText('Failed');

  await page.getByTestId('batch-translate').click();
  await expect(items.nth(0).getByTestId('batch-status')).toHaveText('Done', { timeout: 120_000 });
  await expect(items.nth(1).getByTestId('batch-status')).toHaveText('Done', { timeout: 120_000 });
  await expect(items.nth(0).getByTestId('batch-summary')).toContainText('translated');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('batch-download-all').click(),
  ]);
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  expect(Object.keys(zip.files).sort()).toEqual([
    'academic.en.docx',
    'one-column-basic.en.docx',
    'one-column-basic.en.pdf',
  ]);
});
