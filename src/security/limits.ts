/** File limits enforced before any heavy work (SECURITY.md §3). */
export const LIMITS = {
  pdfMaxBytes: 100 * 1024 * 1024,
  pdfMaxPages: 2000,
  docxMaxBytes: 50 * 1024 * 1024,
  /** Slides carry pictures: presentations are larger than text documents. */
  pptxMaxBytes: 100 * 1024 * 1024,
  docxMaxEntries: 5_000,
  docxMaxUncompressedBytes: 500 * 1024 * 1024,
  docxMaxCompressionRatio: 100,
} as const;

/** A `.samepage` project: the largest document plus its translations (P9.5). */
export const PROJECT_MAX_BYTES = LIMITS.pdfMaxBytes + 50 * 1024 * 1024;

/**
 * A TMX translation memory to import: the file, the translation units read from it (the rest
 * are skipped and counted) and the length of one segment.
 */
export const TMX_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxUnits: 20_000,
  maxSegmentChars: 20_000,
} as const;
