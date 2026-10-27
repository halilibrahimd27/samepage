import { Document, Packer, Paragraph, TextRun } from 'docx';
import { expect, test } from './fixtures';

/** A Turkish DOCX with field terms and a tool name set in a code font. */
async function termsDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun('Bu çalışmada makine öğrenmesi yöntemleri ile birlikte güvenlik için '),
              new TextRun({ text: 'bandit', font: 'Courier New' }),
              new TextRun(' adlı araç kullanılmış ve bütün paketler tek tek incelenmiştir.'),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun(
                'Rastgele orman modeli, makine öğrenmesi literatüründe sıkça kullanılan bir ' +
                  'yöntemdir. Bu modelin sonuçları ile diğer yöntemlerin sonuçları arasındaki ' +
                  'fark istatistiksel olarak anlamlı bulunmuştur.',
              ),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

test('terms found in the document are offered for the glossary', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('file-input').setInputFiles({
    name: 'terms.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await termsDocx(),
  });
  await expect(page.getByTestId('detected-language')).toContainText('Turkish', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('term-suggestion-count')).toContainText('4 suggested', {
    timeout: 30_000,
  });
  await page.getByText('Glossary', { exact: false }).first().click();

  const box = page.getByTestId('term-suggestions');
  await expect(box).toContainText('bandit');
  await expect(box).toContainText('kept as is');
  await expect(box).toContainText('makine öğrenmesi');
  await expect(box).toContainText('machine learning');
  await expect(box).toContainText('statistically significant');

  await box.getByRole('checkbox', { name: /rastgele orman/ }).uncheck();
  await page.getByTestId('add-term-suggestions').click();

  // The three accepted terms are now glossary entries; the declined one stays a suggestion.
  await expect(page.getByLabel('Source term')).toHaveCount(3);
  await expect(page.getByTestId('term-suggestion-count')).toContainText('1 suggested');
  await expect(page.getByLabel('Translation', { exact: true }).first()).not.toHaveValue('');
});
