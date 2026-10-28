import type { DecodedRun } from '../core/segment/codec';
import type { LatexStyle } from './parse';

/** Characters with a meaning in LaTeX, written as text. */
const ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '%': '\\%',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  $: '\\$',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '\u00A0': '~',
};

export const escapeLatex = (text: string) =>
  text.replace(/[\\{}%&#_$~^\u00A0]/g, (c) => ESCAPES[c]!);

/**
 * LaTeX for decoded runs: text escaped, formatting wrappers reopened around each styled run,
 * placeholders written back exactly as they were in the source; a footnote's marker replaced by
 * its translation (or its original text).
 */
export function renderLatex(
  runs: DecodedRun<LatexStyle>[],
  footnotes: Map<string, string>,
): string {
  let out = '';
  let open: string[] = [];
  const reach = (wrap: string[]) => {
    let common = 0;
    while (common < open.length && common < wrap.length && open[common] === wrap[common]) common++;
    out += '}'.repeat(open.length - common);
    out += wrap.slice(common).join('');
    open = [...wrap];
  };
  for (const run of runs) {
    if (run.type === 'text') {
      reach(run.style?.wrap ?? []);
      out += escapeLatex(run.text);
      continue;
    }
    const ph = run.placeholder;
    let text = ph?.text ?? run.text;
    if (ph?.kind === 'N')
      text = text.replace(
        /\uE000(l\d+)\uE001/,
        (_, id: string) => footnotes.get(id) ?? ph.ref ?? '',
      );
    out += text;
  }
  reach([]);
  return out;
}
