import { reviewRows, wordDiff, type DiffToken } from '../../core/validate/align';
import { useI18n } from '../i18n';

function Marked({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((tok, i) =>
        tok.changed ? (
          <mark
            key={i}
            className={`rounded px-0.5 text-inherit ${tok.number ? 'bg-red-100' : 'bg-amber-100'}`}
          >
            {tok.text}
          </mark>
        ) : (
          tok.text
        ),
      )}
    </>
  );
}

/**
 * Source | translation | back-translation, sentence by sentence when they line up, with the
 * words that differ between the source and the back-translation marked (P8.3).
 */
export function BackTranslation(props: {
  source: string;
  target: string;
  back: string;
  sourceLang: string;
  targetLang: string;
}) {
  const { t } = useI18n();
  const rows = reviewRows(props.source, props.target, props.back);
  return (
    <details className="mt-1 text-xs" data-testid="back-translation">
      <summary className="cursor-pointer text-violet-800">{t('review.compare')}</summary>
      <p className="mt-1 text-slate-600">{t('review.compareHint')}</p>
      <div className="mt-1 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-x-2 border-spacing-y-1 text-left">
          <thead>
            <tr className="text-slate-500">
              <th className="w-1/3 font-medium">{t('review.source')}</th>
              <th className="w-1/3 font-medium">{t('review.translation')}</th>
              <th className="w-1/3 font-medium">{t('review.back')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const diff = wordDiff(r.source, r.back);
              return (
                <tr key={i} className="align-top">
                  <td lang={props.sourceLang}>
                    <Marked tokens={diff.source} />
                  </td>
                  <td lang={props.targetLang}>{r.target}</td>
                  <td lang={props.sourceLang} data-testid="back-translation-text">
                    <Marked tokens={diff.back} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
