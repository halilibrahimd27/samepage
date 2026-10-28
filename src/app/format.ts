import type { ProgressPhase } from '../core/pipeline/translate';
import type { MessageKey } from './i18n/en';

export function formatBytes(bytes: number, lang: string): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return new Intl.NumberFormat(lang, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    }).format(mb);
  }
  return new Intl.NumberFormat(lang, {
    style: 'unit',
    unit: 'kilobyte',
    maximumFractionDigits: 0,
  }).format(Math.max(1, bytes / 1024));
}

/** What the progress line says in each phase. */
export function phaseMessage(phase: ProgressPhase | undefined): MessageKey {
  if (phase === 'check') return 'workspace.checking';
  if (phase === 'ocr') return 'workspace.ocr';
  if (phase === 'polish') return 'workspace.polishing';
  return 'workspace.translating';
}
