import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TYPES = ['.pdf', '.docx', '.pptx', '.tex', '.zip', '.samepage'];

interface Manifest {
  id: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
  share_target: {
    action: string;
    method: string;
    enctype: string;
    params: { files: { name: string; accept: string[] }[] };
  };
  file_handlers: { action: string; accept: Record<string, string[]> }[];
}

/** Width × height of a PNG, from its IHDR chunk. */
const pngSize = (png: Buffer) => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

/** Opens the app once its service worker controls the page (it answers the share's POST). */
async function openControlled(page: Page) {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null)))
    await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(
    /\/samepage\/sw\.js$/,
  );
}

/**
 * Shares files as the system does ("Share → samepage"): a multipart POST to the manifest's share
 * URL. The service worker answers with a redirect to the app, which is then opened.
 */
async function share(page: Page, files: { name: string; type: string; bytes: Buffer }[]) {
  const sent = files.map((f) => ({
    name: f.name,
    type: f.type,
    base64: f.bytes.toString('base64'),
  }));
  const result = await page.evaluate(async (files) => {
    const form = new FormData();
    for (const f of files) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      form.append('files', new File([bytes], f.name, { type: f.type }));
    }
    const response = await fetch('share-target', { method: 'POST', body: form });
    return { redirected: response.redirected, url: response.url };
  }, sent);
  expect(result.redirected).toBe(true);
  expect(result.url).toMatch(/\/samepage\/\?share=[0-9a-z]+-[0-9a-f]{8}$/);
  await page.goto(result.url);
  // The marker is removed at once: a reload does not look for the files again.
  await expect(page).not.toHaveURL(/share=/);
}

const academic = () => ({
  name: 'academic.docx',
  type: DOCX,
  bytes: readFileSync('tests/corpus/docx/academic.docx'),
});

test('the manifest makes samepage installable, a share target and a file handler', async ({
  page,
  request,
}) => {
  const response = await request.get('manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as Manifest;
  expect(manifest.id).toBe('/samepage/');
  expect(manifest.share_target).toMatchObject({
    action: 'share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
  });
  expect(manifest.share_target.params.files[0]!.accept).toEqual(expect.arrayContaining(TYPES));
  expect(manifest.file_handlers[0]!.action).toBe('./');
  expect(Object.values(manifest.file_handlers[0]!.accept).flat()).toEqual(
    expect.arrayContaining(TYPES),
  );

  const pngs = manifest.icons.filter((icon) => icon.type === 'image/png');
  expect(pngs.map((icon) => `${icon.sizes} ${icon.purpose}`).sort()).toEqual([
    '192x192 any',
    '512x512 any',
    '512x512 maskable',
  ]);
  for (const icon of pngs) {
    const png = await request.get(icon.src);
    expect(png.headers()['content-type']).toBe('image/png');
    expect(pngSize(await png.body())).toBe(icon.sizes);
  }

  await page.goto('./');
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(pngSize(await (await request.get(new URL(touchIcon!, page.url()).href)).body())).toBe(
    '180x180',
  );
  // Chromium reads the manifest without a complaint, keeps the app's identity (the start URL, as
  // before the id was set) and posts shares where the service worker takes them.
  const cdp = await page.context().newCDPSession(page);
  const parsed = await cdp.send('Page.getAppManifest');
  expect(parsed.errors).toEqual([]);
  expect(parsed.manifest?.id).toBe(new URL('./', page.url()).href);
  expect(parsed.manifest?.shareTarget?.action).toBe(new URL('share-target', page.url()).href);
});

test('a file shared from another app opens in the workspace', async ({ page }) => {
  await openControlled(page);
  await share(page, [academic()]);
  await expect(page.getByText('academic.docx', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose another file' })).toBeVisible();
  await expect(page.getByTestId('detected-language')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('incoming-lost')).toHaveCount(0);
});

test('several shared files go to the batch', async ({ page }) => {
  await openControlled(page);
  await share(page, [
    academic(),
    {
      name: 'one-column-basic.pdf',
      type: 'application/pdf',
      bytes: readFileSync('tests/corpus/pdf/one-column-basic.pdf'),
    },
  ]);
  await expect(page.getByTestId('batch')).toBeVisible();
  const items = page.getByTestId('batch-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('academic.docx');
  await expect(items.nth(1)).toContainText('one-column-basic.pdf');
  await expect(items.nth(1).getByTestId('batch-status')).toHaveText('Ready', { timeout: 60_000 });
});

test('a share posted as a navigation, as the system does, opens the app', async ({ page }) => {
  await openControlled(page);
  const action = new URL('share-target', page.url()).href;
  // A page without the app's CSP (it forbids forms) posts the form, like the share sheet.
  await page.goto('about:blank');
  await page.setContent(
    `<form method="post" enctype="multipart/form-data" action="${action}"><input type="file" name="files" multiple></form>`,
  );
  await page.locator('input').setInputFiles([
    { name: academic().name, mimeType: DOCX, buffer: academic().bytes },
    {
      name: 'one-column-basic.pdf',
      mimeType: 'application/pdf',
      buffer: readFileSync('tests/corpus/pdf/one-column-basic.pdf'),
    },
  ]);
  await Promise.all([
    page.waitForURL(/\/samepage\/$/),
    page.locator('form').evaluate((form: HTMLFormElement) => form.submit()),
  ]);
  await expect(page.getByTestId('batch-item')).toHaveCount(2);
  await expect(page.getByTestId('batch-item').nth(0)).toContainText('academic.docx');
});

test('a shared file that cannot be opened says why, as a dropped one does', async ({ page }) => {
  const notes = { name: 'notes.txt', type: 'text/plain', bytes: Buffer.from('just some notes') };
  await openControlled(page);
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: notes.name, mimeType: notes.type, buffer: notes.bytes });
  const dropped = await page.getByRole('alert').textContent();
  expect(dropped).toContain('not a PDF, DOCX or PPTX');

  await share(page, [notes]);
  await expect(page.getByText('notes.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(dropped!.trim());
});

test('a share whose files are gone is reported, not ignored', async ({ page }) => {
  await openControlled(page);
  await page.goto('./?share=mh2x9k3c-1f3a9b2c');
  await expect(page.getByTestId('incoming-lost')).toContainText('could not be received');
  await expect(page).not.toHaveURL(/share=/);
  await expect(page.getByTestId('file-input')).toHaveCount(1);
});
