import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { pipelineClient } from '../pipelineClient';

/** Original and translated page images side by side (rendered by MuPDF in the worker). */
export function PdfPreview({
  original,
  translated,
  pageCount,
}: {
  original: Blob;
  translated: Blob;
  pageCount: number;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const [urls, setUrls] = useState<[string, string] | null>(null);

  useEffect(() => {
    let active = true;
    const made: string[] = [];
    const render = (file: Blob) =>
      pipelineClient
        .call((api) => api.renderPdfPage(file, page, 1.5), 60_000)
        .then((img) => {
          const url = URL.createObjectURL(new Blob([img.png.slice()], { type: 'image/png' }));
          made.push(url);
          return url;
        });
    void Promise.all([render(original), render(translated)]).then(
      ([a, b]) => active && setUrls([a, b]),
    );
    return () => {
      active = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [original, translated, page]);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          aria-label={t('preview.previous')}
          className="rounded border px-2"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          ‹
        </button>
        <span>{t('preview.pageOf', { page: page + 1, total: pageCount })}</span>
        <button
          type="button"
          aria-label={t('preview.next')}
          className="rounded border px-2"
          disabled={page + 1 >= pageCount}
          onClick={() => setPage(page + 1)}
        >
          ›
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[t('preview.original'), t('preview.translated')].map((label, i) => (
          <figure key={label} className="flex flex-col gap-1">
            <figcaption className="text-sm font-medium">{label}</figcaption>
            {urls ? (
              <img
                src={urls[i]}
                alt={`${label} — ${t('preview.pageOf', { page: page + 1, total: pageCount })}`}
                className="w-full rounded border border-slate-200 bg-white"
                data-testid={`pdf-preview-${i}`}
              />
            ) : (
              <p className="text-sm text-slate-600">{t('preview.loading')}</p>
            )}
          </figure>
        ))}
      </div>
    </section>
  );
}
