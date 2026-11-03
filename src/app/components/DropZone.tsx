import { useId, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n';

const ACCEPT =
  '.pdf,.docx,.pptx,.tex,.zip,.samepage,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** One file opens as before; several go to the batch. */
export function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useI18n();
  const inputId = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-8 py-12 text-center shadow-sm transition-colors ${
        over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-blue-300'
      }`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-700">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
          />
        </svg>
      </span>
      <p className="text-lg font-semibold tracking-tight text-slate-900">{t('drop.title')}</p>
      <p className="max-w-md text-sm text-slate-600">{t('drop.hint')}</p>
      <label
        htmlFor={inputId}
        className="mt-1 cursor-pointer rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm focus-within:ring-2 focus-within:ring-blue-400 hover:bg-blue-800"
      >
        {t('drop.choose')}
        <input
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) onFiles(files);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
