import type { Role } from '../core/ir/types';

/** Layout repair policy (LAYOUT_REPAIR.md §9, condense roles narrowed by ADR-008). */
export interface Policy {
  minScale: Partial<Record<Role, number>> & { default: number };
  minFontPt: { default: number; label: number; absolute: number };
  tracking: { minEm: number };
  wordSpacing: { minRatio: number };
  minLineHeightRatio: number;
  expansion: { enabled: boolean; maxGrowRatio: number; minClearancePt: number };
  consistency: { sizeTolerancePt: number; maxScaleSpread: number };
  condense: { roles: Role[]; maxAttempts: number };
  fallback: Partial<Record<Role, 'annotation' | 'overflow-note' | 'keep-original'>> & {
    default: 'annotation' | 'overflow-note' | 'keep-original';
  };
  maxIterationsPerBlock: number;
  maxPassesPerPage: number;
  postApply: {
    renderDpi: number;
    maskDilatePt: number;
    collateralDiffThreshold: number;
    maxRebuilds: number;
  };
}

export const DEFAULT_POLICY: Policy = {
  minScale: {
    default: 0.8,
    body: 0.82,
    heading: 0.85,
    caption: 0.75,
    footnote: 0.78,
    'table-cell': 0.66,
    label: 0.65,
    header: 0.75,
    footer: 0.75,
  },
  minFontPt: { default: 6, label: 4.5, absolute: 5.5 },
  tracking: { minEm: -0.03 },
  wordSpacing: { minRatio: 0.9 },
  minLineHeightRatio: 1.05,
  expansion: { enabled: true, maxGrowRatio: 0.6, minClearancePt: 2 },
  consistency: { sizeTolerancePt: 0.2, maxScaleSpread: 0.06 },
  condense: { roles: ['label', 'table-cell'], maxAttempts: 2 },
  fallback: {
    default: 'overflow-note',
    label: 'annotation',
    'table-cell': 'annotation',
    header: 'keep-original',
    footer: 'keep-original',
  },
  maxIterationsPerBlock: 8,
  maxPassesPerPage: 3,
  postApply: { renderDpi: 96, maskDilatePt: 2, collateralDiffThreshold: 0.002, maxRebuilds: 2 },
};

export const minScaleFor = (policy: Policy, role: Role) =>
  policy.minScale[role] ?? policy.minScale.default;
