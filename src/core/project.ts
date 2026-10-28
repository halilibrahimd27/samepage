import type { EngineId, FidelityFinding, LangPair } from '../engines/types';
import type { SegmentOutcome } from './pipeline/translate';
import type { GlossaryEntry, ValidationIssue } from './validate/validate';

/**
 * A samepage project (P9.5): the source document with everything needed to reopen its
 * translation in any browser without translating again — the language pair, the options, the
 * glossary, the review edits and every segment's translation. Stored as a ZIP (`.samepage`):
 * `samepage.json` and the document under `source/`.
 */

export const PROJECT_FORMAT = 'samepage-project';
export const PROJECT_VERSION = 1;
export const PROJECT_MANIFEST = 'samepage.json';
export const PROJECT_EXTENSION = '.samepage';

/** A segment's translation as the pipeline produced it (SegmentOutcome without run data). */
export interface StoredOutcome {
  text: string;
  untranslated: boolean;
  issues: ValidationIssue[];
  findings: FidelityFinding[];
  notes: string[];
  back?: string;
}

export interface ProjectOptions {
  fidelityCheck: boolean;
  localCitations: boolean;
  translateReferences: boolean;
  translateMetadata: boolean;
  translateComments?: boolean;
  /** PDFs: 0-based inclusive page range. */
  pageRange?: { from: number; to: number };
}

export type ProjectKind = 'pdf' | 'docx' | 'pptx';

export interface ProjectManifest {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  file: { name: string; kind: ProjectKind };
  pair: LangPair;
  /** The engine that translated it (shown to the user; never needed to reopen). */
  engine: { id: EngineId; model?: string };
  options: ProjectOptions;
  glossary: GlossaryEntry[];
  /** Review edits: tagged source → tagged target. */
  edits: Record<string, string>;
  /** Tagged source → translation. */
  translations: Record<string, StoredOutcome>;
}

const MAX_TEXT = 100_000;
const ENGINES: EngineId[] = [
  'browser',
  'chrome-builtin',
  'anthropic',
  'openai-compatible',
  'pseudo',
];
const KINDS: ProjectKind[] = ['pdf', 'docx', 'pptx'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max;
const lang = (v: unknown): v is string => typeof v === 'string' && /^[a-z]{2,3}$/.test(v);
// Plain records only: a key like "__proto__" is ordinary data in an object without a prototype.
const record = <T>(v: unknown, each: (x: unknown) => T | null): Record<string, T> | null => {
  if (!isObject(v)) return null;
  const out = Object.create(null) as Record<string, T>;
  for (const [k, x] of Object.entries(v)) {
    const parsed = each(x);
    if (!str(k) || parsed === null) return null;
    out[k] = parsed;
  }
  return out;
};

function issue(v: unknown): ValidationIssue | null {
  if (!isObject(v) || !str(v.code, 40) || !/^[A-Z_]+$/.test(v.code) || !str(v.detail)) return null;
  if (v.severity !== 'error' && v.severity !== 'warning' && v.severity !== 'info') return null;
  return { code: v.code as ValidationIssue['code'], severity: v.severity, detail: v.detail };
}

function finding(v: unknown): FidelityFinding | null {
  if (!isObject(v) || !str(v.id, 200) || !str(v.issue)) return null;
  if (v.severity !== 'minor' && v.severity !== 'major') return null;
  if (v.backTranslation !== undefined && !str(v.backTranslation)) return null;
  return {
    id: v.id,
    issue: v.issue,
    severity: v.severity,
    ...(v.backTranslation !== undefined ? { backTranslation: v.backTranslation } : {}),
  };
}

const list = <T>(v: unknown, each: (x: unknown) => T | null): T[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map(each);
  return out.every((x) => x !== null) ? out : null;
};

function outcome(v: unknown): StoredOutcome | null {
  if (!isObject(v) || !str(v.text) || typeof v.untranslated !== 'boolean') return null;
  const issues = list(v.issues, issue);
  const findings = list(v.findings, finding);
  const notes = list(v.notes, (n) => (str(n, 200) ? n : null));
  if (!issues || !findings || !notes) return null;
  if (v.back !== undefined && !str(v.back)) return null;
  return {
    text: v.text,
    untranslated: v.untranslated,
    issues,
    findings,
    notes,
    ...(v.back !== undefined ? { back: v.back } : {}),
  };
}

function glossaryEntry(v: unknown): GlossaryEntry | null {
  if (!isObject(v) || !str(v.source, 500) || !str(v.target, 500)) return null;
  if (v.note !== undefined && !str(v.note, 2000)) return null;
  return {
    source: v.source,
    target: v.target,
    ...(v.note !== undefined ? { note: v.note } : {}),
  };
}

function options(v: unknown): ProjectOptions | null {
  if (!isObject(v)) return null;
  const flags = ['fidelityCheck', 'localCitations', 'translateReferences', 'translateMetadata'];
  if (!flags.every((f) => typeof v[f] === 'boolean')) return null;
  if (v.translateComments !== undefined && typeof v.translateComments !== 'boolean') return null;
  let pageRange: ProjectOptions['pageRange'];
  if (v.pageRange !== undefined) {
    const r = v.pageRange;
    if (!isObject(r) || !Number.isInteger(r.from) || !Number.isInteger(r.to)) return null;
    if ((r.from as number) < 0 || (r.to as number) < (r.from as number)) return null;
    pageRange = { from: r.from as number, to: r.to as number };
  }
  return {
    fidelityCheck: v.fidelityCheck as boolean,
    localCitations: v.localCitations as boolean,
    translateReferences: v.translateReferences as boolean,
    translateMetadata: v.translateMetadata as boolean,
    ...(v.translateComments !== undefined ? { translateComments: v.translateComments } : {}),
    ...(pageRange ? { pageRange } : {}),
  };
}

/** Checks an untrusted manifest field by field; null when anything is off. */
export function parseManifest(json: unknown): ProjectManifest | null {
  if (!isObject(json) || json.format !== PROJECT_FORMAT || json.version !== PROJECT_VERSION)
    return null;
  const { file, pair, engine } = json;
  if (!isObject(file) || !str(file.name, 255) || !KINDS.includes(file.kind as ProjectKind))
    return null;
  // A bare file name: no folders.
  if (!file.name || /[/\\]/.test(file.name)) return null;
  if (!isObject(pair) || !lang(pair.source) || !lang(pair.target)) return null;
  if (!isObject(engine) || !ENGINES.includes(engine.id as EngineId)) return null;
  if (engine.model !== undefined && !str(engine.model, 200)) return null;
  const opts = options(json.options);
  const glossary = list(json.glossary, glossaryEntry);
  const edits = record(json.edits, (x) => (str(x) ? x : null));
  const translations = record(json.translations, outcome);
  if (!opts || !glossary || !edits || !translations) return null;
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    file: { name: file.name, kind: file.kind as ProjectKind },
    pair: { source: pair.source, target: pair.target },
    engine: {
      id: engine.id as EngineId,
      ...(engine.model !== undefined ? { model: engine.model } : {}),
    },
    options: opts,
    glossary,
    edits,
    translations,
  };
}

/** What a project keeps of a translation outcome. */
export function storedOutcome(o: SegmentOutcome): StoredOutcome {
  return {
    text: o.text,
    untranslated: o.untranslated,
    issues: o.issues,
    findings: o.findings,
    notes: o.notes,
    ...(o.back !== undefined ? { back: o.back } : {}),
  };
}

/** Translations by source text, as a project stores them. */
export function storedTranslations(
  requests: { text: string }[],
  outcomes: SegmentOutcome[],
): Record<string, StoredOutcome> {
  return Object.fromEntries(requests.map((r, i) => [r.text, storedOutcome(outcomes[i]!)]));
}
