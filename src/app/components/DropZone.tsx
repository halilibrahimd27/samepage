import { useId, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n';

const ACCEPT =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useI18n();
  const inputId = useId();
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
        over ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'
      }`}
    >
      <p className="text-lg font-medium">{t('drop.title')}</p>
      <p className="text-sm text-slate-600">{t('drop.hint')}</p>
      <label
        htmlFor={inputId}
        className="cursor-pointer rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white focus-within:ring-2 focus-within:ring-blue-400 hover:bg-blue-700"
      >
        {t('drop.choose')}
        <input
          id={inputId}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          data-testid="file-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
