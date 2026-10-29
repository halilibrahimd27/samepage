import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { meaningParts, type ShownIssue } from '../issues';

/** Codes with a plain-language explanation (the raw detail stays visible for specialists). */
const EXPLAINED = new Set([
  'UNTRANSLATED',
  'NUMBER_MISMATCH',
  'CITATION_MISMATCH',
  'TAG_MISMATCH',
  'PLACEHOLDER_MISMATCH',
  'WRONG_LANGUAGE',
  'REVIEW_SUGGESTED',
  'PARTLY_UNTRANSLATED',
  'STYLE_APPROXIMATED',
  'GLOSSARY_MISMATCH',
  'KEPT_ORIGINAL',
  'BELOW_MIN_SIZE',
  'OCR_LOW_CONFIDENCE',
  'PUNCTUATION_CHANGED',
  'TABLE_NOT_RECOGNISED',
  'POST_EDITED',
]);

/** Issues of one paragraph: meaning findings with their back-translation, then the others. */
export function IssueList({ issues }: { issues: ShownIssue[] }) {
  const { t } = useI18n();
  if (!issues.length) return null;
  const tone = (s: ShownIssue['severity']) =>
    s === 'error' ? 'text-red-800' : s === 'warning' ? 'text-amber-800' : 'text-slate-600';
  return (
    <ul className="mt-2 flex flex-col gap-1.5 text-xs">
      {issues.map((issue, i) => {
        if (issue.code === 'MEANING_DRIFT') {
          const { kind, back } = meaningParts(issue.detail);
          return (
            <li
              key={i}
              className="rounded-md border border-violet-200 bg-violet-50 p-2 text-violet-950"
              data-testid="meaning-finding"
            >
              <span className="font-medium">{t('meaning.title')}:</span>{' '}
              {kind === 'other' ? issue.detail : t(`meaning.${kind}` as MessageKey)}
              {back && (
                <p className="mt-1 text-violet-900">
                  <span className="font-medium">{t('meaning.back')}:</span> <q>{back}</q>
                </p>
              )}
            </li>
          );
        }
        return (
          <li key={i} className={tone(issue.severity)}>
            {EXPLAINED.has(issue.code) ? t(`issue.${issue.code}` as MessageKey) : issue.detail}{' '}
            <span className="font-mono text-[0.7rem] opacity-70" title={issue.detail}>
              ({issue.code}
              {EXPLAINED.has(issue.code) && issue.detail ? `: ${issue.detail}` : ''})
            </span>
          </li>
        );
      })}
    </ul>
  );
}
