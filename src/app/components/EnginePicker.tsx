import { ENGINES, isChromeTranslatorPresent, type EngineId } from '../../engines/catalog';
import { useI18n } from '../i18n';

const PRIVACY_STYLE = {
  'on-device': 'bg-emerald-100 text-emerald-900',
  'local-server': 'bg-sky-100 text-sky-900',
  'third-party-api': 'bg-amber-100 text-amber-900',
  'browser-vendor': 'bg-sky-100 text-sky-900',
} as const;

export function EnginePicker(props: {
  value: EngineId;
  onChange: (id: EngineId) => void;
  showTestEngine: boolean;
  showAdvanced: boolean;
}) {
  const { t } = useI18n();
  const chromePresent = isChromeTranslatorPresent();
  const engines = ENGINES.filter(
    (e) =>
      (props.showTestEngine || !e.testOnly) &&
      (props.showAdvanced || !e.advanced || e.id === props.value),
  );

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('config.engine')}</legend>
      {engines.map((engine) => {
        const unavailable = engine.id === 'chrome-builtin' && !chromePresent;
        return (
          <label
            key={engine.id}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
              props.value === engine.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'
            } ${unavailable ? 'opacity-60' : ''}`}
          >
            <input
              type="radio"
              name="engine"
              value={engine.id}
              checked={props.value === engine.id}
              disabled={unavailable}
              onChange={() => props.onChange(engine.id)}
              className="mt-1"
            />
            <span className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(`engine.${engine.id}.label`)}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${PRIVACY_STYLE[engine.privacy]}`}
                  data-testid={`privacy-${engine.id}`}
                >
                  {t(`privacy.${engine.privacy}`)}
                </span>
                {engine.draftQuality && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                    {t('engine.badge.draft')}
                  </span>
                )}
                {unavailable && (
                  <span className="text-xs text-slate-600">{t('engine.badge.unavailable')}</span>
                )}
              </span>
              <span className="text-sm text-slate-600">{t(`engine.${engine.id}.description`)}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
