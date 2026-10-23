import { useEffect, useRef, type ClipboardEvent } from 'react';
import { tokenize } from '../../core/segment/codec';
import { harvestTagged, renderTagged } from '../bridges/pageTranslation';
import { useI18n } from '../i18n';

/**
 * Edits a tagged translation in place: styled runs stay as spans, placeholders are locked
 * (contenteditable=false). Pasting inserts plain text only.
 */
export function SegmentEditor(props: {
  tagged: string;
  source: string;
  onSave: (tagged: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    renderTagged(el, props.tagged || props.source);
    el.dataset.tags = tokenize(props.source)
      .filter((tok) => tok.type === 'open')
      .map((tok) => (tok as { id: string }).id)
      .join(',');
    el.querySelectorAll<HTMLElement>('[data-ph]').forEach((ph) => (ph.contentEditable = 'false'));
    el.focus();
  }, [props.tagged, props.source]);

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t('result.translation')}
        onPaste={onPaste}
        className="min-h-16 rounded border border-blue-400 bg-white p-2 font-serif focus:outline-2 focus:outline-blue-500 [&_[data-ph]]:mx-0.5 [&_[data-ph]]:rounded [&_[data-ph]]:bg-slate-200 [&_[data-ph]]:px-1 [&_[data-ph]]:text-xs [&_[data-t]]:underline [&_[data-t]]:decoration-dotted"
        data-testid="segment-editor"
      />
      <p className="text-xs text-slate-500">{t('review.hint')}</p>
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          className="rounded bg-blue-600 px-3 py-1 text-white"
          onClick={() => ref.current && props.onSave(harvestTagged(ref.current))}
        >
          {t('review.save')}
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1"
          onClick={props.onCancel}
        >
          {t('review.cancel')}
        </button>
      </div>
    </div>
  );
}
