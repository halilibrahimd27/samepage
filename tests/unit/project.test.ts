import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { translateSegments } from '../../src/core/pipeline/translate';
import {
  parseManifest,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  type ProjectManifest,
} from '../../src/core/project';
import { readProjectFile, writeProjectFile } from '../../src/core/projectFile';
import { createPseudoEngine } from '../../src/engines/pseudo';

const manifest = (): ProjectManifest => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  file: { name: 'paper.pdf', kind: 'pdf' },
  pair: { source: 'tr', target: 'en' },
  engine: { id: 'browser' },
  options: {
    fidelityCheck: true,
    localCitations: false,
    translateReferences: false,
    translateMetadata: true,
    pageRange: { from: 0, to: 3 },
  },
  glossary: [{ source: 'güven aralığı', target: 'confidence interval' }],
  edits: { 'Bir tümce.': 'A corrected sentence.' },
  translations: {
    'Bir tümce.': {
      text: 'A sentence.',
      untranslated: false,
      issues: [{ code: 'MEANING_DRIFT', severity: 'warning', detail: 'minor: tense' }],
      findings: [],
      notes: [],
      back: 'Bir cümle.',
    },
  },
});

describe('project files (P9.5)', () => {
  it('reads back what it writes', async () => {
    const source = new TextEncoder().encode('%PDF-1.7 fake');
    const bytes = await writeProjectFile(manifest(), source);
    const opened = await readProjectFile(bytes);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.manifest).toEqual(manifest());
    expect([...opened.source]).toEqual([...source]);
    // The same project gives the same file.
    expect([...(await writeProjectFile(manifest(), source))]).toEqual([...bytes]);
  });

  it('never keeps an API key: the manifest has no place for one', () => {
    const withKey = { ...manifest(), engine: { id: 'anthropic', apiKey: 'placeholder' } };
    expect(parseManifest(withKey)?.engine).toEqual({ id: 'anthropic' });
  });

  it('rejects manifests that are not exactly right', () => {
    const bad = (patch: Record<string, unknown>) => parseManifest({ ...manifest(), ...patch });
    expect(parseManifest(manifest())).not.toBeNull();
    expect(bad({ format: 'other' })).toBeNull();
    expect(bad({ version: 2 })).toBeNull();
    expect(bad({ file: { name: '../../etc/passwd', kind: 'pdf' } })).toBeNull();
    expect(bad({ file: { name: 'a.exe', kind: 'exe' } })).toBeNull();
    expect(bad({ pair: { source: 'tr', target: 'English' } })).toBeNull();
    expect(bad({ engine: { id: 'deepl' } })).toBeNull();
    expect(bad({ edits: { a: 1 } })).toBeNull();
    expect(bad({ glossary: [{ source: 'a' }] })).toBeNull();
    expect(bad({ options: { ...manifest().options, pageRange: { from: 3, to: 1 } } })).toBeNull();
    expect(
      bad({ translations: { a: { text: 'x', untranslated: false, issues: [{ code: '<b>' }] } } }),
    ).toBeNull();
  });

  it('keeps a "__proto__" source text as plain data', () => {
    const json = JSON.parse(
      `{"translations":{"__proto__":{"text":"x","untranslated":false,"issues":[],"findings":[],"notes":[]}}}`,
    ) as Record<string, unknown>;
    const parsed = parseManifest({ ...manifest(), translations: json.translations });
    expect(parsed?.translations['__proto__']?.text).toBe('x');
    expect(({} as Record<string, unknown>).text).toBeUndefined();
  });

  it('refuses archives that are not projects or that hide a bomb', async () => {
    const other = new JSZip();
    other.file('word/document.xml', '<w:document/>');
    const notProject = await other.generateAsync({ type: 'uint8array' });
    expect(await readProjectFile(notProject)).toEqual({ ok: false, reason: 'not-project' });

    const bomb = new JSZip();
    bomb.file('samepage.json', JSON.stringify(manifest()));
    bomb.file('source/paper.pdf', new Uint8Array(20 * 1024 * 1024));
    const zipped = await bomb.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    expect(await readProjectFile(zipped)).toEqual({ ok: false, reason: 'zip-bomb' });

    const broken = new JSZip();
    broken.file('samepage.json', '{"format":"samepage-project"');
    const invalid = await broken.generateAsync({ type: 'uint8array' });
    expect(await readProjectFile(invalid)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('replays stored translations without calling the engine', async () => {
    const engine = createPseudoEngine({ factor: 1.35, substitute: true });
    engine.translate = () => Promise.reject(new Error('the engine was called'));
    const outcomes = await translateSegments({
      engine,
      segments: [
        { id: 's1', text: 'Bir tümce.', role: 'body' },
        { id: 's2', text: 'Yeni bir tümce.', role: 'body' },
      ],
      ctx: { pair: { source: 'tr', target: 'en' }, glossary: [], numberLocalization: false },
      signal: new AbortController().signal,
      replay: manifest().translations,
    });
    expect(outcomes[0]).toMatchObject({ id: 's1', text: 'A sentence.', back: 'Bir cümle.' });
    // A segment the project lacks is reported, not translated.
    expect(outcomes[1]).toMatchObject({ id: 's2', untranslated: true });
    expect(outcomes[1]!.issues[0]!.code).toBe('UNTRANSLATED');
  });
});
