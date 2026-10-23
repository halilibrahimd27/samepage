import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

/**
 * Renders a DOCX with docx-preview inside a sandboxed iframe (no allow-scripts): document
 * content can never run script or navigate the app (SECURITY.md §6). Embedded fonts are
 * ignored (CSP font-src 'self') and images use data: URLs.
 */
export function DocxPreview({ data, label }: { data: Blob; label: string }) {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  // Render only after the srcdoc document has loaded, otherwise it replaces our content.
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    if (!frameLoaded) return;
    let active = true;
    const render = async () => {
      const doc = frame.current?.contentDocument;
      if (!doc) return;
      const { renderAsync } = await import('docx-preview');
      doc.body.replaceChildren();
      doc.head.replaceChildren();
      await renderAsync(data, doc.body, doc.head, {
        ignoreFonts: true,
        useBase64URL: true,
        breakPages: true,
        inWrapper: true,
        renderComments: false,
      });
      if (active) setState('ready');
    };
    render().catch(() => active && setState('failed'));
    return () => {
      active = false;
    };
  }, [data, frameLoaded]);

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-sm font-medium">{label}</figcaption>
      {state === 'loading' && <p className="text-sm text-slate-600">{t('preview.loading')}</p>}
      {state === 'failed' && <p className="text-sm text-amber-800">{t('preview.failed')}</p>}
      <iframe
        ref={frame}
        title={label}
        sandbox="allow-same-origin"
        onLoad={() => setFrameLoaded(true)}
        srcDoc="<!doctype html><html><head></head><body></body></html>"
        className="h-[32rem] w-full rounded border border-slate-200 bg-slate-100"
        data-testid={`preview-${label}`}
      />
    </figure>
  );
}
