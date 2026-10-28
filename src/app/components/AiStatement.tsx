import { useState } from 'react';
import { aiDisclosure } from '../../core/disclosure';
import type { LangPair } from '../../engines/types';
import { useI18n } from '../i18n';

/** The statement journals ask for when machine translation was used, ready to copy (P9.2). */
export function AiStatement({ engine, pair }: { engine: string; pair: LangPair }) {
  const { t } = useI18n();
  const { text, lang } = aiDisclosure(engine, pair);
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <details
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="ai-statement"
    >
      <summary className="cursor-pointer text-sm font-medium">{t('statement.title')}</summary>
      <p className="mt-2 text-xs text-slate-600">{t('statement.hint')}</p>
      <p
        lang={lang}
        className="mt-2 rounded-md bg-slate-50 p-3 text-sm leading-relaxed"
        data-testid="ai-statement-text"
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-2 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
      >
        {copied === 'ok' ? t('abstract.copied') : t('abstract.copy')}
      </button>
      {copied === 'failed' && (
        <p className="mt-1 text-xs text-rose-700">{t('abstract.copyFailed')}</p>
      )}
    </details>
  );
}
