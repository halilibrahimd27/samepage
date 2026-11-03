import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { doiOf, officialTitles, titleIn, type TitleLookup } from '../../src/core/crossref';
import { referenceTitles } from '../../src/core/referenceTitles';
import { translateDocx } from '../../src/docx/pipeline';
import { createPseudoEngine } from '../../src/engines/pseudo';

const TURKISH = 'Nitel Araştırma Süreci: Nitel Bir Araştırma Nasıl Yapılır?';
const ENGLISH = 'The Qualitative Research Process: How to Perform a Qualitative Research?';
/** Crossref's records: a DergiPark record holds the Turkish title and the English one. */
const RECORDS: Record<string, string[]> = {
  '10.31592/aeusbed.598299': [TURKISH, ENGLISH],
  '10.1234/dil.2021': ['Türkçe metinlerde terim tutarlılığı', 'Term consistency in Turkish texts'],
};
const RECORD: TitleLookup = (dois) =>
  Promise.resolve(new Map(dois.filter((d) => d in RECORDS).map((d) => [d, RECORDS[d]!])));

describe('official reference titles from Crossref', () => {
  it('reads the DOI of an entry without the punctuation that ends it', () => {
    expect(doiOf('Dergi, 12(3), 45–67. https://doi.org/10.31592/aeusbed.598299.')).toBe(
      '10.31592/aeusbed.598299',
    );
    expect(doiOf('Lancet. doi:10.1016/S0140-6736(20)30183-5)')).toBe(
      '10.1016/s0140-6736(20)30183-5',
    );
    expect(doiOf('Yılmaz, A. (2021). Başlık. Dergi, 12, 45–67.')).toBeNull();
  });

  it('takes the record’s title written in the target language', () => {
    expect(titleIn([TURKISH, ENGLISH], 'en', 'tr')).toBe(ENGLISH);
    expect(titleIn([TURKISH], 'en', 'tr')).toBeNull();
    expect(titleIn(['<i>Homo</i> <b>sapiens</b> and the history of the species'], 'en', 'tr')).toBe(
      'Homo sapiens and the history of the species',
    );
  });

  it('gives a title the official one only for an entry with a DOI the record knows', async () => {
    const entries = [
      `Baltacı, A. (2019). ${TURKISH} Bitlis Eren Üniversitesi Sosyal Bilimler Dergisi, 8(2), 368–388. https://doi.org/10.31592/aeusbed.598299`,
      'Yılmaz, A. (2021). Türkçe metinlerde terim tutarlılığı. Dil Dergisi, 12(3), 45–67.',
    ].map((text) => ({ text, titles: referenceTitles(text) }));
    const found = await officialTitles(
      entries,
      { source: 'tr', target: 'en' },
      RECORD,
      new AbortController().signal,
    );
    expect([...found.values()]).toEqual([{ title: ENGLISH, doi: '10.31592/aeusbed.598299' }]);
    // Crossref out of reach: nothing found, nothing lost.
    const offline = await officialTitles(
      entries,
      { source: 'tr', target: 'en' },
      () => Promise.reject(new Error('offline')),
      new AbortController().signal,
    );
    expect(offline.size).toBe(0);
  });

  it('puts the official title in the brackets of a Word reference list, reported as such', async () => {
    // The corpus paper's reference list, its Turkish entry given a DOI.
    const zip = await JSZip.loadAsync(readFileSync('tests/corpus/docx/academic.docx'));
    const document = await zip.file('word/document.xml')!.async('string');
    zip.file(
      'word/document.xml',
      document.replace(
        'Dil Dergisi, 12(3), 45–67.',
        'Dil Dergisi, 12(3), 45–67. https://doi.org/10.1234/dil.2021',
      ),
    );
    const asked: string[] = [];
    const { bytes, report } = await translateDocx(await zip.generateAsync({ type: 'uint8array' }), {
      engine: createPseudoEngine({ factor: 1, substitute: true }),
      pair: { source: 'tr', target: 'en' },
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      translateComments: false,
      translateReferences: false,
      referenceTitles: true,
      titleLookup: (d, s) => {
        asked.push(...d);
        return RECORD(d, s);
      },
      translateMetadata: false,
      signal: new AbortController().signal,
    });
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    // Only the DOI is asked for.
    expect(asked).toEqual(['10.1234/dil.2021']);
    expect(xml).toContain(
      'Türkçe metinlerde terim tutarlılığı [Term consistency in Turkish texts]',
    );
    const entry = report.segments.find((s) => s.source.startsWith('Yılmaz'))!;
    expect(entry.issues.map((i) => i.code)).toContain('OFFICIAL_TITLE');
  });
});
