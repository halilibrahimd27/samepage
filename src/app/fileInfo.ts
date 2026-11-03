import type { FileRejection } from '../security/fileCheck';
import { formatBytes } from './format';
import type { Translate } from './i18n';

/** Why a file cannot be opened, in the user's language. */
export function rejectionMessage(r: FileRejection, t: Translate, lang: string): string {
  switch (r.reason) {
    case 'empty':
      return t('error.empty');
    case 'unsupported':
      return t('error.unsupported');
    case 'docm':
      return t('error.docm');
    case 'too-large':
      return t('error.tooLarge', {
        kind: r.kind.toUpperCase(),
        limit: formatBytes(r.limitBytes, lang),
      });
  }
}

/** Prose of a LaTeX file for language detection: commands, math and comments removed. */
export async function latexSample(file: File): Promise<string> {
  // A project .zip is not read here: the language is checked by the user.
  if (!/\.tex$/i.test(file.name)) return '';
  const text = await file.slice(0, 200_000).text();
  return text
    .replace(/%.*$/gm, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ')
    .replace(/[{}]/g, ' ');
}
