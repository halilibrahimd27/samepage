import { ANTHROPIC_MODELS } from '../../engines/anthropicModels';
import type { EngineConfig } from '../engineConfig';
import { useI18n } from '../i18n';
import type { Settings } from '../settings';
import { EnginePicker } from './EnginePicker';
import { LanguageSelect } from './LanguageSelect';

const input = 'rounded-md border border-slate-300 bg-white px-3 py-2';

export function EngineConfigPanel({
  config,
  settings,
}: {
  config: EngineConfig;
  settings: Settings;
}) {
  const { t } = useI18n();
  const sameLanguage = config.source === config.target;
  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <LanguageSelect
          label={t('config.source')}
          value={config.source}
          onChange={config.setSource}
        />
        <LanguageSelect
          label={t('config.target')}
          value={config.target}
          onChange={config.setTarget}
        />
        {sameLanguage && (
          <p role="alert" className="text-sm text-red-800 sm:col-span-2">
            {t('config.sameLanguage')}
          </p>
        )}
      </section>

      <EnginePicker
        value={config.engine}
        onChange={config.setEngine}
        showTestEngine={settings.showTestEngine}
        showAdvanced={settings.showAdvancedEngines}
      />

      {config.engine === 'anthropic' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="anthropic-model" className="text-sm font-medium">
              {t('model.label')}
            </label>
            <select
              id="anthropic-model"
              value={config.anthropicModel}
              onChange={(e) => config.setAnthropicModel(e.target.value)}
              className={input}
            >
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {t(`model.${m.tier}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="api-key" className="text-sm font-medium">
              {t('key.label')}
            </label>
            <input
              id="api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={config.apiKey.key}
              onChange={(e) => config.apiKey.setKey(e.target.value)}
              className={`${input} font-mono`}
            />
          </div>
          <div className="flex flex-col gap-1 text-sm text-slate-600 sm:col-span-2">
            <p>{t('key.hint')}</p>
            <label className="flex items-center gap-2 text-slate-800">
              <input
                type="checkbox"
                checked={config.apiKey.remember}
                onChange={(e) => config.apiKey.setRemember(e.target.checked)}
              />
              {t('key.remember')}
            </label>
            {config.apiKey.remember && <p className="text-amber-800">{t('key.rememberWarning')}</p>}
            {config.apiKey.key && (
              <button type="button" className="self-start underline" onClick={config.apiKey.forget}>
                {t('key.forget')}
              </button>
            )}
          </div>
        </div>
      )}

      {config.engine === 'openai-compatible' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="base-url" className="text-sm font-medium">
              {t('baseUrl.label')}
            </label>
            <input
              id="base-url"
              type="url"
              value={config.baseUrl}
              onChange={(e) => config.setBaseUrl(e.target.value)}
              className={`${input} font-mono`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="local-model" className="text-sm font-medium">
              {t('localModel.label')}
            </label>
            <input
              id="local-model"
              value={config.localModel}
              onChange={(e) => config.setLocalModel(e.target.value)}
              className={`${input} font-mono`}
            />
          </div>
          <p className="text-sm text-slate-600 sm:col-span-2">
            {t('baseUrl.hint')} {t('localModel.hint')}
          </p>
        </div>
      )}
    </div>
  );
}
