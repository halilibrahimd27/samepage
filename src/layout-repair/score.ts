import type { Issue, RepairStep, Severity } from './types';

/** LAYOUT_REPAIR.md §8: block (unit) score, page score, document score and status. */
const SEVERITY_COST: Record<Severity, number> = { error: 40, warning: 8, info: 1 };
const REPAIR_COST: Record<string, number> = {
  R1_MICRO: 0,
  R2_EXPAND: 1,
  R3_GROUP_SCALE: 1,
  R4_BLOCK_SCALE: 3,
  R5_CONDENSE: 6,
  R6_FALLBACK: 15,
};

export type Status = 'green' | 'yellow' | 'red';

export function unitScore(issues: Issue[], steps: RepairStep[]): number {
  const cost =
    issues.reduce((s, i) => s + SEVERITY_COST[i.severity], 0) +
    steps.reduce((s, st) => s + (REPAIR_COST[st.code] ?? 0), 0);
  return Math.max(0, 100 - cost);
}

export function statusOf(score: number, hasError: boolean): Status {
  if (hasError) return 'red';
  if (score >= 90) return 'green';
  if (score >= 70) return 'yellow';
  return 'red';
}

export interface PageScore {
  index: number;
  score: number;
  status: Status;
}

export function scoreDocument(
  pageCount: number,
  units: { pageIndex: number; score: number }[],
  issues: Issue[],
): { score: number; status: Status; pages: PageScore[] } {
  const pages: PageScore[] = [];
  for (let p = 0; p < pageCount; p++) {
    const scores = units.filter((u) => u.pageIndex === p).map((u) => u.score);
    const hasError = issues.some((i) => i.pageIndex === p && i.severity === 'error');
    let score = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 100;
    if (hasError) score = Math.min(score, 69);
    score = Math.round(score * 10) / 10;
    pages.push({ index: p, score, status: statusOf(score, hasError) });
  }
  const score =
    Math.round((pages.reduce((s, p) => s + p.score, 0) / Math.max(1, pages.length)) * 10) / 10;
  return {
    score,
    status: statusOf(
      score,
      issues.some((i) => i.severity === 'error'),
    ),
    pages,
  };
}
