/** File limits enforced before any heavy work (SECURITY.md §3). */
export const LIMITS = {
  pdfMaxBytes: 100 * 1024 * 1024,
  pdfMaxPages: 500,
  docxMaxBytes: 50 * 1024 * 1024,
  /** Slides carry pictures: presentations are larger than text documents. */
  pptxMaxBytes: 100 * 1024 * 1024,
  docxMaxEntries: 5_000,
  docxMaxUncompressedBytes: 500 * 1024 * 1024,
  docxMaxCompressionRatio: 100,
} as const;
