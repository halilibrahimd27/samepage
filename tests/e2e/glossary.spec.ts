import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

test('a glossary pack is imported for the pair and every glossary exported as one', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await expect(page.getByTestId('detected-language')).toContainText('Turkish', {
    timeout: 30_000,
  });
  await page.getByText('Glossary', { exact: false }).first().click();
  // A lab's pack: Turkish, English and German columns.
  await page.getByTestId('glossary-file').setInputFiles({
    name: 'lab-pack.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'tr,en,de,note\ngüven aralığı,confidence interval,Konfidenzintervall,\nyöntem,method,Methode,\n',
    ),
  });
  await expect(page.getByTestId('glossary-imported')).toContainText('(tr, en, de): 2');
  await expect(page.getByLabel('Source term')).toHaveCount(2);

  const [pack] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('glossary-pack').click(),
  ]);
  expect(pack.suggestedFilename()).toBe('glossary-pack.csv');
  const csv = readFileSync(await pack.path(), 'utf8');
  expect(csv.split('\n')[0]).toBe('tr,en,note');
  expect(csv).toContain('güven aralığı,confidence interval');
});
