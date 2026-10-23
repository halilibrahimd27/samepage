import { useEffect, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsDrawer } from './components/SettingsDrawer';
import { WorkerStatus } from './components/WorkerStatus';
import { useI18n } from './i18n';
import { I18nProvider } from './i18n/I18nProvider';
import { Workspace } from './screens/Workspace';
import { useSettings, type Settings } from './settings';

const REPO_URL = 'https://github.com/halilibrahimd27/samepage';

export function App() {
  const [settings, updateSettings] = useSettings();
  useEffect(() => {
    document.documentElement.lang = settings.uiLang;
  }, [settings.uiLang]);

  return (
    <I18nProvider lang={settings.uiLang}>
      <Shell settings={settings} updateSettings={updateSettings} />
    </I18nProvider>
  );
}

function Shell(props: { settings: Settings; updateSettings: (patch: Partial<Settings>) => void }) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <ErrorBoundary
      fallback={(reset) => (
        <div role="alert" className="mx-auto max-w-3xl p-8">
          <p>{t('error.generic')}</p>
          <button type="button" className="mt-2 underline" onClick={reset}>
            {t('error.tryAgain')}
          </button>
        </div>
      )}
    >
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="mx-auto flex max-w-3xl items-center justify-between px-6 pt-8">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">samepage</h1>
            <p className="mt-1 text-slate-600">{t('app.tagline')}</p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            {t('header.settings')}
          </button>
        </header>

        <main className="mx-auto max-w-3xl px-6 py-8">
          <Workspace settings={props.settings} />
        </main>

        <footer className="mx-auto flex max-w-3xl flex-col gap-2 px-6 pb-10 text-sm text-slate-600">
          <p>{t('footer.privacy')}</p>
          <a href={REPO_URL} className="underline" rel="noopener noreferrer">
            {t('footer.source')}
          </a>
          <WorkerStatus />
        </footer>
      </div>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={props.settings}
        onChange={props.updateSettings}
      />
    </ErrorBoundary>
  );
}
