import type { Role } from '../core/ir/types';
import { DISPLAY_FORMULA, type InlineRun } from '../core/segment/codec';

/**
 * LaTeX sources (P9.7): the translatable text of a `.tex` file as units over source ranges.
 * Commands, mathematics, citations, references, labels, comments and environments are kept
 * byte for byte as placeholders; only prose is translated. Pure: no I/O.
 */

/** The wrappers around a run of text, outermost first ("\\textbf{", "{\\itshape "); each closes with "}". */
export interface LatexStyle {
  wrap: string[];
}

export interface LatexUnit {
  id: string;
  role: Role;
  /** Source range the translation replaces. */
  start: number;
  end: number;
  runs: InlineRun<LatexStyle>[];
  /** A footnote: rendered inside its paragraph (marker in the parent's footnote atom). */
  nested?: boolean;
}

export const latexStyleKey = (s: LatexStyle) => s.wrap.join('');
const PLAIN: LatexStyle = { wrap: [] };

/** Marker of a footnote's translated text inside its parent's atom. */
export const footnoteMarker = (id: string) => `\uE000${id}\uE001`;

const VERBATIM = new Set([
  'verbatim',
  'verbatim*',
  'Verbatim',
  'lstlisting',
  'minted',
  'comment',
  'alltt',
  'tikzpicture',
  'pgfpicture',
  'forest',
  'filecontents',
  'filecontents*',
]);
const MATH = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'eqnarray',
  'eqnarray*',
  'displaymath',
  'math',
  'flalign',
  'flalign*',
  'alignat',
  'alignat*',
  'dmath',
  'dmath*',
]);
const TABULAR = new Set(['tabular', 'tabular*', 'tabularx', 'longtable', 'tabulary']);
/** Environments kept as they are: reference lists (P9.6 does titles in PDF/DOCX only). */
const SKIPPED = new Set(['thebibliography']);
const SECTIONS = new Set([
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
]);
/** One-argument text formatting: the argument is text. */
const FORMAT = new Set([
  'textbf',
  'textit',
  'emph',
  'textsc',
  'textsl',
  'textsf',
  'textrm',
  'textup',
  'textmd',
  'underline',
  'uline',
  'mbox',
  'fbox',
  'textsuperscript',
  'textsubscript',
  'enquote',
]);
/** Commands whose last argument is text (the others are kept in the wrapper). */
const TEXT_LAST = new Map<string, number>([
  ['href', 1],
  ['textcolor', 1],
  ['colorbox', 1],
  ['hyperref', 0],
  ['makebox', 0],
  ['framebox', 0],
  ['multicolumn', 2],
  ['multirow', 2],
]);
/** Font declarations that open a group's style ("{\\bf text}"). */
const DECLARATIONS = new Set([
  'bf',
  'it',
  'em',
  'sc',
  'sf',
  'tt',
  'rm',
  'sl',
  'bfseries',
  'itshape',
  'scshape',
  'ttfamily',
  'sffamily',
  'rmfamily',
  'upshape',
  'slshape',
  'mdseries',
  'small',
  'footnotesize',
  'scriptsize',
  'tiny',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
]);
/** Commands that end a paragraph (they start a block of their own). */
const BLOCK = new Set([
  ...SECTIONS,
  'item',
  'caption',
  'captionof',
  'maketitle',
  'tableofcontents',
  'listoffigures',
  'listoftables',
  'bibliography',
  'bibliographystyle',
  'printbibliography',
  'newpage',
  'clearpage',
  'cleardoublepage',
  'appendix',
  'par',
  'centering',
  'raggedright',
  'raggedleft',
  'noindent',
  'vspace',
  'bigskip',
  'medskip',
  'smallskip',
  'includegraphics',
  'label',
  'input',
  'include',
  'hline',
  'toprule',
  'midrule',
  'bottomrule',
  'onecolumn',
  'twocolumn',
]);
const SYMBOLS: Record<string, string> = {
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  textendash: '–',
  textemdash: '—',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  ss: 'ß',
  i: 'ı',
  o: 'ø',
  O: 'Ø',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  S: '§',
  P: '¶',
  copyright: '©',
  textdegree: '°',
  textperthousand: '‰',
};
const ACCENTS: Record<string, string> = {
  '"': '̈',
  "'": '́',
  '`': '̀',
  '^': '̂',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  u: '̆',
  v: '̌',
  H: '̋',
  c: '̧',
  k: '̨',
  r: '̊',
  d: '̣',
  b: '̱',
};
const ESCAPED = new Set(['%', '&', '_', '#', '$', '{', '}']);
const LETTER = /[A-Za-z@]/;

/** Index after the group opened at `open` ("{…}" or "[…]"), nesting and escapes respected. */
function groupEnd(src: string, open: number): number {
  const close = src[open] === '[' ? ']' : '}';
  const opener = src[open]!;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '%') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === opener) depth++;
    else if (c === close && --depth === 0) return i + 1;
  }
  return src.length;
}

/** The command name at `at` (after its backslash) and the index after it. */
function commandAt(src: string, at: number): { name: string; end: number } {
  let end = at + 1;
  if (LETTER.test(src[end] ?? '')) {
    while (LETTER.test(src[end] ?? '')) end++;
  } else end++;
  return { name: src.slice(at + 1, end), end };
}

/** Index after the optional "[…]" and braced "{…}" arguments that follow directly. */
function argsEnd(src: string, at: number, max = 9): number {
  let i = at;
  for (let n = 0; n < max; n++) {
    let j = i;
    while (src[j] === ' ' || src[j] === '\t') j++;
    if (src[j] === '[' || src[j] === '{') i = groupEnd(src, j);
    else break;
  }
  return i;
}

/** "\\begin{name}" at `at`: the environment name and the index after the braces. */
function envAt(src: string, at: number): { name: string; end: number } | null {
  const m = /^\\(begin|end)\s*\{([^}]*)\}/.exec(src.slice(at, at + 80));
  return m ? { name: m[2]!, end: at + m[0].length } : null;
}

/** Index after the matching "\\end{name}" (nested environments of the same name counted). */
function envEnd(src: string, from: number, name: string): number {
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${name.replace(/[*]/g, '\\*')}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[1] === 'begin' ? 1 : -1;
    if (depth === 0) return m.index + m[0].length;
  }
  return src.length;
}

class Parser {
  readonly units: LatexUnit[] = [];
  private nextId = 1;
  constructor(private readonly src: string) {}

  private unit(
    role: Role,
    start: number,
    end: number,
    runs: InlineRun<LatexStyle>[],
    nested = false,
  ) {
    const id = `l${this.nextId++}`;
    // The range ends at the text; so do the runs.
    for (let last = runs[runs.length - 1]; last?.type === 'text'; last = runs[runs.length - 1]) {
      last.text = last.text.replace(/\s+$/u, '');
      if (last.text) break;
      runs.pop();
    }
    // Only text with a word in it is translated.
    if (runs.some((r) => r.type === 'text' && /\p{L}{2}/u.test(r.text)))
      this.units.push({ id, role, start, end, runs, ...(nested ? { nested: true } : {}) });
    return id;
  }

  /** Whether a paragraph ends at `i`: a blank line, a block command or environment, a brace. */
  private paragraphEnds(i: number, inTable: boolean): boolean {
    const src = this.src;
    if (/^\n[ \t]*\n/.test(src.slice(i, i + 64))) return true;
    if (inTable && (src[i] === '&' || src.startsWith('\\\\', i))) return true;
    if (src[i] !== '\\') return false;
    const env = envAt(src, i);
    if (env) {
      if (src.startsWith('\\end', i)) return true;
      // Mathematics inside a paragraph stays in it (the sentence goes on after it).
      return !MATH.has(env.name);
    }
    const { name } = commandAt(src, i);
    return BLOCK.has(name);
  }

  /** Inline content from `i` until a paragraph end or an unmatched "}"; returns the runs. */
  inline(
    i: number,
    style: LatexStyle,
    inTable: boolean,
    stopAtBrace: boolean,
  ): { runs: InlineRun<LatexStyle>[]; end: number } {
    const src = this.src;
    const runs: InlineRun<LatexStyle>[] = [];
    const text = (t: string) => {
      const last = runs[runs.length - 1];
      if (last?.type === 'text' && latexStyleKey(last.style) === latexStyleKey(style))
        last.text += t;
      else runs.push({ type: 'text', text: t, style });
    };
    const atom = (kind: 'F' | 'C' | 'B' | 'N' | 'I', from: number, to: number, ref?: string) =>
      runs.push({
        type: 'atom',
        kind,
        text: src.slice(from, to),
        ...(ref !== undefined ? { ref } : {}),
      });
    while (i < src.length) {
      const c = src[i]!;
      if (stopAtBrace && c === '}') return { runs, end: i };
      if (!stopAtBrace && this.paragraphEnds(i, inTable)) return { runs, end: i };
      if (c === '%') {
        const nl = src.indexOf('\n', i);
        const end = nl < 0 ? src.length : nl + 1;
        atom('C', i, end);
        i = end;
        continue;
      }
      if (c === '$') {
        const display = src[i + 1] === '$';
        const close = display ? src.indexOf('$$', i + 2) : this.mathEnd(i + 1);
        const end = close < 0 ? src.length : close + (display ? 2 : 1);
        if (display) atom('I', i, end, DISPLAY_FORMULA);
        else atom('F', i, end);
        i = end;
        continue;
      }
      if (c === '{') {
        const close = groupEnd(src, i);
        const decl = /^\{\s*\\([A-Za-z]+)\b\s*/.exec(src.slice(i, i + 40));
        const wrapper = decl && DECLARATIONS.has(decl[1]!) ? decl[0] : '{';
        const inner = this.inline(
          i + wrapper.length,
          { wrap: [...style.wrap, wrapper] },
          inTable,
          true,
        );
        runs.push(...inner.runs);
        i = Math.min(close, inner.end + 1);
        continue;
      }
      if (c === '~') {
        text('\u00A0');
        i++;
        continue;
      }
      // TeX quotes; a single "'" is an apostrophe ("Tablo 1'de") and stays one.
      if (c === '`' || (c === "'" && src[i + 1] === "'")) {
        const two = src[i + 1] === c;
        text(c === '`' ? (two ? '“' : '‘') : '”');
        i += two ? 2 : 1;
        continue;
      }
      if (c === '-' && src[i + 1] === '-') {
        const three = src[i + 2] === '-';
        text(three ? '—' : '–');
        i += three ? 3 : 2;
        continue;
      }
      if (c === '\n') {
        text(' ');
        i++;
        continue;
      }
      if (c !== '\\') {
        text(c);
        i++;
        continue;
      }
      // A command.
      if (src.startsWith('\\(', i)) {
        const close = src.indexOf('\\)', i + 2);
        const end = close < 0 ? src.length : close + 2;
        atom('F', i, end);
        i = end;
        continue;
      }
      if (src.startsWith('\\[', i)) {
        const close = src.indexOf('\\]', i + 2);
        const end = close < 0 ? src.length : close + 2;
        atom('I', i, end, DISPLAY_FORMULA);
        i = end;
        continue;
      }
      if (src.startsWith('\\\\', i)) {
        const end = argsEnd(src, src[i + 2] === '*' ? i + 3 : i + 2, 1);
        atom('B', i, end);
        i = end;
        continue;
      }
      const env = envAt(src, i);
      if (env && src.startsWith('\\begin', i) && MATH.has(env.name)) {
        const end = envEnd(src, env.end, env.name);
        atom('I', i, end, DISPLAY_FORMULA);
        i = end;
        continue;
      }
      const { name, end: nameEnd } = commandAt(src, i);
      if (name.length === 1 && ESCAPED.has(name)) {
        text(name);
        i = nameEnd;
        continue;
      }
      if (name === ' ') {
        text(' ');
        i = nameEnd;
        continue;
      }
      if (name.length === 1 && ACCENTS[name] !== undefined) {
        // \"o, \"{o}, \c{c}, \u g
        let j = nameEnd;
        while (src[j] === ' ' && /[a-z]/.test(name)) j++;
        let base: string;
        let after: number;
        if (src[j] === '{') {
          after = groupEnd(src, j);
          base = src.slice(j + 1, after - 1).replace(/^\\i$/, 'ı');
        } else if (src[j] === '\\' && src[j + 1] === 'i' && !LETTER.test(src[j + 2] ?? '')) {
          base = 'ı';
          after = j + 2;
        } else {
          base = src[j] ?? '';
          after = j + 1;
        }
        const letter = (base === 'ı' ? 'i' : base) + ACCENTS[name];
        text(letter.normalize('NFC'));
        i = after;
        continue;
      }
      if (SYMBOLS[name] !== undefined && !LETTER.test(src[nameEnd] ?? '')) {
        text(SYMBOLS[name]);
        // "\ldots{}" and "\i " lose their terminator.
        i = src.startsWith('{}', nameEnd) ? nameEnd + 2 : nameEnd;
        continue;
      }
      if (FORMAT.has(name) || TEXT_LAST.has(name)) {
        // Arguments before the text one stay in the wrapper ("\\href{url}{", "\\textcolor{red}{").
        let j = nameEnd;
        const before = TEXT_LAST.get(name) ?? 0;
        for (let n = 0; n < before; n++) {
          while (src[j] === '[') j = groupEnd(src, j);
          if (src[j] === '{') j = groupEnd(src, j);
        }
        while (src[j] === '[') j = groupEnd(src, j);
        if (src[j] === '{') {
          const close = groupEnd(src, j);
          const wrapper = src.slice(i, j + 1);
          const inner = this.inline(j + 1, { wrap: [...style.wrap, wrapper] }, inTable, true);
          runs.push(...inner.runs);
          i = Math.min(close, inner.end + 1);
          continue;
        }
      }
      if (name === 'footnote') {
        let j = nameEnd;
        while (src[j] === '[') j = groupEnd(src, j);
        if (src[j] === '{') {
          const close = groupEnd(src, j);
          const inner = this.inline(j + 1, PLAIN, false, true);
          const id = this.unit('footnote', j + 1, close - 1, inner.runs, true);
          // The parent keeps "\footnote{…}" with a marker where the translation goes.
          runs.push({
            type: 'atom',
            kind: 'N',
            text: `${src.slice(i, j + 1)}${footnoteMarker(id)}}`,
            ref: src.slice(j + 1, close - 1),
          });
          i = close;
          continue;
        }
      }
      // Anything else (cite, ref, label, url, \LaTeX, unknown macros) stays as it is.
      const end = argsEnd(src, nameEnd);
      atom('C', i, end);
      i = end;
    }
    return { runs, end: i };
  }

  /** Index of the "$" closing inline math opened before `from`. */
  private mathEnd(from: number): number {
    for (let i = from; i < this.src.length; i++) {
      if (this.src[i] === '\\') i++;
      else if (this.src[i] === '$') return i;
    }
    return -1;
  }

  /** A braced argument at `at` as a unit of its own (titles, captions). */
  private argumentUnit(at: number, role: Role): number {
    let j = at;
    while (this.src[j] === ' ') j++;
    while (this.src[j] === '[') j = groupEnd(this.src, j);
    if (this.src[j] !== '{') return j;
    const close = groupEnd(this.src, j);
    const inner = this.inline(j + 1, PLAIN, false, true);
    this.unit(role, j + 1, close - 1, inner.runs);
    return close;
  }

  /** Cells of a tabular environment's body. */
  private table(from: number, to: number): void {
    let i = from;
    while (i < to) {
      const c = this.src[i]!;
      if (/\s/.test(c) || c === '&') {
        i++;
        continue;
      }
      if (this.src.startsWith('\\\\', i)) {
        i = argsEnd(this.src, i + 2, 1);
        continue;
      }
      if (c === '%') {
        const nl = this.src.indexOf('\n', i);
        i = nl < 0 ? to : nl + 1;
        continue;
      }
      if (c === '\\') {
        const { name, end } = commandAt(this.src, i);
        if (
          [
            'hline',
            'toprule',
            'midrule',
            'bottomrule',
            'cline',
            'cmidrule',
            'addlinespace',
          ].includes(name)
        ) {
          i = argsEnd(this.src, end);
          continue;
        }
      }
      const cell = this.inline(i, PLAIN, true, false);
      let end = Math.min(cell.end, to);
      while (end > i && /\s/.test(this.src[end - 1]!)) end--;
      if (end > i) this.unit('table-cell', i, end, cell.runs);
      i = Math.max(cell.end, i + 1);
    }
  }

  /** The document body (or the whole file of an included chapter). */
  body(from: number, to: number): void {
    const src = this.src;
    let i = from;
    while (i < to) {
      const c = src[i]!;
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '%') {
        const nl = src.indexOf('\n', i);
        i = nl < 0 ? to : nl + 1;
        continue;
      }
      if (c === '\\') {
        const env = envAt(src, i);
        if (env) {
          if (src.startsWith('\\end', i)) {
            i = env.end;
            continue;
          }
          if (VERBATIM.has(env.name) || SKIPPED.has(env.name) || MATH.has(env.name)) {
            i = envEnd(src, env.end, env.name);
            continue;
          }
          if (TABULAR.has(env.name)) {
            // Column specification (and width) first: "{p{3cm}l}".
            const specEnd = argsEnd(src, env.end, env.name === 'tabular' ? 2 : 3);
            const end = envEnd(src, specEnd, env.name);
            const close = src.lastIndexOf('\\end', end - 1);
            this.table(specEnd, close);
            i = end;
            continue;
          }
          // Other environments: their content is read as body text ("abstract", "figure").
          i = argsEnd(src, env.end, env.name === 'minipage' ? 2 : 1);
          continue;
        }
        if (src.startsWith('\\[', i)) {
          const close = src.indexOf('\\]', i + 2);
          i = close < 0 ? to : close + 2;
          continue;
        }
        const { name, end } = commandAt(src, i);
        if (SECTIONS.has(name) || name === 'caption' || name === 'title') {
          const star = src[end] === '*' ? end + 1 : end;
          i = this.argumentUnit(star, name === 'caption' ? 'caption' : 'heading');
          continue;
        }
        if (name === 'captionof') {
          const j = argsEnd(src, end, 1);
          i = this.argumentUnit(j, 'caption');
          continue;
        }
        if (name === 'item') {
          i = argsEnd(src, end, 1);
          continue;
        }
        if (BLOCK.has(name)) {
          i = argsEnd(src, end);
          continue;
        }
      }
      if (c === '$' && src[i + 1] === '$') {
        const close = src.indexOf('$$', i + 2);
        i = close < 0 ? to : close + 2;
        continue;
      }
      // A paragraph.
      const start = i;
      const para = this.inline(i, PLAIN, false, false);
      let end = Math.min(para.end, to);
      while (end > start && /\s/.test(src[end - 1]!)) end--;
      this.unit('body', start, end, para.runs);
      i = Math.max(para.end, i + 1);
    }
  }
}

/** The translatable units of a LaTeX source, in source order. */
export function latexUnits(src: string): LatexUnit[] {
  const parser = new Parser(src);
  const begin = /\\begin\s*\{document\}/.exec(src);
  if (begin) {
    // The preamble: only the title is text.
    const title = /\\title\s*(\[[^\]]*\])?\s*\{/.exec(src.slice(0, begin.index));
    if (title) parser.body(title.index, groupEnd(src, title.index + title[0].length - 1));
    const end = /\\end\s*\{document\}/.exec(src);
    parser.body(begin.index + begin[0].length, end ? end.index : src.length);
  } else parser.body(0, src.length);
  return parser.units.sort((a, b) => a.start - b.start);
}
