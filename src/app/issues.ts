/** Issue helpers shared by the report panels. */
export interface ShownIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  detail: string;
}

/** Splits a meaning-check detail ("major: negation lost — back-translation: “…”"). */
export function meaningParts(detail: string): { kind: string; back?: string } {
  const [head, back] = detail.split(' — back-translation: ');
  const issue = (head ?? '').replace(/^(major|minor):\s*/, '');
  const kind = issue.startsWith('negation lost')
    ? 'negationLost'
    : issue.startsWith('negation added')
      ? 'negationAdded'
      : issue.startsWith('hedging lost')
        ? 'hedgingLost'
        : issue.startsWith('hedging added')
          ? 'hedgingAdded'
          : issue.startsWith('quantifier changed')
            ? 'quantifier'
            : 'other';
  return back ? { kind, back: back.replace(/^“|”$/g, '') } : { kind };
}

/** Sort key: errors first, then meaning findings, then warnings. */
export function urgency(issues: ShownIssue[]): number {
  if (issues.some((i) => i.severity === 'error')) return 0;
  if (issues.some((i) => i.code === 'MEANING_DRIFT')) return 1;
  if (issues.some((i) => i.severity === 'warning')) return 2;
  return 3;
}
