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
      // Like real page translation: the nearest translate attribute decides.
      if (
        !parent ||
        parent.closest('[translate]')?.getAttribute('translate') === 'no' ||
        parent.closest('font')
      )
        return;
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

test('browser engine (manual): translation sheet is harvested into a translated DOCX', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Translate automatically with Google').uncheck();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: /Google Translate/ }).check();
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
  // The sheet's text, and section names from the academic headings ("1. Giriş").
  expect(xml).toContain('Bu calismada');
  expect(xml).toContain('1. Introduction');
  expect(xml).not.toContain('Giriş');
  expect(xml).toContain('<m:oMath');
});

/**
 * Stand-in for Google's website translator (translate.google.com/translate_a/element.js): a
 * language select that, once set, rewrites the helper page's text like Google does.
 */
const FAKE_ELEMENT_JS = `
window.google = { translate: { TranslateElement: function (opts, id) {
  var select = document.createElement('select');
  select.className = 'goog-te-combo';
  ['', 'en', 'de', 'tr'].forEach(function (v) { var o = document.createElement('option'); o.value = v; select.append(o); });
  document.getElementById(id).append(select);
  select.addEventListener('change', function () {
    var map = { 'ğ': 'g', 'ı': 'i', 'ş': 's', 'ç': 'c', 'ö': 'o', 'ü': 'u', 'İ': 'I', 'Ş': 'S', 'Ç': 'C', 'Ö': 'O', 'Ü': 'U', 'Ğ': 'G' };
    var run = function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach(function (n) {
        var parent = n.parentElement;
        if (!parent || parent.closest('font') || (parent.closest('[translate]') || {}).getAttribute && parent.closest('[translate]').getAttribute('translate') === 'no') return;
        var outer = document.createElement('font'); var inner = document.createElement('font');
        inner.textContent = n.textContent.replace(/[ğıışçöüİŞÇÖÜĞ]/g, function (c) { return map[c] || c; });
        outer.append(inner); n.replaceWith(outer);
      });
    };
    new MutationObserver(function (records) {
      records.forEach(function (r) { r.addedNodes.forEach(function (node) { setTimeout(function () { run(node.nodeType === 1 ? node : node.parentElement); }, 20); }); });
    }).observe(document.getElementById('sheet'), { childList: true, subtree: false });
  });
} } };
setTimeout(function () { window.gtInit(); }, 10);
`;

test.describe('browser engine (automatic)', () => {
  test.use({ allowedOrigins: ['https://translate.google.com'] });

  test('translates through the helper page without any browser menu', async ({ page }) => {
    await page.route('https://translate.google.com/**', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: FAKE_ELEMENT_JS }),
    );
    await page.goto('./');
    await expect(page.getByRole('radio', { name: /Google Translate/ })).toBeChecked();
    await page.getByTestId('file-input').setInputFiles('tests/corpus/docx/academic.docx');
    await page.getByRole('button', { name: 'Translate', exact: true }).click();
    await expect(page.getByTestId('report-summary')).toContainText('0 untranslated', {
      timeout: 60_000,
    });
    // No manual sheet was needed.
    await expect(page.getByTestId('translation-sheet')).toHaveCount(0);

    // The meaning check's back-translations can be compared paragraph by paragraph.
    await page.getByTestId('report').locator('summary').first().click();
    await page.getByRole('tab', { name: /All paragraphs/ }).click();
    const compare = page.getByTestId('back-translation').first();
    await compare.locator('summary').click();
    await expect(compare.getByTestId('back-translation-text').first()).not.toBeEmpty();
  });
});
