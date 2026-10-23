// The only module family allowed to import 'mupdf' (CLAUDE.md hard constraint #5).
// Verified against mupdf 1.28.1 type definitions — see ARCHITECTURE.md §5.
import type * as Mupdf from 'mupdf';

export type MupdfModule = typeof Mupdf;

let loading: Promise<MupdfModule> | null = null;

/** Lazy-loads MuPDF (≈10 MB WASM) on first use; later calls reuse the same instance. */
export function loadMupdf(): Promise<MupdfModule> {
  loading ??= import('mupdf');
  return loading;
}
