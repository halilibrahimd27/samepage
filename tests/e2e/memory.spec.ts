import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** A colleague's memory from another tool: region codes, and one unit without a translation. */
const TMX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE tmx SYSTEM "tmx14.dtd">
<tmx version="1.4">
  <header creationtool="OmegaT" creationtoolversion="6.0" segtype="paragraph" o-tmf="OmegaT TMX" adminlang="EN-US" srclang="tr-TR" datatype="plaintext"/>
  <body>
    <tu changedate="20260101T120000Z">
      <tuv xml:lang="tr-TR"><seg>1. Giriş</seg></tuv>
      <tuv xml:lang="en-US"><seg>1. Introduction</seg></tuv>
    </tu>
    <tu><tuv xml:lang="tr-TR"><seg>Yalnız</seg></tuv></tu>
  </body>
</tmx>`;

/** The quality report is folded by default. */
async function openReport(page: Page) {
  const report = page.getByTestId('report');
  if (!(await report.evaluate((e) => (e as HTMLDetailsElement).open)))
    await report.locator('summary').first().click();
}

test('an imported memory translates its paragraph, is reported, learns a correction and exports as TMX', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await expect(page.getByTestId('memory-count')).toHaveText(
    '0 entries · 0 your corrections · 0 imported',
  );
  await page.getByTestId('memory-file').setInputFiles({
    name: 'colleague.tmx',
    mimeType: 'application/x-tmx+xml',
    buffer: Buffer.from(TMX),
  });
  await expect(page.getByTestId('memory-status')).toHaveText(
    'Entries imported: 1. 1 units could not be read and were skipped.',
  );
  await expect(page.getByTestId('memory-count')).toHaveText(
    '1 entries · 0 your corrections · 1 imported',
  );
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByTestId('report-summary')).toContainText('0 untranslated', {
    timeout: 60_000,
  });
  // Said in the folded report's line, and on the paragraph.
  await expect(page.getByTestId('memory-used')).toHaveText('Translation memory: 1');
  await openReport(page);
  const heading = page.getByTestId('report').locator('li', { hasText: '1. Giriş' });
  await expect(heading).toContainText('From your translation memory');
  await expect(heading).toContainText('1. Introduction');
  await expect(heading).toContainText('FROM_MEMORY');

  const docx = async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('download-docx').click(),
    ]);
    return (await JSZip.loadAsync(readFileSync(await download.path())))
      .file('word/document.xml')!
      .async('string');
  };
  const xml = await docx();
  expect(xml).toContain('1. Introduction');
  // The test engine's own text is in the document ("Bulgular" in look-alike letters), but it
  // never goes into the memory.
  expect(xml).toContain('Bülğülår');

  // A correction in the review step goes into the memory.
  await page.getByRole('tab', { name: /All paragraphs/ }).click();
  const findings = page.getByTestId('report').locator('li', { hasText: '2. Bulgular' });
  await findings.getByRole('button', { name: 'Edit' }).click();
  await page.getByTestId('segment-editor').fill('2. Findings');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByTestId('apply-edits').click();
  await expect(page.getByTestId('report-summary')).toBeVisible({ timeout: 60_000 });
  expect(await docx()).toContain('2. Findings');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('memory-count')).toHaveText(
    '2 entries · 1 your corrections · 1 imported',
  );
  const [tmx] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('memory-export').click(),
  ]);
  expect(tmx.suggestedFilename()).toBe('translation-memory.tmx');
  const exported = readFileSync(await tmx.path(), 'utf8');
  expect(exported).toContain('creationtool="samepage"');
  expect(exported).toContain('<tuv xml:lang="en"><seg>1. Introduction</seg></tuv>');
  expect(exported).toContain('<tuv xml:lang="en"><seg>2. Findings</seg></tuv>');
  expect(exported).toContain('<prop type="x-samepage-origin">imported</prop>');
  expect(exported).toContain('<prop type="x-samepage-origin">manual</prop>');
  expect(exported).not.toContain('Bülğülår');
  expect(exported).not.toContain('~');

  // Cleared only after a confirmation.
  await page.getByRole('button', { name: 'Clear translation memory' }).click();
  await expect(page.getByTestId('memory-count')).toContainText('2 entries');
  await page.getByTestId('memory-clear-confirm').click();
  await expect(page.getByTestId('memory-status')).toHaveText('Translation memory cleared.');
  await expect(page.getByTestId('memory-count')).toHaveText(
    '0 entries · 0 your corrections · 0 imported',
  );
});

test('a file that is no translation memory is refused with a message', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('memory-file').setInputFiles({
    name: 'notes.tmx',
    mimeType: 'application/x-tmx+xml',
    buffer: Buffer.from('<?xml version="1.0"?><notes><p>hello</p></notes>'),
  });
  await expect(page.getByTestId('memory-status')).toHaveText(
    'This file could not be read as a TMX translation memory.',
  );
});
