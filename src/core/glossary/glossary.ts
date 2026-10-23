import { sha256Hex } from '../cache/cache';
import type { GlossaryEntry } from '../validate/validate';

/** RFC 4180 CSV with the columns source,target,note (header optional). */
export function parseGlossaryCsv(csv: string): GlossaryEntry[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const BOM = String.fromCharCode(0xfeff);
  const text = csv.startsWith(BOM) ? csv.slice(1) : csv;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const entries: GlossaryEntry[] = [];
  rows.forEach((r, i) => {
    const [source = '', target = '', note = ''] = r.map((c) => c.trim());
    if (i === 0 && source.toLowerCase() === 'source' && target.toLowerCase() === 'target') return;
    if (!source || !target) return;
    entries.push(note ? { source, target, note } : { source, target });
  });
  return entries;
}

export function glossaryToCsv(entries: GlossaryEntry[]): string {
  const cell = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return (
    [
      'source,target,note',
      ...entries.map((e) => [e.source, e.target, e.note ?? ''].map(cell).join(',')),
    ].join('\n') + '\n'
  );
}

/** User entries override generated ones (matched case-insensitively on the source term). */
export function mergeGlossaries(
  generated: GlossaryEntry[],
  user: GlossaryEntry[],
): GlossaryEntry[] {
  const byKey = new Map<string, GlossaryEntry>();
  for (const e of generated) byKey.set(e.source.toLowerCase(), e);
  for (const e of user) byKey.set(e.source.toLowerCase(), e);
  return [...byKey.values()].sort((a, b) => a.source.localeCompare(b.source));
}

export function glossaryHash(entries: GlossaryEntry[]): Promise<string> {
  const canonical = [...entries]
    .map((e) => [e.source, e.target, e.note ?? ''])
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
  return sha256Hex(JSON.stringify(canonical));
}

/**
 * Text sample for glossary extraction (TRANSLATION.md §5): title, headings, the opening of the
 * body (abstract) and recurring 2–3-word phrases.
 */
export function buildGlossarySample(
  paragraphs: { text: string; role: string }[],
  maxChars = 6000,
): string {
  const headings = paragraphs.filter((p) => p.role === 'heading').map((p) => p.text);
  const body = paragraphs
    .filter((p) => p.role !== 'heading')
    .map((p) => p.text)
    .join('\n');
  const words = body.toLocaleLowerCase().match(/\p{L}[\p{L}\p{M}-]*/gu) ?? [];
  const counts = new Map<string, number>();
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n);
      if (gram.some((w) => w.length < 3)) continue;
      const key = gram.join(' ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const recurring = [...counts]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 40)
    .map(([g]) => g);
  const parts = [
    headings.length ? `Headings:\n${headings.join('\n')}` : '',
    recurring.length ? `Recurring phrases:\n${recurring.join('\n')}` : '',
    `Text:\n${body}`,
  ].filter(Boolean);
  return parts.join('\n\n').slice(0, maxChars);
}
