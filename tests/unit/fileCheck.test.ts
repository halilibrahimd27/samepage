import { describe, expect, it } from 'vitest';
import { classifyFile, zipEntryNames } from '../../src/security/fileCheck';
import { LIMITS } from '../../src/security/limits';

/** Minimal ZIP (stored entries, empty data) — enough for central-directory parsing. */
function zip(names: string[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: number[] = [];
  const centrals: number[] = [];
  const u16 = (a: number[], v: number) => a.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (a: number[], v: number) =>
    a.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  for (const name of names) {
    const n = [...enc.encode(name)];
    const offset = locals.length;
    u32(locals, 0x04034b50);
    for (let i = 0; i < 11; i++) u16(locals, 0); // version, flags, method, time, date, crc(2), sizes(4)
    u16(locals, n.length);
    u16(locals, 0);
    locals.push(...n);
    u32(centrals, 0x02014b50);
    for (let i = 0; i < 12; i++) u16(centrals, 0); // versions, flags, method, time, date, crc, sizes
    u16(centrals, n.length);
    for (let i = 0; i < 4; i++) u16(centrals, 0); // extra, comment, disk, internal attrs
    u32(centrals, 0); // external attrs
    u32(centrals, offset);
    centrals.push(...n);
  }
  const eocd: number[] = [];
  u32(eocd, 0x06054b50);
  u16(eocd, 0);
  u16(eocd, 0);
  u16(eocd, names.length);
  u16(eocd, names.length);
  u32(eocd, centrals.length);
  u32(eocd, locals.length);
  u16(eocd, 0);
  return new Uint8Array([...locals, ...centrals, ...eocd]);
}

const check = (name: string, bytes: Uint8Array, size = bytes.length) =>
  classifyFile(
    name,
    size,
    bytes.subarray(0, 1024),
    bytes.subarray(Math.max(0, bytes.length - 65557)),
  );

describe('classifyFile', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\n...');
  const docx = zip(['[Content_Types].xml', 'word/document.xml']);

  it('recognises PDF and DOCX by content, not extension', () => {
    expect(check('paper.docx', pdf)).toEqual({ ok: true, kind: 'pdf' });
    expect(check('paper.bin', docx)).toEqual({ ok: true, kind: 'docx' });
    expect(zipEntryNames(docx, docx.length)).toEqual(['[Content_Types].xml', 'word/document.xml']);
  });

  it('rejects empty, unknown, non-Word ZIP and macro-enabled files', () => {
    expect(check('a.pdf', new Uint8Array())).toMatchObject({
      ok: false,
      rejection: { reason: 'empty' },
    });
    expect(check('a.pdf', new TextEncoder().encode('hello'))).toMatchObject({
      ok: false,
      rejection: { reason: 'unsupported' },
    });
    expect(check('a.docx', zip(['xl/workbook.xml']))).toMatchObject({
      ok: false,
      rejection: { reason: 'unsupported' },
    });
    expect(check('a.docx', zip(['word/document.xml', 'word/vbaProject.bin']))).toMatchObject({
      ok: false,
      rejection: { reason: 'docm' },
    });
    expect(check('a.docm', docx)).toMatchObject({ ok: false, rejection: { reason: 'docm' } });
  });

  it('recognises LaTeX sources and LaTeX project archives', () => {
    const tex = new TextEncoder().encode('\\documentclass{article}\n\\begin{document}\nMetin.');
    expect(check('paper.tex', tex)).toEqual({ ok: true, kind: 'latex' });
    // Not by extension alone: a .tex file must read as LaTeX.
    expect(check('paper.tex', new TextEncoder().encode('hello'))).toMatchObject({ ok: false });
    expect(check('overleaf.zip', zip(['main.tex', 'figures/a.png']))).toEqual({
      ok: true,
      kind: 'latex',
    });
  });

  it('recognises a samepage project file by its manifest', () => {
    expect(check('paper.samepage', zip(['samepage.json', 'source/paper.pdf']))).toEqual({
      ok: true,
      kind: 'project',
    });
    // A project holding a Word document is a project, not a Word document.
    expect(check('x.docx', zip(['samepage.json', 'source/word/document.xml']))).toEqual({
      ok: true,
      kind: 'project',
    });
  });

  it('recognises PowerPoint presentations and rejects macro-enabled ones', () => {
    const pptx = zip(['[Content_Types].xml', 'ppt/presentation.xml', 'ppt/slides/slide1.xml']);
    expect(check('talk.bin', pptx)).toEqual({ ok: true, kind: 'pptx' });
    expect(check('talk.pptm', pptx)).toMatchObject({ ok: false, rejection: { reason: 'docm' } });
    expect(check('talk.pptx', zip(['ppt/presentation.xml', 'ppt/vbaProject.bin']))).toMatchObject({
      ok: false,
      rejection: { reason: 'docm' },
    });
  });

  it('enforces size limits per kind', () => {
    expect(check('a.pdf', pdf, LIMITS.pdfMaxBytes + 1)).toMatchObject({
      ok: false,
      rejection: { reason: 'too-large', kind: 'pdf' },
    });
  });
});
