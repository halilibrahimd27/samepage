import type { LangPair } from '../engines/types';
import { shortTextLanguage } from './detectLanguage';
import type { SegmentOutcome } from './pipeline/translate';
import type { ReferenceTitle } from './referenceTitles';

/**
 * Official titles of cited works from Crossref, when the user turns it on: a reference entry with
 * a DOI whose record holds the title in the paper's target language (DergiPark records carry the
 * Turkish title and the English one) gets that title in brackets, not a machine translation.
 * Only the DOIs leave the device.
 */

/** DOIs of the titles asked for → the titles each record holds. */
export type TitleLookup = (dois: string[], signal: AbortSignal) => Promise<Map<string, string[]>>;

const DOI = /\b10\.\d{4,9}\/[^\s"<>]+/u;
const ENDPOINT = 'https://api.crossref.org/works/';
/** Records asked for in one document, and at once. */
const MAX_DOIS = 200;
const PARALLEL = 4;

/**
 * The DOI in a reference entry ("https://doi.org/10.1/x", "doi:10.1/x."), lower-cased (DOIs are
 * case-insensitive): without the punctuation that ends the entry, and without a closing bracket
 * it does not open — "(…)" inside a DOI stays ("10.1016/S0140-6736(20)30183-5").
 */
export function doiOf(text: string): string | null {
  const m = DOI.exec(text);
  if (!m) return null;
  let doi = m[0].replace(/[.,;:]+$/u, '');
  while (/[)\]]$/u.test(doi)) {
    const open = (doi.match(/[([]/gu) ?? []).length;
    const close = (doi.match(/[)\]]/gu) ?? []).length;
    if (close <= open) break;
    doi = doi.slice(0, -1).replace(/[.,;:]+$/u, '');
  }
  return doi.toLowerCase();
}

/**
 * A record's title written in the target language, as plain text; null when it has none. A title
 * too short to tell its language is taken when the record also holds the cited title (`cited`):
 * the other one of the pair, unless it reads as the source language or a third one.
 */
export function titleIn(
  titles: string[],
  target: string,
  source: string,
  cited?: string,
): string | null {
  const clean = titles
    .map((raw) =>
      raw
        .replace(/<[^>]*>/gu, '')
        .replace(/\s+/gu, ' ')
        .trim(),
    )
    .filter((t) => t.length >= 3 && t.length <= 400);
  const found = clean.find((t) => shortTextLanguage(t, source) === target);
  if (found) return found;
  const key = (t: string) => t.toLocaleLowerCase(source).replace(/[^\p{L}\p{N}]+/gu, '');
  if (!cited || !clean.some((t) => key(t) === key(cited))) return null;
  const others = clean.filter(
    (t) => key(t) !== key(cited) && shortTextLanguage(t, source) === null,
  );
  return others.length === 1 ? others[0]! : null;
}

/** The titles Crossref holds for each DOI; a DOI it does not know, or a failed request, is left out. */
export const crossrefTitles: TitleLookup = async (dois, signal) => {
  const out = new Map<string, string[]>();
  const queue = [...new Set(dois)].slice(0, MAX_DOIS);
  const next = async (): Promise<void> => {
    for (let doi = queue.shift(); doi; doi = queue.shift()) {
      try {
        const path = doi.split('/').map(encodeURIComponent).join('/');
        const response = await fetch(ENDPOINT + path, {
          signal,
          headers: { Accept: 'application/json' },
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { message?: { title?: unknown } };
        const titles = body.message?.title;
        if (Array.isArray(titles))
          out.set(doi, titles.filter((t): t is string => typeof t === 'string').slice(0, 5));
      } catch {
        signal.throwIfAborted();
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, next));
  return out;
};

/**
 * The official titles of reference entries, by the title they stand for: the first title of each
 * entry with a DOI (the work the DOI names), when its record has it in the target language.
 */
export async function officialTitles(
  entries: { text: string; titles: ReferenceTitle[] }[],
  pair: LangPair,
  lookup: TitleLookup,
  signal: AbortSignal,
): Promise<Map<string, { title: string; doi: string }>> {
  const wanted = entries.flatMap((e) => {
    const doi = doiOf(e.text);
    return doi && e.titles[0] ? [{ doi, title: e.titles[0].title }] : [];
  });
  const out = new Map<string, { title: string; doi: string }>();
  if (!wanted.length) return out;
  const records = await lookup(
    wanted.map((w) => w.doi),
    signal,
  ).catch(() => {
    // Crossref out of reach: the titles are translated as without it.
    signal.throwIfAborted();
    return new Map<string, string[]>();
  });
  for (const w of wanted) {
    const title = titleIn(records.get(w.doi) ?? [], pair.target, pair.source, w.title);
    if (title) out.set(w.title, { title, doi: w.doi });
  }
  return out;
}

/** A title's outcome from its record: no engine involved, said so in the report. */
export function officialOutcome(official: { title: string; doi: string }): SegmentOutcome {
  return {
    id: '',
    text: official.title,
    untranslated: false,
    cached: false,
    attempts: 0,
    issues: [
      {
        code: 'OFFICIAL_TITLE',
        severity: 'info',
        detail: `the work's own title in the target language, from Crossref (doi:${official.doi})`,
      },
    ],
    notes: ['official-title'],
    findings: [],
  };
}
