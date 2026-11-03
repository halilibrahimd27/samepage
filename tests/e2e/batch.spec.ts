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

test('a file already in the target language goes into the other one', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the test engine').check();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Pseudo/ }).check();

  // Turkish into English is chosen; an English document goes into Turkish.
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const english = new JSZip();
  english.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  english.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const sentences = [
    'This study examines how machine translation changes the meaning of academic texts.',
    'The results show that the meaning of most sentences was kept, but some of the negations were lost.',
    'We therefore recommend that every translation is checked against its source before it is published.',
  ];
  english.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${sentences
      .map((t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`)
      .join('')}<w:sectPr/></w:body></w:document>`,
  );
  await page.getByTestId('file-input').setInputFiles([
    {
      name: 'academic.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: readFileSync('tests/corpus/docx/academic.docx'),
    },
    {
      name: 'english.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await english.generateAsync({ type: 'nodebuffer' }),
    },
  ]);
  const items = page.getByTestId('batch-item');
  await expect(items.nth(1).getByTestId('batch-status')).toHaveText('Ready', { timeout: 60_000 });
  await expect(items.nth(0).getByTestId('batch-target')).toHaveValue('en');
  await expect(items.nth(1).getByTestId('batch-target')).toHaveValue('tr');

  await page.getByTestId('batch-translate').click();
  await expect(items.nth(1).getByTestId('batch-status')).toHaveText('Done', { timeout: 120_000 });
  await expect(items.nth(1).getByRole('button', { name: /english\.tr\.docx/ })).toBeVisible();
});
