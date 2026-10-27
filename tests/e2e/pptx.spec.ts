import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { expect, test } from './fixtures';

test('a PowerPoint presentation is translated with its notes and charts', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  await page.getByTestId('file-input').setInputFiles('tests/corpus/pptx/talk.pptx');
  await expect(page.getByTestId('detected-language')).toContainText('Turkish', {
    timeout: 30_000,
  });
  // Only whole presentations: there is no abstract to pick from slides.
  await expect(page.getByTestId('mode-abstract')).toHaveCount(0);
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('report-summary')).toContainText('0 untranslated', {
    timeout: 60_000,
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-docx').click(),
  ]);
  expect(download.suggestedFilename()).toBe('talk.en.pptx');
  const zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).not.toContain('>Türkçe Akademik Metinlerde Anlam Kayması<');
  expect(await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')).not.toContain(
    'Konuşmaya teşekkür',
  );
});
