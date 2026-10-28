// Packs extension/ into dist-extension/samepage-extension.zip for the browser stores.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import JSZip from 'jszip';

const ROOT = 'extension';
const zip = new JSZip();
const date = new Date(Date.UTC(2000, 0, 1));
const walk = (dir) =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
for (const path of walk(ROOT))
  if (!path.endsWith('README.md')) zip.file(relative(ROOT, path), readFileSync(path), { date });
mkdirSync('dist-extension', { recursive: true });
writeFileSync(
  'dist-extension/samepage-extension.zip',
  await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
);
console.log('dist-extension/samepage-extension.zip');
