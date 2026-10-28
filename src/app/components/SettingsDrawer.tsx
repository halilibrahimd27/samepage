import { useEffect, useRef, useState } from 'react';
import { pipelineClient } from '../pipelineClient';
import { useI18n, UI_LANGS, type UiLang } from '../i18n';
import type { Settings } from '../settings';

const TOGGLES = [
  ['autoTranslate', 'settings.autoTranslate', 'settings.autoTranslateHint'],
  ['fidelityCheck', 'settings.fidelityCheck', 'settings.fidelityCheckHint'],
  ['translateReferences', 'settings.translateReferences', null],
  ['localCitations', 'settings.localCitations', 'settings.localCitationsHint'],
  ['translateComments', 'settings.translateComments', null],
  ['translateMetadata', 'settings.translateMetadata', null],
  ['showAdvancedEngines', 'settings.showAdvancedEngines', null],
  ['showTestEngine', 'settings.showTestEngine', null],
] as const;

const UI_LANG_NAMES: Record<UiLang, string> = { en: 'English', tr: 'Türkçe' };

export function SettingsDrawer(props: {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      aria-labelledby="settings-title"
      className="m-0 ml-auto h-full max-h-none w-full max-w-sm p-6 backdrop:bg-slate-900/40"
    >
      <div className="flex items-center justify-between">
        <h2 id="settings-title" className="text-xl font-semibold">
          {t('settings.title')}
        </h2>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded px-2 py-1 hover:bg-slate-100"
        >
          {t('settings.close')}
        </button>
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-medium">{t('header.uiLanguage')}</legend>
        <div className="mt-2 flex gap-4">
          {UI_LANGS.map((lang) => (
            <label key={lang} className="flex items-center gap-2">
              <input
                type="radio"
                name="ui-lang"
                checked={props.settings.uiLang === lang}
                onChange={() => props.onChange({ uiLang: lang })}
              />
              <span lang={lang}>{UI_LANG_NAMES[lang]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-col gap-4">
        {TOGGLES.map(([key, label, hint]) => (
          <label key={key} className="flex gap-3">
            <input
              type="checkbox"
              checked={props.settings[key]}
              onChange={(e) => props.onChange({ [key]: e.target.checked })}
              className="mt-1"
            />
            <span>
              <span className="block">{t(label)}</span>
              {hint && <span className="block text-sm text-slate-600">{t(hint)}</span>}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-8 flex flex-col items-start gap-3 border-t border-slate-200 pt-6 text-sm">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
          onClick={() =>
            void pipelineClient.call((api) => api.clearCache()).then(() => setCacheCleared(true))
          }
        >
          {t('settings.clearCache')}
        </button>
        {cacheCleared && <p role="status">{t('settings.cacheCleared')}</p>}
        <a href="#playground" className="text-blue-700 underline" onClick={props.onClose}>
          {t('settings.playground')}
        </a>
      </div>
    </dialog>
  );
}
