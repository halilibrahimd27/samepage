import type { ProgressPhase } from '../../core/pipeline/translate';

/** Thin progress bar under the Translate button (OCR, translation, then the meaning check). */
export function ProgressBar({
  done,
  total,
  phase,
}: {
  done: number;
  total: number;
  phase?: ProgressPhase | undefined;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${
          phase === 'check' || phase === 'polish'
            ? 'bg-violet-600'
            : phase === 'ocr'
              ? 'bg-amber-500'
              : 'bg-blue-600'
        }`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
