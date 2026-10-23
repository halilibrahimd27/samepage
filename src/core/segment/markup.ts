import { encode, type Encoded, type InlineRun } from './codec';

export type InlineStyle = { bold?: true; italic?: true };
export const styleKey = (s: InlineStyle) => `${s.bold ? 'b' : ''}${s.italic ? 'i' : ''}`;

/**
 * Lightweight markup for the text playground: **bold**, *italic* and $inline formula$.
 * Lets maintainers exercise tags and placeholders with real engines.
 */
export function parsePlaygroundMarkup(text: string): Encoded<InlineStyle> {
  const runs: InlineRun<InlineStyle>[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\$(.+?)\$/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) runs.push({ type: 'text', text: text.slice(last, m.index), style: {} });
    if (m[1] !== undefined) runs.push({ type: 'text', text: m[1], style: { bold: true } });
    else if (m[2] !== undefined) runs.push({ type: 'text', text: m[2], style: { italic: true } });
    else runs.push({ type: 'atom', kind: 'F', text: m[3]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ type: 'text', text: text.slice(last), style: {} });
  return encode(runs, styleKey);
}
