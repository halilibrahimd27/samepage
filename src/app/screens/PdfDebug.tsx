import { useEffect, useState } from 'react';
import type { BlockIR, PageIR, Role } from '../../core/ir/types';
import type { Thumbnail } from '../../pdf/engine';
import { pipelineClient } from '../pipelineClient';

/**
 * Debug overlay viewer (P3.3): blocks coloured by role, reading-order numbers, chain arrows,
 * table cells and columns over the rendered page. Developer tool, English only.
 */
const ROLE_COLOR: Record<Role, string> = {
  heading: '#7c3aed',
  body: '#2563eb',
  caption: '#0891b2',
  footnote: '#65a30d',
  header: '#a16207',
  footer: '#a16207',
  'page-number': '#78716c',
  'table-cell': '#ea580c',
  label: '#db2777',
  formula: '#dc2626',
  code: '#475569',
  reference: '#4d7c0f',
  unknown: '#000000',
};
const SCALE = 1.5;

const textOf = (b: BlockIR) => b.lines.map((l) => l.spans.map((s) => s.text).join('')).join(' ');

export function PdfDebug() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageIR[] | null>(null);
  const [index, setIndex] = useState(0);
  const [image, setImage] = useState<{ url: string; t: Thumbnail } | null>(null);
  const [selected, setSelected] = useState<BlockIR | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let active = true;
    pipelineClient
      .call((api) => api.analyzePdf(file, 60), 120_000)
      .then((p) => active && (setPages(p), setIndex(0)))
      .catch((e: unknown) => active && setError(String(e)));
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    if (!file || !pages) return;
    let active = true;
    let url = '';
    void pipelineClient
      .call((api) => api.renderPdfPage(file, index, SCALE), 60_000)
      .then((t) => {
        url = URL.createObjectURL(new Blob([t.png.slice()], { type: 'image/png' }));
        if (active) setImage({ url, t });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, pages, index]);

  const page = pages?.[index];
  const byId = new Map(page?.blocks.map((b) => [b.id, b]));

  return (
    <div className="flex flex-col gap-3" translate="no">
      <h2 className="text-2xl font-semibold">PDF analysis overlay</h2>
      <input
        type="file"
        accept="application/pdf"
        data-testid="pdf-debug-input"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {error && <p role="alert">{error}</p>}
      {pages && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded border px-2"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            ‹
          </button>
          <span data-testid="pdf-debug-page">
            page {index + 1} / {pages.length} · {page?.blocks.length} blocks ·{' '}
            {page?.columns.length || 1} column(s)
          </span>
          <button
            type="button"
            className="rounded border px-2"
            disabled={index + 1 >= pages.length}
            onClick={() => setIndex(index + 1)}
          >
            ›
          </button>
          {Object.entries(ROLE_COLOR).map(([role, color]) => (
            <span
              key={role}
              className="rounded px-1 text-xs text-white"
              style={{ background: color }}
            >
              {role}
            </span>
          ))}
        </div>
      )}
      {page && image && (
        <div className="relative w-full overflow-x-auto">
          <div className="relative" style={{ width: image.t.width, height: image.t.height }}>
            <img
              src={image.url}
              width={image.t.width}
              height={image.t.height}
              alt={`page ${index + 1}`}
            />
            <svg
              className="absolute inset-0"
              viewBox={`0 0 ${page.width} ${page.height}`}
              width={image.t.width}
              height={image.t.height}
              data-testid="pdf-debug-overlay"
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="#16a34a" />
                </marker>
              </defs>
              {page.columns.map((c, i) => (
                <rect
                  key={`c${i}`}
                  x={c.x0}
                  y={0}
                  width={c.x1 - c.x0}
                  height={page.height}
                  fill="#22c55e"
                  opacity={0.05}
                />
              ))}
              {page.blocks.map((b) => (
                <g key={b.id} onClick={() => setSelected(b)} className="cursor-pointer">
                  {b.tableCell && (
                    <rect
                      x={b.tableCell.cellRect.x0}
                      y={b.tableCell.cellRect.y0}
                      width={b.tableCell.cellRect.x1 - b.tableCell.cellRect.x0}
                      height={b.tableCell.cellRect.y1 - b.tableCell.cellRect.y0}
                      fill="none"
                      stroke={ROLE_COLOR['table-cell']}
                      strokeDasharray="2 2"
                      strokeWidth={0.5}
                    />
                  )}
                  <rect
                    x={b.bbox.x0}
                    y={b.bbox.y0}
                    width={b.bbox.x1 - b.bbox.x0}
                    height={b.bbox.y1 - b.bbox.y0}
                    fill={ROLE_COLOR[b.role]}
                    fillOpacity={b.translatable ? 0.12 : 0.3}
                    stroke={ROLE_COLOR[b.role]}
                    strokeWidth={selected?.id === b.id ? 1.5 : 0.6}
                  />
                  <text
                    x={b.bbox.x0 - 1}
                    y={b.bbox.y0 - 1}
                    fontSize={6}
                    fill={ROLE_COLOR[b.role]}
                    textAnchor="end"
                  >
                    {b.readingOrder}
                  </text>
                </g>
              ))}
              {page.blocks
                .filter((b) => b.chain?.next)
                .map((b) => {
                  const next = byId.get(b.chain!.next!);
                  const x1 = (b.bbox.x0 + b.bbox.x1) / 2;
                  const y1 = b.bbox.y1;
                  if (!next) {
                    return (
                      <text
                        key={`ch${b.id}`}
                        x={x1}
                        y={y1 + 7}
                        fontSize={7}
                        fill="#16a34a"
                        textAnchor="middle"
                      >
                        → {b.chain!.next}
                      </text>
                    );
                  }
                  return (
                    <line
                      key={`ch${b.id}`}
                      x1={x1}
                      y1={y1}
                      x2={(next.bbox.x0 + next.bbox.x1) / 2}
                      y2={next.bbox.y0}
                      stroke="#16a34a"
                      strokeWidth={1}
                      markerEnd="url(#arrow)"
                    />
                  );
                })}
            </svg>
          </div>
        </div>
      )}
      {selected && (
        <pre
          className="overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100"
          data-testid="pdf-debug-selected"
        >
          {JSON.stringify(
            {
              id: selected.id,
              role: selected.role,
              translatable: selected.translatable,
              align: selected.align,
              column: selected.columnIndex,
              order: selected.readingOrder,
              chain: selected.chain,
              tableCell: selected.tableCell,
              fonts: [
                ...new Set(
                  selected.lines.flatMap((l) => l.spans.map((s) => `${s.font.name} ${s.size}`)),
                ),
              ],
              text: textOf(selected).slice(0, 500),
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
