// Renders the app icons in public/icons/ from public/favicon.svg with Playwright's Chromium.
// Run after changing the favicon: node scripts/icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SVG = readFileSync(new URL('../public/favicon.svg', import.meta.url));
const OUT = new URL('../public/icons/', import.meta.url);
/** The manifest's background colour. */
const PAPER = '#f8fafc';

/**
 * Each icon: its side in pixels, the share of the side the drawing takes and the background
 * (none: transparent).
 */
const ICONS = [
  { name: 'icon-192.png', size: 192, scale: 1 },
  { name: 'icon-512.png', size: 512, scale: 1 },
  // The platform cuts a maskable icon to its own shape: the drawing stays inside the safe zone
  // (a circle of 40 % of the side around the centre; the drawing's corners reach 53 % at full size).
  { name: 'icon-maskable-512.png', size: 512, scale: 0.72, background: PAPER },
  // iOS fills transparency with black and rounds the corners itself.
  { name: 'apple-touch-icon.png', size: 180, scale: 0.8, background: PAPER },
];

const src = `data:image/svg+xml;base64,${SVG.toString('base64')}`;
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
for (const icon of ICONS) {
  const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
  const side = Math.round(icon.size * icon.scale);
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;width:${icon.size}px;height:${icon.size}px;background:${icon.background ?? 'transparent'}"><img src="${src}" width="${side}" height="${side}"></body>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  writeFileSync(
    new URL(icon.name, OUT),
    await page.screenshot({ omitBackground: !icon.background }),
  );
  await page.close();
  console.log(`public/icons/${icon.name}`);
}
await browser.close();
