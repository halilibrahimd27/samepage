import { describe, expect, it } from 'vitest';
import {
  glossariesToPack,
  parseTermbaseCsv,
  readGlossaryFile,
  termbaseToCsv,
} from '../../src/core/glossary/pack';

const trEn = { source: 'tr', target: 'en' };
const TBX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE martif SYSTEM "TBXcoreStructV02.dtd">
<martif type="TBX" xml:lang="en"><text><body>
  <termEntry id="c1">
    <langSet xml:lang="tr"><tig><term>güven aralığı</term></tig></langSet>
    <langSet xml:lang="en"><tig><term>confidence interval</term></tig></langSet>
    <langSet xml:lang="de-DE"><tig><term>Konfidenzintervall</term></tig></langSet>
  </termEntry>
  <termEntry id="c2">
    <langSet xml:lang="en"><tig><term>randomized controlled trial</term></tig></langSet>
    <langSet xml:lang="de"><tig><term>randomisierte kontrollierte Studie</term></tig></langSet>
  </termEntry>
</body></text></martif>`;

describe('glossary packs (P9.9)', () => {
  it('reads a spreadsheet with a column per language for any of its pairs', () => {
    const csv = 'tr,en,de,note\ngüven aralığı,confidence interval,Konfidenzintervall,istatistik\n';
    expect(readGlossaryFile(csv, trEn)).toEqual({
      entries: [{ source: 'güven aralığı', target: 'confidence interval', note: 'istatistik' }],
      languages: ['tr', 'en', 'de'],
    });
    expect(readGlossaryFile(csv, { source: 'de', target: 'tr' }).entries).toEqual([
      { source: 'Konfidenzintervall', target: 'güven aralığı', note: 'istatistik' },
    ]);
    // Tab-separated, region codes and an empty cell.
    const tsv = 'tr-TR\ten-GB\nyöntem\tmethod\nboş\t\n';
    expect(readGlossaryFile(tsv, trEn).entries).toEqual([{ source: 'yöntem', target: 'method' }]);
  });

  it('still reads a plain source,target,note file as the pair’s own', () => {
    expect(readGlossaryFile('source,target,note\nyöntem,method,\n', trEn)).toEqual({
      entries: [{ source: 'yöntem', target: 'method' }],
    });
    expect(parseTermbaseCsv('source,target\na,b\n')).toBeNull();
  });

  it('reads TBX files (IATE exports), ignoring their DOCTYPE', () => {
    const { entries, languages } = readGlossaryFile(TBX, trEn);
    expect(languages).toEqual(['tr', 'en', 'de']);
    expect(entries).toEqual([{ source: 'güven aralığı', target: 'confidence interval' }]);
    expect(readGlossaryFile(TBX, { source: 'en', target: 'de' }).entries).toHaveLength(2);
  });

  it('joins the glossaries of several pairs into concepts and writes them back', () => {
    const pack = glossariesToPack([
      {
        pair: { source: 'tr', target: 'de' },
        entries: [{ source: 'güven aralığı', target: 'Konfidenzintervall' }],
      },
      {
        pair: trEn,
        entries: [
          { source: 'Güven aralığı', target: 'confidence interval' },
          { source: 'yöntem', target: 'method' },
        ],
      },
    ]);
    expect(pack.languages).toEqual(['tr', 'de', 'en']);
    expect(pack.rows).toEqual([
      { terms: { tr: 'güven aralığı', de: 'Konfidenzintervall', en: 'confidence interval' } },
      { terms: { tr: 'yöntem', en: 'method' } },
    ]);
    const csv = termbaseToCsv(pack);
    expect(csv.split('\n')[0]).toBe('tr,de,en,note');
    expect(readGlossaryFile(csv, { source: 'de', target: 'en' }).entries).toEqual([
      { source: 'Konfidenzintervall', target: 'confidence interval' },
    ]);
  });
});
