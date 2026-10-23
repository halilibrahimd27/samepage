import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import JSZip from 'jszip';
import { expect, test } from './fixtures';

/**
 * Simulates the browser's page translation (Chrome wraps every translated text node in
 * <font><font>…</font></font>), so the `browser` engine can be exercised end-to-end.
 */
async function installFakeBrowserTranslation(page: Page) {
  await page.evaluate(() => {
    const map: Record<string, string> = {
      ğ: 'g',
      Ğ: 'G',
      ı: 'i',
      İ: 'I',
      ş: 's',
      Ş: 'S',
      ç: 'c',
      Ç: 'C',
      ö: 'o',
      Ö: 'O',
      ü: 'u',
      Ü: 'U',
    };
    const translateNode = (n: Text) => {
      const parent = n.parentElement;
      if (!parent || parent.closest('[translate="no"]') || parent.closest('font')) return;
      const outer = document.createElement('font');
      const inner = document.createElement('font');
      inner.textContent = (n.textContent ?? '').replace(/[ğĞıİşŞçÇöÖüÜ]/g, (c) => map[c] ?? c);
      outer.append(inner);
      n.replaceWith(outer);
    };
    const run = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      nodes.forEach(translateNode);
    };
    document.documentElement.classList.add('translated-ltr');
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((node) => {
          const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
          if (el?.closest('[data-testid="translation-sheet"] [lang]'))
            setTimeout(() => run(node), 50);
        });
      }
    }).observe(document.body, { subtree: true, childList: true });
  });
}

test('browser engine: translation sheet is harvested into a translated DOCX', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('radio', { name: /Browser translation/ })).toBeChecked();
  await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();

  await expect(page.getByTestId('translation-sheet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sheet-progress')).toContainText('Waiting');
  await installFakeBrowserTranslation(page);
  // The sheet was rendered before the fake translator existed: re-trigger on its content.
  await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="translation-sheet"] [lang]')!;
    const clone = [...sheet.childNodes];
    sheet.replaceChildren(...clone);
  });

  await expect(page.getByTestId('report-summary')).toContainText('0 untranslated', {
    timeout: 60_000,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('download-docx').click(),
  ]);
  const xml = await (
    await JSZip.loadAsync(readFileSync(await download.path()))
  )
    .file('word/document.xml')!
    .async('string');
  expect(xml).toContain('Giris');
  expect(xml).not.toContain('Giriş');
  expect(xml).toContain('<m:oMath');
});
