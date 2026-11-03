import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { MemoryCache } from '../../src/core/cache/cache';
import {
  fitsSource,
  MapMemory,
  MemorySession,
  type MemoryEntry,
} from '../../src/core/memory/memory';
import { baseLanguage, readTmx, tmxText, writeTmx } from '../../src/core/memory/tmx';
import { ownLanguages, translateSegments } from '../../src/core/pipeline/translate';
import { translateDocx } from '../../src/docx/pipeline';
import { createPseudoEngine } from '../../src/engines/pseudo';
import type { SegmentRequest, TranslationEngine } from '../../src/engines/types';
import { TMX_LIMITS } from '../../src/security/limits';

const trEn = { source: 'tr', target: 'en' };
const ctx = { pair: trEn, glossary: [], numberLocalization: false };
const seg = (id: string, text: string): SegmentRequest => ({ id, text, role: 'body' });
const at = Date.UTC(2026, 10, 3, 9, 15, 0);
const entry = (e: Partial<MemoryEntry> & Pick<MemoryEntry, 'source' | 'target'>): MemoryEntry => ({
  pair: trEn,
  origin: 'manual',
  updated: at,
  ...e,
});

/** A language-model-like engine that answers from a table and records what it was sent. */
function scripted(
  answers: Record<string, string>,
): TranslationEngine & { sent: string[]; checked: string[] } {
  const sent: string[] = [];
  const checked: string[] = [];
  const base = createPseudoEngine();
  return {
    ...base,
    id: 'anthropic',
    model: 'test',
    capabilities: { ...base.capabilities, glossary: true },
    maxBatchChars: 10_000,
    sent,
    checked,
    checkFidelity: (pairs) => {
      checked.push(...pairs.map((p) => p.id));
      return Promise.resolve({ findings: [] });
    },
    translate(batch) {
      sent.push(...batch.map((b) => b.text));
      return Promise.resolve(batch.map((b) => ({ id: b.id, text: answers[b.text] ?? '' })));
    },
  };
}

const TMX = (body: string, header = 'srclang="tr"') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tmx SYSTEM "tmx14.dtd">\n<tmx version="1.4"><header creationtool="x" creationtoolversion="1" segtype="sentence" o-tmf="x" adminlang="en" datatype="plaintext" ${header}/><body>${body}</body></tmx>`;

describe('TMX', () => {
  const entries: MemoryEntry[] = [
    entry({
      source: 'Bu <t1>yöntem</t1> ⟦F1⟧ ile tanımlanır⟦N1⟧.',
      target: 'This <t1>method</t1> is defined by ⟦F1⟧⟦N1⟧.',
    }),
    entry({
      source: 'A & B < C > D "tırnak" \r\nsatır\u000Bsonu',
      target: 'A & B < C > D "quote" \r\nline\u000Bend',
      origin: 'engine',
      updated: at + 1000,
    }),
    entry({ pair: { source: 'en', target: 'de' }, source: 'Method', target: 'Methode' }),
  ];

  it('writes TMX 1.4b with inline codes other tools keep, and reads it back as it was', () => {
    const tmx = writeTmx(entries, '9.9.9');
    expect(tmx).toContain('<tmx version="1.4">');
    expect(tmx).toContain('creationtool="samepage" creationtoolversion="9.9.9"');
    // Two source languages: the header says so.
    expect(tmx).toContain('srclang="*all*"');
    expect(tmx).toContain('<tu srclang="tr" creationdate="20261103T091500Z"');
    expect(tmx).toContain('<prop type="x-samepage-origin">manual</prop>');
    expect(tmx).toContain(
      '<tuv xml:lang="tr"><seg>Bu <bpt i="1" x="1">&lt;t1&gt;</bpt>yöntem<ept i="1">&lt;/t1&gt;</ept> <ph x="2" type="x-formula">⟦F1⟧</ph> ile tanımlanır<ph x="3" type="fnote">⟦N1⟧</ph>.</seg></tuv>',
    );
    // The same x for the same code in the translation, wherever it moved.
    expect(tmx).toContain('<ph x="2" type="x-formula">⟦F1⟧</ph><ph x="3" type="fnote">⟦N1⟧</ph>');
    // Escaped; a carriage return and a character XML cannot hold survive.
    expect(tmx).toContain(
      'A &amp; B &lt; C &gt; D "tırnak" &#13;\nsatır<ph type="x-samepage-char">U+000B</ph>sonu',
    );

    const read = readTmx(tmx)!;
    expect(read.skipped).toBe(0);
    expect(new Map(read.units.map((u) => [u.source, u]))).toEqual(
      new Map(
        entries.map(({ pair, source, target, updated }) => [
          source,
          { pair, source, target, updated },
        ]),
      ),
    );
  });

  it('gives the same file for the same memory, whatever the order', () => {
    expect(writeTmx([...entries].reverse(), '1')).toBe(writeTmx(entries, '1'));
    expect(writeTmx([entries[0]!], '1')).toContain('srclang="tr" datatype');
  });

  it('reads language codes with regions, TMX 1.1 attributes and several translations', () => {
    expect(baseLanguage('en-US')).toBe('en');
    expect(baseLanguage('PT_br')).toBe('pt');
    expect(baseLanguage('*all*')).toBeNull();
    const read = readTmx(
      TMX(
        `<tu><tuv xml:lang="en-US"><seg>Method</seg></tuv><tuv xml:lang="TR-tr"><seg>Yöntem</seg></tuv><tuv lang="de-DE"><seg>Methode</seg></tuv><tuv xml:lang="tr"><seg>Usul</seg></tuv></tu>`,
        'srclang="en-GB"',
      ),
    )!;
    expect(read.units).toEqual([
      { pair: { source: 'en', target: 'tr' }, source: 'Method', target: 'Yöntem' },
      { pair: { source: 'en', target: 'de' }, source: 'Method', target: 'Methode' },
    ]);
  });

  it('maps another tool’s tag pairs and typed placeholders by their x attribute', () => {
    const read = readTmx(
      TMX(
        `<tu srclang="tr" changedate="20250102T030405Z"><tuv xml:lang="tr"><seg><bpt i="1" x="7">{b}</bpt>Kalın<ept i="1">{/b}</ept> metin<ph x="9" type="fnote">{fn}</ph></seg></tuv><tuv xml:lang="en"><seg><bpt i="3" x="7">[b]</bpt>Bold<ept i="3">[/b]</ept> text<ph x="9" type="fnote">{fn}</ph></seg></tuv></tu>`,
      ),
    )!;
    expect(read).toEqual({
      units: [
        {
          pair: trEn,
          source: '<t1>Kalın</t1> metin⟦N1⟧',
          target: '<t1>Bold</t1> text⟦N1⟧',
          updated: Date.UTC(2025, 0, 2, 3, 4, 5),
        },
      ],
      skipped: 0,
    });
  });

  it('skips the units it cannot read, and counts them', () => {
    const units = [
      // One language only.
      `<tu><tuv xml:lang="tr"><seg>Yalnız</seg></tuv></tu>`,
      // No <seg>.
      `<tu><tuv xml:lang="tr"><seg>Var</seg></tuv><tuv xml:lang="en"></tuv></tu>`,
      // A placeholder the translation lost.
      `<tu><tuv xml:lang="tr"><seg>a<ph x="1">⟦F1⟧</ph></seg></tuv><tuv xml:lang="en"><seg>a</seg></tuv></tu>`,
      // Another tool's placeholder of no known type.
      `<tu><tuv xml:lang="tr"><seg>a<ph x="1">{1}</ph></seg></tuv><tuv xml:lang="en"><seg>a<ph x="1">{1}</ph></seg></tuv></tu>`,
      // An isolated code.
      `<tu><tuv xml:lang="tr"><seg>a<it pos="begin">{b}</it></seg></tuv><tuv xml:lang="en"><seg>a</seg></tuv></tu>`,
      // Text that reads as samepage's own codes.
      `<tu><tuv xml:lang="tr"><seg>&lt;t1&gt;a&lt;/t1&gt;</seg></tuv><tuv xml:lang="en"><seg>&lt;t1&gt;b&lt;/t1&gt;</seg></tuv></tu>`,
      // A "character" that is markup.
      `<tu><tuv xml:lang="tr"><seg>a<ph type="x-samepage-char">U+27E6</ph>F1⟧</seg></tuv><tuv xml:lang="en"><seg>b</seg></tuv></tu>`,
      // Unbalanced tags.
      `<tu><tuv xml:lang="tr"><seg><bpt i="1">&lt;t1&gt;</bpt>a</seg></tuv><tuv xml:lang="en"><seg>b</seg></tuv></tu>`,
      // Readable.
      `<tu><tuv xml:lang="tr"><seg>İyi</seg></tuv><tuv xml:lang="en"><seg>Good</seg></tuv></tu>`,
    ];
    const read = readTmx(TMX(units.join('')))!;
    expect(read.units).toEqual([{ pair: trEn, source: 'İyi', target: 'Good' }]);
    expect(read.skipped).toBe(units.length - 1);
  });

  it('rejects what is no TMX file, entity declarations and oversized input', () => {
    expect(readTmx('<martif/>')).toBeNull();
    expect(readTmx('<tmx version="1.4"><body><tu>')).toBeNull();
    const laughs = `<?xml version="1.0"?><!DOCTYPE tmx [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><tmx version="1.4"><header srclang="tr"/><body><tu><tuv xml:lang="tr"><seg>&b;</seg></tuv><tuv xml:lang="en"><seg>x</seg></tuv></tu></body></tmx>`;
    expect(readTmx(laughs)).toBeNull();
    const external = TMX(
      `<tu><tuv xml:lang="tr"><seg>&xxe;</seg></tuv><tuv xml:lang="en"><seg>x</seg></tuv></tu>`,
    ).replace('<!DOCTYPE tmx SYSTEM "tmx14.dtd">', '<!DOCTYPE tmx SYSTEM "file:///etc/passwd">');
    // The DOCTYPE is dropped: nothing is fetched, the reference stays text, never resolved.
    expect(readTmx(external)!.units[0]!.source).toBe('&xxe;');
    const small = { ...TMX_LIMITS, maxBytes: 200 };
    expect(readTmx(TMX('<tu/>'.repeat(100)), small)).toBeNull();

    const unit = (i: number) =>
      `<tu><tuv xml:lang="tr"><seg>s${i}</seg></tuv><tuv xml:lang="en"><seg>t${i}</seg></tuv></tu>`;
    const many = readTmx(TMX(Array.from({ length: 5 }, (_, i) => unit(i)).join('')), {
      ...TMX_LIMITS,
      maxUnits: 3,
    })!;
    expect(many.units.map((u) => u.source)).toEqual(['s0', 's1', 's2']);
    expect(many.skipped).toBe(2);
    const long = readTmx(TMX(unit(1).replace('s1', 'x'.repeat(50))), {
      ...TMX_LIMITS,
      maxSegmentChars: 20,
    })!;
    expect(long).toEqual({ units: [], skipped: 1 });
  });

  it('decodes UTF-16 files by their byte-order mark', () => {
    const text = TMX(
      `<tu><tuv xml:lang="tr"><seg>Çeviri</seg></tuv><tuv xml:lang="en"><seg>Translation</seg></tuv></tu>`,
    ).replace('UTF-8', 'UTF-16');
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) {
      le[2 + i * 2] = text.charCodeAt(i) & 0xff;
      le[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    expect(readTmx(tmxText(le))!.units[0]).toMatchObject({
      source: 'Çeviri',
      target: 'Translation',
    });
    expect(tmxText(new TextEncoder().encode(`\uFEFF${text}`))).toBe(text);
  });
});

describe('translation memory', () => {
  it('a translation fits its source when no placeholder is lost or added', () => {
    expect(fitsSource('a <t1>b</t1> ⟦F1⟧', 'x ⟦F1⟧ <t1>y</t1>')).toBe(true);
    // Formatting may be dropped, never invented.
    expect(fitsSource('a <t1>b</t1> ⟦F1⟧', 'x y ⟦F1⟧')).toBe(true);
    expect(fitsSource('a ⟦F1⟧', 'x <t1>y</t1> ⟦F1⟧')).toBe(false);
    expect(fitsSource('a ⟦F1⟧', 'x')).toBe(false);
    expect(fitsSource('a ⟦F1⟧', 'x ⟦F1⟧ ⟦F2⟧')).toBe(false);
    expect(fitsSource('a <t1>b</t1>', 'x <t1>y')).toBe(false);
    expect(fitsSource('a', '  ')).toBe(false);
  });

  it('a correction wins over the engine, an import over an older correction, and the cap keeps corrections last', async () => {
    const memory = new MapMemory(3);
    await memory.put([entry({ source: 'a', target: 'engine', origin: 'engine' })]);
    await memory.put([entry({ source: 'a', target: 'mine', updated: at + 1 })]);
    // The engine never overwrites a correction.
    await memory.put([
      entry({ source: 'a', target: 'engine again', origin: 'engine', updated: at + 2 }),
    ]);
    expect((await memory.find(trEn, ['a'])).get('a')).toMatchObject({ target: 'mine' });
    // An import older than the correction is not taken; a newer one is.
    expect(
      await memory.put([entry({ source: 'a', target: 'old', origin: 'imported', updated: at })]),
    ).toBe(0);
    expect(
      await memory.put([
        entry({ source: 'a', target: 'new', origin: 'imported', updated: at + 9 }),
      ]),
    ).toBe(1);
    expect((await memory.find(trEn, ['a'])).get('a')).toMatchObject({
      target: 'new',
      origin: 'imported',
    });

    await memory.put([
      entry({ source: 'b', target: 'B', origin: 'manual', updated: at - 50 }),
      entry({ source: 'c', target: 'C', origin: 'engine', updated: at + 50 }),
      entry({ source: 'd', target: 'D', origin: 'imported', updated: at + 60 }),
    ]);
    // Four entries for three places: the engine's goes first, however new.
    expect((await memory.all()).map((e) => e.source)).toEqual(['a', 'b', 'd']);
    await memory.put([entry({ source: 'e', target: 'E', updated: at + 70 })]);
    // Then the oldest import; corrections last.
    expect((await memory.all()).map((e) => e.source)).toEqual(['b', 'd', 'e']);
    expect(await memory.stats()).toEqual({
      entries: 3,
      manual: 2,
      imported: 1,
      pairs: [{ pair: trEn, entries: 3 }],
    });
  });

  it('exports one language pair or all of them', async () => {
    const memory = new MapMemory();
    const enDe = { source: 'en', target: 'de' };
    await memory.put([
      entry({ source: 'Yöntem', target: 'Method' }),
      entry({ pair: enDe, source: 'Method', target: 'Methode', origin: 'engine' }),
    ]);
    expect((await memory.all(enDe)).map((e) => e.target)).toEqual(['Methode']);
    expect((await memory.all()).map((e) => e.target)).toEqual(['Methode', 'Method']);
    expect((await memory.stats()).pairs).toEqual([
      { pair: enDe, entries: 1 },
      { pair: trEn, entries: 1 },
    ]);
    const tmx = writeTmx(await memory.all(enDe), '1');
    expect(tmx).toContain('srclang="en" datatype');
    expect(tmx).not.toContain('Yöntem');
  });

  it('the pipeline uses a correction instead of the engine, validates it and reports it', async () => {
    const memory = new MapMemory();
    await memory.put([
      entry({ source: 'Bu yöntem ⟦F1⟧ ile hızlıdır.', target: 'This method is fast with ⟦F1⟧.' }),
      // Imported, but a number differs: used, and the difference is reported.
      entry({
        source: 'Doğruluk 87 oldu.',
        target: 'The accuracy was 78.',
        origin: 'imported',
      }),
      // The engine's own entries are not used instead of it.
      entry({ source: 'Sonuç iyidir.', target: 'Stale engine text.', origin: 'engine' }),
      // A placeholder lost: never used.
      entry({ source: 'Bkz. ⟦U1⟧ sayfası.', target: 'See the page.' }),
    ]);
    const engine = scripted({
      'Sonuç iyidir.': 'The result is good.',
      'Bkz. ⟦U1⟧ sayfası.': 'See the ⟦U1⟧ page.',
    });
    const session = new MemorySession(memory, () => at + 5);
    const out = await translateSegments({
      engine,
      segments: [
        seg('a', 'Bu yöntem ⟦F1⟧ ile hızlıdır.'),
        seg('b', 'Doğruluk 87 oldu.'),
        seg('c', 'Sonuç iyidir.'),
        seg('d', 'Bkz. ⟦U1⟧ sayfası.'),
      ],
      ctx,
      signal: new AbortController().signal,
      cache: new MemoryCache(),
      fidelityCheck: true,
      localCitations: true,
      memory: session,
    });
    expect(engine.sent).toEqual(['Sonuç iyidir.', 'Bkz. ⟦U1⟧ sayfası.']);
    // The user's text is not read by the meaning check, so never revised by a repair.
    expect(engine.checked).toEqual(['c', 'd']);
    expect(out[0]).toMatchObject({
      text: 'This method is fast with ⟦F1⟧.',
      untranslated: false,
      cached: false,
      notes: ['memory'],
      issues: [
        {
          code: 'FROM_MEMORY',
          severity: 'info',
          detail: 'taken from the translation memory (your correction)',
        },
      ],
    });
    expect(out[1]!.issues).toEqual([
      expect.objectContaining({ code: 'NUMBER_MISMATCH', severity: 'warning' }),
      expect.objectContaining({
        code: 'FROM_MEMORY',
        detail: 'taken from the translation memory (imported)',
      }),
    ]);
    expect(out[2]).toMatchObject({ text: 'The result is good.', notes: [] });
    expect(out[3]).toMatchObject({ text: 'See the ⟦U1⟧ page.' });

    // The job done, the engine's translations are kept — never over a correction.
    await session.finish([{ pair: trEn, source: 'Doğruluk 87 oldu.', target: 'Accuracy was 87.' }]);
    const all = new Map((await memory.all()).map((e) => [e.source, e]));
    expect(all.get('Sonuç iyidir.')).toMatchObject({
      target: 'The result is good.',
      origin: 'engine',
    });
    expect(all.get('Bkz. ⟦U1⟧ sayfası.')).toMatchObject({
      target: 'See the page.',
      origin: 'manual',
    });
    expect(all.get('Doğruluk 87 oldu.')).toMatchObject({
      target: 'Accuracy was 87.',
      origin: 'manual',
    });
    expect(all.get('Bu yöntem ⟦F1⟧ ile hızlıdır.')).toMatchObject({
      origin: 'manual',
      updated: at,
    });
  });

  it('keeps nothing from the test engine nor from a job that was not finished', async () => {
    const memory = new MapMemory();
    const session = new MemorySession(memory);
    await translateSegments({
      engine: createPseudoEngine(),
      segments: [seg('a', 'Bu bir tümcedir.')],
      ctx,
      signal: new AbortController().signal,
      memory: session,
    });
    await session.finish([]);
    expect(await memory.all()).toEqual([]);

    const unfinished = new MemorySession(memory);
    await translateSegments({
      engine: scripted({ 'Bu bir tümcedir.': 'This is a sentence.' }),
      segments: [seg('a', 'Bu bir tümcedir.')],
      ctx,
      signal: new AbortController().signal,
      memory: unfinished,
    });
    expect(await memory.all()).toEqual([]);
  });

  it('finds the language a paragraph is translated from', () => {
    const own = ownLanguages(
      [
        'Bu çalışmada makine çevirisi sistemlerinin terim tutarlılığı ayrıntılı olarak incelenmiştir.',
        'This study examines how machine translation changes the meaning of academic texts.',
      ],
      'tr',
    );
    expect([...own]).toEqual([
      ['This study examines how machine translation changes the meaning of academic texts.', 'en'],
    ]);
  });

  it('a Word document takes the memory’s translation and reports where it came from', async () => {
    const input = new Uint8Array(readFileSync('tests/corpus/docx/academic.docx'));
    const options = {
      engine: createPseudoEngine({ factor: 1.35, substitute: true }),
      pair: trEn,
      glossary: [],
      numberLocalization: false,
      fidelityCheck: false,
      translateComments: false,
      translateReferences: false,
      translateMetadata: false,
      signal: new AbortController().signal,
    };
    const first = await translateDocx(input, options);
    const formula = first.report.segments.find((s) => s.source.startsWith('F-ölçütü'))!;
    expect(formula.sourceTagged).toMatch(/⟦F1⟧/);
    const giris = first.report.segments.find((s) => s.source === '1. Giriş')!;
    const memory = new MapMemory();
    await memory.put([
      entry({ source: giris.sourceTagged, target: '1. Introduction', origin: 'imported' }),
      entry({
        source: formula.sourceTagged,
        target: 'The F-measure is defined as ⟦F1⟧.',
      }),
    ]);
    const { bytes, report } = await translateDocx(input, {
      ...options,
      memory: new MemorySession(memory),
    });
    const heading = report.segments.find((s) => s.source === '1. Giriş')!;
    expect(heading).toMatchObject({
      target: '1. Introduction',
      status: 'translated',
      manual: false,
    });
    expect(heading.issues).toEqual([expect.objectContaining({ code: 'FROM_MEMORY' })]);
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    expect(xml).toContain('1. Introduction');
    expect(xml).toContain('The F-measure is defined as ');
    // The formula is still there, as a formula.
    expect(xml.match(/<m:oMath\b/g)?.length).toBe(
      (await (await JSZip.loadAsync(input)).file('word/document.xml')!.async('string')).match(
        /<m:oMath\b/g,
      )?.length,
    );
  });
});
