import JSZip from 'jszip';
import type { TranslationCache } from '../core/cache/cache';
import { translateSegments, type ProgressPhase } from '../core/pipeline/translate';
import { storedTranslations, type StoredOutcome } from '../core/project';
import { decode, encode, readableText, verbatimOf, type Encoded } from '../core/segment/codec';
import type { GlossaryEntry } from '../core/validate/validate';
import { repairManual, type DocxReport, type DocxSegmentReport } from '../docx/pipeline';
import type { DocxRepair } from '../docx/repair';
import { readCentralDirectory } from '../docx/unzip';
import type { LangPair, SegmentRequest, TranslationEngine } from '../engines/types';
import { LIMITS } from '../security/limits';
import { latexStyleKey, latexUnits, type LatexStyle, type LatexUnit } from './parse';
import { renderLatex } from './render';

export interface LatexOptions {
  engine: TranslationEngine;
  pair: LangPair;
  glossary: GlossaryEntry[];
  numberLocalization: boolean;
  fidelityCheck: boolean;
  localCitations?: boolean;
  postEditor?: TranslationEngine;
  englishSpelling?: 'american' | 'british';
  replay?: Record<string, StoredOutcome>;
  overrides?: Record<string, string>;
  cache?: TranslationCache;
  signal: AbortSignal;
  onProgress?: (done: number, total: number, phase?: ProgressPhase) => void;
}

export class LatexRejectedError extends Error {
  constructor(readonly reason: 'too-large' | 'zip-bomb' | 'no-tex') {
    super(`LaTeX project rejected: ${reason}`);
    this.name = 'LatexRejectedError';
  }
}

/** babel / polyglossia names of the languages. */
const BABEL: Record<string, string[]> = {
  tr: ['turkish'],
  en: ['english', 'british', 'american', 'UKenglish', 'USenglish'],
  de: ['ngerman', 'german', 'naustrian', 'austrian'],
  fr: ['french', 'francais'],
  es: ['spanish'],
  it: ['italian'],
  pt: ['portuguese', 'brazilian', 'portuges', 'brazil'],
  nl: ['dutch'],
  pl: ['polish'],
  cs: ['czech'],
  ro: ['romanian'],
  hu: ['magyar', 'hungarian'],
  sv: ['swedish'],
  ru: ['russian'],
  uk: ['ukrainian'],
  bg: ['bulgarian'],
  el: ['greek'],
};

/**
 * The document language in babel's options or polyglossia's default switched from the source to
 * the target (hyphenation, "Figure"/"Şekil", dates). Null when there is nothing to switch.
 */
export function switchLanguage(src: string, pair: LangPair, british = false): string | null {
  const from = BABEL[pair.source];
  const to = pair.target === 'en' && british ? 'british' : BABEL[pair.target]?.[0];
  if (!from || !to) return null;
  const names = from.join('|');
  let changed = false;
  const word = new RegExp(`(^|[\\s,])(${names})(?=[\\s,\\]]|$)`, 'g');
  let out = src.replace(/\\usepackage\s*\[([^\]]*)\]\s*\{babel\}/g, (m, opts: string) => {
    const next = opts.replace(word, (_w, sep: string) => `${sep}${to}`);
    if (next === opts) return m;
    changed = true;
    return m.replace(opts, next);
  });
  out = out.replace(
    new RegExp(
      `\\\\(setdefaultlanguage|setmainlanguage)(\\s*\\[[^\\]]*\\])?\\s*\\{(${names})\\}`,
      'g',
    ),
    (_m, cmd: string, opt?: string) => {
      changed = true;
      return `\\${cmd}${opt ?? ''}{${to}}`;
    },
  );
  return changed ? out : null;
}

interface TexFile {
  path: string;
  /** The source with "\n" line ends; `crlf` files are written back with "\r\n". */
  text: string;
  crlf: boolean;
  units: LatexUnit[];
  encoded: Map<string, Encoded<LatexStyle>>;
}

const REF = /^\\(?:eq|auto|c|C|name|page)?ref\*?\{/;
const CITE = /^\\(?:cite[pt]?|citeauthor|citeyear|parencite|textcite|autocite)\*?(?:\[[^\]]*\])*\{/;

/**
 * References and citations as a reader sees them ("Tablo 7'de", "[1]"), numbers that occur
 * nowhere else in the paragraph: as no-translate spans they break the sentence and the engine
 * finishes it on its own ("Ayrıntılar Tablo \ref{…}'de verilmiştir" → "It is stated in [source].").
 */
function readAs(enc: Encoded<LatexStyle>): Record<string, string> {
  const out: Record<string, string> = {};
  let ref = 7;
  let cite = 1;
  for (const p of enc.placeholders) {
    if (p.kind !== 'C') continue;
    if (REF.test(p.text)) {
      while (enc.source.includes(String(ref))) ref++;
      out[p.id] = String(ref++);
    } else if (CITE.test(p.text)) {
      while (enc.source.includes(`[${cite}]`)) cite++;
      out[p.id] = `[${cite++}]`;
    }
  }
  return out;
}

/** Natural order of paths ("ch10.tex" after "ch9.tex"). */
const naturalKey = (path: string) => path.replace(/\d+/g, (d) => d.padStart(6, '0'));

/**
 * Translates a LaTeX source (`.tex`) or a project (`.zip`, e.g. an Overleaf download): every
 * `.tex` file's prose, with commands, mathematics, citations, references and labels kept;
 * other files (figures, `.bib`, classes) are copied unchanged.
 */
export async function translateLatex(
  bytes: Uint8Array,
  opts: LatexOptions,
): Promise<{
  bytes: Uint8Array;
  zip: boolean;
  report: DocxReport;
  translations: Record<string, StoredOutcome>;
}> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const files: TexFile[] = [];
  const repairs: DocxRepair[] = [];
  let zip: JSZip | null = null;
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const read = (path: string, data: Uint8Array) => {
    try {
      // Files saved on Windows end their lines with "\r\n": the parser reads blank lines as "\n\n".
      const raw = utf8.decode(data);
      const text = raw.replace(/\r\n?/g, '\n');
      const crlf = raw.includes('\r\n');
      files.push({ path, text, crlf, units: latexUnits(text), encoded: new Map() });
    } catch {
      repairs.push({ code: 'L2_ENCODING', part: path, detail: 'not UTF-8' });
    }
  };
  if (isZip) {
    // Limits before inflating (SECURITY.md §3), as for Office files.
    const entries = readCentralDirectory(bytes);
    if (!entries) throw new LatexRejectedError('no-tex');
    const total = entries.reduce((n, e) => n + e.uncompressed, 0);
    if (entries.length > LIMITS.docxMaxEntries || total > LIMITS.docxMaxUncompressedBytes)
      throw new LatexRejectedError('too-large');
    if (
      entries.some(
        (e) =>
          e.uncompressed > 1024 * 1024 &&
          e.uncompressed / Math.max(1, e.compressed) > LIMITS.docxMaxCompressionRatio,
      )
    )
      throw new LatexRejectedError('zip-bomb');
    zip = await JSZip.loadAsync(bytes);
    const paths = Object.keys(zip.files)
      .filter((p) => !zip!.files[p]!.dir && /\.tex$/i.test(p) && !p.startsWith('__MACOSX/'))
      .sort((a, b) => naturalKey(a).localeCompare(naturalKey(b)));
    if (!paths.length) throw new LatexRejectedError('no-tex');
    for (const path of paths) read(path, await zip.file(path)!.async('uint8array'));
  } else read('main.tex', bytes);

  const unique = new Map<string, SegmentRequest>();
  for (const f of files)
    for (const u of f.units) {
      const enc = encode(u.runs, latexStyleKey);
      f.encoded.set(u.id, enc);
      if (!unique.has(enc.source)) {
        const verbatim = { ...verbatimOf(enc.placeholders, opts.pair).verbatim, ...readAs(enc) };
        unique.set(enc.source, {
          id: `s${unique.size + 1}`,
          text: enc.source,
          role: u.role,
          ...(Object.keys(verbatim).length ? { verbatim } : {}),
        });
      }
    }
  const requests = [...unique.values()];
  const outcomes = await translateSegments({
    engine: opts.engine,
    segments: requests,
    ctx: {
      pair: opts.pair,
      glossary: opts.glossary,
      numberLocalization: opts.numberLocalization,
      ...(opts.englishSpelling ? { englishSpelling: opts.englishSpelling } : {}),
    },
    signal: opts.signal,
    fidelityCheck: opts.fidelityCheck,
    localCitations: opts.localCitations ?? false,
    ...(opts.postEditor ? { postEditor: opts.postEditor } : {}),
    ...(opts.replay ? { replay: opts.replay } : {}),
    ...(opts.cache ? { cache: opts.cache } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });
  const bySource = new Map(requests.map((r, i) => [r.text, outcomes[i]!]));

  const segments: DocxSegmentReport[] = [];
  const out = new Map<string, string>();
  for (const f of files) {
    const rendered = new Map<string, string>();
    const footnotes = new Map<string, string>();
    // Footnotes first: their paragraphs carry their text.
    const order = [...f.units].sort((a, b) => Number(!!b.nested) - Number(!!a.nested));
    for (const u of order) {
      const enc = f.encoded.get(u.id)!;
      const raw = opts.overrides?.[enc.source];
      const manual = raw === undefined ? undefined : repairManual(enc.source, raw);
      const base = bySource.get(enc.source)!;
      const o = manual !== undefined ? { ...base, text: manual, untranslated: false } : base;
      let text: string | null = null;
      if (!o.untranslated) {
        try {
          text = renderLatex(decode(o.text, enc), footnotes);
        } catch {
          text = null;
        }
      }
      // Untranslated: the source as it was (its own footnotes still go in translated).
      text ??= renderLatex(decode(enc.source, enc), footnotes);
      // After "\\" or "\item" a "[" opens an optional argument ("[1] showed …"): an empty
      // group keeps it text. Inside braces (titles, captions) it is text already.
      if ((u.role === 'body' || u.role === 'table-cell') && text.startsWith('['))
        text = `{}${text}`;
      if (u.nested) footnotes.set(u.id, text);
      else rendered.set(u.id, text);
      segments.push({
        id: `${f.path}#${u.id}`,
        part: f.path,
        role: u.role,
        source: readableText(enc.source, enc.placeholders),
        target: o.untranslated ? '' : readableText(o.text, enc.placeholders),
        status: o.untranslated
          ? 'untranslated'
          : o.issues.some((i) => i.severity !== 'info')
            ? 'warning'
            : 'translated',
        cached: o.cached,
        manual: manual !== undefined,
        issues: o.issues,
        sourceTagged: enc.source,
        targetTagged: o.untranslated ? '' : o.text,
        ...(o.back && manual === undefined ? { back: o.back } : {}),
      });
    }
    let text = '';
    let at = 0;
    for (const u of f.units) {
      if (u.nested) continue;
      text += f.text.slice(at, u.start) + rendered.get(u.id)!;
      at = u.end;
    }
    text += f.text.slice(at);
    const switched = switchLanguage(text, opts.pair, opts.englishSpelling === 'british');
    if (switched !== null) {
      text = switched;
      repairs.push({
        code: 'L1_LANGUAGE',
        part: f.path,
        detail: `babel/polyglossia → ${opts.pair.target}`,
      });
    }
    out.set(f.path, f.crlf ? text.replace(/\n/g, '\r\n') : text);
  }

  let result: Uint8Array;
  if (zip) {
    for (const [path, text] of out) zip.file(path, text);
    result = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  } else result = new TextEncoder().encode(out.get('main.tex') ?? '');

  // Report order: document order within each file.
  const position = new Map<string, string>();
  for (const f of files)
    f.units.forEach((u, i) =>
      position.set(
        `${f.path}#${u.id}`,
        `${naturalKey(f.path)}:${String(u.start).padStart(9, '0')}:${i}`,
      ),
    );
  segments.sort((a, b) => position.get(a.id)!.localeCompare(position.get(b.id)!));
  const count = (s: DocxSegmentReport['status']) => segments.filter((r) => r.status === s).length;
  const repairCounts: DocxReport['summary']['repairs'] = {};
  for (const r of repairs) repairCounts[r.code] = (repairCounts[r.code] ?? 0) + 1;
  return {
    bytes: result,
    zip: !!zip,
    translations: storedTranslations(requests, outcomes),
    report: {
      summary: {
        segments: segments.length,
        translated: count('translated'),
        warnings: count('warning'),
        untranslated: count('untranslated'),
        skipped: 0,
        cached: segments.filter((s) => s.cached).length,
        manual: segments.filter((s) => s.manual).length,
        repairs: repairCounts,
      },
      segments,
      repairs,
    },
  };
}
