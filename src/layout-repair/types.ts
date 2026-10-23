import type { Rect } from '../core/ir/types';

export type Severity = 'info' | 'warning' | 'error';

export type IssueCode =
  | 'OVERFLOW'
  | 'COLLISION'
  | 'OUT_OF_BOUNDS'
  | 'BELOW_MIN_SIZE'
  | 'SCALE_INCONSISTENT'
  | 'CHAIN_BROKEN'
  | 'MISSING_GLYPH'
  | 'UNTRANSLATED'
  | 'KEPT_ORIGINAL'
  | 'OVERFLOW_NOTE'
  | 'ANNOTATION'
  | 'RESIDUAL_SOURCE'
  | 'TEXT_NOT_EXTRACTABLE'
  | 'COLLATERAL_DAMAGE';

export type RepairCode =
  'R1_MICRO' | 'R2_EXPAND' | 'R3_GROUP_SCALE' | 'R4_BLOCK_SCALE' | 'R5_CONDENSE' | 'R6_FALLBACK';
export type FallbackKind = 'relaxed-min' | 'annotation' | 'overflow-note' | 'keep-original';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  pageIndex: number;
  unitId?: string;
  bbox?: Rect;
  metrics?: Record<string, number>;
  message: string;
}

export interface RepairStep {
  code: RepairCode;
  unitId: string;
  note: string;
}

export interface LayoutParams {
  scale: number;
  trackingEm: number;
  leading: number;
  spaceFactor: number;
  boxes: Record<string, Rect>;
}
