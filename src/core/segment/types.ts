import type { Role } from '../ir/types';

/**
 * Atomic placeholder kinds (TRANSLATION.md §3):
 * F inline formula, N footnote mark, U URL/DOI/e-mail, C inline code, I inline image/drawing,
 * T tab, B manual line break, R cross-reference field result, L literal text that looked like
 * markup in the source (escaped so the codec stays unambiguous), G glossary term protected for
 * engines without glossary support (restored with the glossary target).
 */
export type PlaceholderKind = 'F' | 'N' | 'U' | 'C' | 'I' | 'T' | 'B' | 'R' | 'L' | 'G';

export interface PlaceholderDef {
  /** e.g. "F1" — rendered as ⟦F1⟧. */
  id: string;
  kind: PlaceholderKind;
  /** Original content restored on decode (formula text, URL, literal, …). */
  text: string;
  /** Format-specific payload (e.g. a DOCX run XML id); opaque to the codec. */
  ref?: string;
}

export interface TagDef<S = unknown> {
  /** e.g. "t1" — rendered as <t1>…</t1>. */
  id: string;
  style: S;
}

export interface Segment<S = unknown> {
  id: string;
  blockIds: string[];
  role: Role;
  /** Tagged source: "We use <t1>MuPDF</t1> ⟦F1⟧ …" */
  source: string;
  baseStyle: S;
  tags: TagDef<S>[];
  placeholders: PlaceholderDef[];
  budgetChars?: number;
  target?: string;
  flags: { condensed?: boolean; manual?: boolean; untranslated?: boolean };
}
