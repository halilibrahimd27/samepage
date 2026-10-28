import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('a LaTeX source is translated with its commands and mathematics kept', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();
  await page.getByTestId('file-input').setInputFiles('tests/corpus/latex/paper.tex');
  await expect(page.getByTestId('detected-language')).toContainText('Turkish', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('report-summary')).toContainText('0 untranslated', {
    timeout: 60_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-docx').click(),
  ]);
  expect(download.suggestedFilename()).toBe('paper.en.tex');
  const tex = readFileSync(await download.path(), 'utf8');
  expect(tex).toContain('\\usepackage[english]{babel}');
  expect(tex).toContain('\\cite{vaswani2017,koehn2010}');
  expect(tex).toContain('\\begin{equation}');
  expect(tex).toMatch(/\\section\{\[Ğırış\]\}/);
});
