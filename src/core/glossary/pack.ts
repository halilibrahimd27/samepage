import { parseXml } from '../../docx/xml';
import type { LangPair } from '../../engines/types';
import type { GlossaryEntry } from '../validate/validate';
import { parseGlossaryCsv } from './glossary';

/**
 * Glossary packs (P9.9): one termbase shared by a lab or department, for every language pair.
 * A pack is a spreadsheet whose header names the languages ("tr,en,de,note": one concept per
 * row) or a TBX file (the terminology exchange standard; IATE exports it). The two-column
 * "source,target,note" file of a single pair is still read as before.
 */

export interface Termbase {
  /** Language codes of the columns, in file order. */
  languages: string[];
  /** One concept per row: its term in each language, and a note. */
  rows: { terms: Record<string, string>; note?: string }[];
}

const LANG = /^[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?$/;
const base = (code: string) => code.toLowerCase().split(/[-_]/)[0]!;

/** Rows of a CSV/TSV file (RFC 4180 quoting; comma, semicolon or tab). */
function rows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    out.push(row);
  }
  return out.map((r) => r.map((c) => c.trim()));
}

/** A spreadsheet whose header names two languages or more; null for a plain glossary. */
export function parseTermbaseCsv(text: string): Termbase | null {
  const [header, ...body] = rows(text);
  if (!header) return null;
  const columns = header.map((h) =>
    LANG.test(h) ? base(h) : h.toLowerCase() === 'note' ? 'note' : '',
  );
  const languages = columns.filter((c) => c && c !== 'note');
  if (new Set(languages).size < 2) return null;
  return {
    languages,
    rows: body
      .map((r) => {
        const terms: Record<string, string> = {};
        let note = '';
        columns.forEach((c, i) => {
          const v = r[i] ?? '';
          if (c === 'note') note = v;
          else if (c && v && !terms[c]) terms[c] = v;
        });
        return note ? { terms, note } : { terms };
      })
      .filter((r) => Object.keys(r.terms).length >= 2),
  };
}

/** A TBX file (TBX-Basic, TBX-Min, TBX v3): each concept's first term in each language. */
export function parseTbx(text: string): Termbase {
  const doc = parseXml(text);
  const languages: string[] = [];
  const out: Termbase['rows'] = [];
  const entries = [
    ...Array.from(doc.getElementsByTagName('termEntry')),
    ...Array.from(doc.getElementsByTagName('conceptEntry')),
  ];
  for (const entry of entries) {
    const terms: Record<string, string> = {};
    for (const set of Array.from(entry.getElementsByTagName('langSet'))) {
      const code = set.getAttribute('xml:lang') ?? set.getAttribute('lang') ?? '';
      if (!LANG.test(code)) continue;
      const lang = base(code);
      const term = set.getElementsByTagName('term')[0]?.textContent?.trim();
      if (!term || terms[lang]) continue;
      terms[lang] = term;
      if (!languages.includes(lang)) languages.push(lang);
    }
    const note = entry.getElementsByTagName('note')[0]?.textContent?.trim();
    if (Object.keys(terms).length >= 2) out.push(note ? { terms, note } : { terms });
  }
  return { languages, rows: out };
}

/** The pair's entries of a termbase (a concept without both languages is skipped). */
export function entriesFor(termbase: Termbase, pair: LangPair): GlossaryEntry[] {
  return termbase.rows.flatMap((r) => {
    const source = r.terms[pair.source];
    const target = r.terms[pair.target];
    if (!source || !target) return [];
    return [r.note ? { source, target, note: r.note } : { source, target }];
  });
}

/**
 * Reads a glossary file for a language pair: a pack (languages in the header, or TBX) gives
 * the pair's columns; a plain "source,target,note" file is taken as the pair's own.
 */
export function readGlossaryFile(
  text: string,
  pair: LangPair,
): { entries: GlossaryEntry[]; languages?: string[] } {
  if (/<(martif|tbx)\b/i.test(text.slice(0, 4000))) {
    const tbx = parseTbx(text);
    return { entries: entriesFor(tbx, pair), languages: tbx.languages };
  }
  const pack = parseTermbaseCsv(text);
  if (pack) return { entries: entriesFor(pack, pair), languages: pack.languages };
  return { entries: parseGlossaryCsv(text) };
}

/**
 * One pack from the glossaries of several pairs: entries that share a term in a language are
 * one concept ("güven aralığı" → "confidence interval" and → "Konfidenzintervall").
 */
export function glossariesToPack(
  glossaries: { pair: LangPair; entries: GlossaryEntry[] }[],
): Termbase {
  const languages: string[] = [];
  const out: Termbase['rows'] = [];
  const index = new Map<string, Termbase['rows'][number]>();
  const key = (lang: string, term: string) => `${lang}|${term.toLowerCase()}`;
  const ordered = [...glossaries].sort((a, b) =>
    `${a.pair.source}>${a.pair.target}`.localeCompare(`${b.pair.source}>${b.pair.target}`),
  );
  for (const { pair, entries } of ordered) {
    for (const lang of [pair.source, pair.target])
      if (!languages.includes(lang)) languages.push(lang);
    for (const e of entries) {
      if (!e.source.trim() || !e.target.trim()) continue;
      let row = index.get(key(pair.source, e.source)) ?? index.get(key(pair.target, e.target));
      if (!row) {
        row = { terms: {} };
        out.push(row);
      }
      row.terms[pair.source] ??= e.source;
      row.terms[pair.target] ??= e.target;
      if (e.note && !row.note) row.note = e.note;
      index.set(key(pair.source, e.source), row);
      index.set(key(pair.target, e.target), row);
    }
  }
  return { languages, rows: out };
}

/** A termbase as CSV: language columns, then the note. */
export function termbaseToCsv(termbase: Termbase): string {
  const cell = (v: string) => (/[",;\t\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return (
    [
      [...termbase.languages, 'note'].join(','),
      ...termbase.rows.map((r) =>
        [...termbase.languages.map((l) => r.terms[l] ?? ''), r.note ?? ''].map(cell).join(','),
      ),
    ].join('\n') + '\n'
  );
}
