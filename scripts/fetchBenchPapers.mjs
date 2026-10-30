// Downloads the open-access papers of the structure benchmark (tests/bench/papers.json) into
// tests/private/bench/, which is not part of the repository: node scripts/fetchBenchPapers.mjs
// The papers are read as untrusted data by `npm run bench`; nothing in them is executed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DIR = 'tests/private/bench';
const papers = JSON.parse(readFileSync('tests/bench/papers.json', 'utf8'));
mkdirSync(DIR, { recursive: true });

let failed = 0;
for (const { slug, url } of papers) {
  const file = `${DIR}/${slug}.pdf`;
  if (existsSync(file)) continue;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (samepage structure benchmark)',
        Accept: 'application/pdf,*/*',
      },
      redirect: 'follow',
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
      // HAL and Springer check for a browser first: save the PDF from one under the same name.
      throw new Error(`HTTP ${response.status}, not a PDF: open it in a browser, save as ${file}`);
    writeFileSync(file, bytes);
    console.log(`${slug}: ${(bytes.length / 1024).toFixed(0)} KB`);
  } catch (error) {
    failed++;
    console.warn(`${slug}: ${error instanceof Error ? error.message : String(error)} (${url})`);
  }
}
console.log(failed ? `${failed} paper(s) could not be downloaded` : 'all papers are there');
