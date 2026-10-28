// Builds src/app/quality/corpus.json for the public quality page (P9.10) from a corpus run's
// reports: node scripts/qualityData.mjs <runs-dir> <run-name>
// <runs-dir> holds one folder per paper, "<slug>.<target>/g-report.json". The papers themselves
// are not part of the repository (tests/corpus/LICENSES.md); only their scores are published.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const [dir, run] = process.argv.slice(2);
if (!dir || !run) throw new Error('usage: node scripts/qualityData.mjs <runs-dir> <run-name>');

const CODES = {
  econ: 'economics',
  mech: 'engineering',
  civil: 'engineering',
  civileng: 'engineering',
  mecheng: 'engineering',
  eng: 'engineering',
  ee: 'engineering',
  eleceng: 'engineering',
  elec: 'engineering',
  pubhealth: 'health',
  health: 'health',
  med: 'health',
  nursing: 'health',
  vetmed: 'health',
  chem: 'chemistry',
  math: 'mathematics',
  phys: 'physics',
  physics: 'physics',
  cs: 'computing',
  bio: 'biology',
  agro: 'biology',
  law: 'law',
};
// The first corpus' slugs carry no field code.
const FIELDS = {
  'cs-analyza-uzemi': 'social',
  'de-koerperliche-aktivitaet-kinder': 'health',
  'de-rattern-fe-simulation': 'engineering',
  'es-microtuneladoras': 'engineering',
  'es-sentimientos-twitter': 'computing',
  'fr-fretting-fatigue': 'engineering',
  'fr-myopie-enfant': 'health',
  'it-imprese-familiari-meta': 'economics',
  'it-vaia-danni-forestali': 'biology',
  'nl-curriculumontwikkeling': 'social',
  'pl-fake-news': 'social',
  'pl-nagniatanie-numeryczna': 'engineering',
  'pt-bibliometria-copalavras': 'social',
  'pt-leptospirose-espacial': 'health',
  'ru-algoritm-raspredeleniya': 'computing',
  'ru-teploperedacha-friktsiony': 'engineering',
  'tr-brayton-termodinamik': 'engineering',
  'tr-spark-duygu-analizi': 'computing',
  'uk-termichnyi-analiz-palyva': 'engineering',
};

const papers = [];
for (const name of readdirSync(dir).sort()) {
  const m = /^(([a-z]{2})-([a-z]+)[a-z0-9-]*)\.([a-z]{2})$/.exec(name);
  if (!m) continue;
  let report;
  try {
    report = JSON.parse(readFileSync(`${dir}/${name}/g-report.json`, 'utf8'));
  } catch {
    continue;
  }
  const [, slug, source, code, target] = m;
  const field = FIELDS[slug] ?? CODES[code];
  if (!field) throw new Error(`no field for ${slug}`);
  const s = report.summary;
  papers.push({
    source,
    target,
    field,
    pages: s.pages,
    units: s.units,
    score: s.score,
    keptOriginal: s.keptOriginal,
    untranslated: s.untranslated,
  });
}
writeFileSync(
  'src/app/quality/corpus.json',
  JSON.stringify({ run, engine: 'Google Translate', papers }, null, 2) + '\n',
);
console.log(`${papers.length} papers`);
