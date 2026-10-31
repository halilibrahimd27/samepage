import { useEffect, useState, useSyncExternalStore } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsDrawer } from './components/SettingsDrawer';
import { WorkerStatus } from './components/WorkerStatus';
import { useI18n } from './i18n';
import { I18nProvider } from './i18n/I18nProvider';
import { useEngineConfig } from './engineConfig';
import { PdfDebug } from './screens/PdfDebug';
import { Playground } from './screens/Playground';
import { Quality } from './screens/Quality';
import { TranslateTest } from './screens/TranslateTest';
import { Workspace } from './screens/Workspace';
import { setAutomaticTranslation } from './bridges/browserTranslator';
import { useSettings, type Settings } from './settings';

const REPO_URL = 'https://github.com/halilibrahimd27/samepage';

/** Two pages, the second set over the first: the same page in another language. */
function Logo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="h-9 w-9 flex-none">
      <rect
        x="3"
        y="2"
        width="18"
        height="24"
        rx="3"
        className="fill-blue-100 stroke-blue-700"
        strokeWidth="1.5"
      />
      <rect
        x="11"
        y="6"
        width="18"
        height="24"
        rx="3"
        className="fill-white stroke-blue-700"
        strokeWidth="1.5"
      />
      <path
        d="M15 13h10M15 17h10M15 21h7"
        className="stroke-blue-700"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function App() {
  const [settings, updateSettings] = useSettings();
  useEffect(() => {
    document.documentElement.lang = settings.uiLang;
  }, [settings.uiLang]);
  useEffect(() => setAutomaticTranslation(settings.autoTranslate), [settings.autoTranslate]);

  return (
    <I18nProvider lang={settings.uiLang}>
      <Shell settings={settings} updateSettings={updateSettings} />
    </I18nProvider>
  );
}

function useHashRoute(): string {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('hashchange', onChange);
      return () => window.removeEventListener('hashchange', onChange);
    },
    () => window.location.hash,
  );
}

function Shell(props: { settings: Settings; updateSettings: (patch: Partial<Settings>) => void }) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const config = useEngineConfig(props.settings);
  const route = useHashRoute();

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
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
        <header translate="no" className="notranslate border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
            <a href="#" className="flex items-center gap-3">
              <Logo />
              <span>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">samepage</h1>
                <span className="block text-xs font-medium uppercase tracking-wider text-blue-700">
                  {t('header.badge')}
                </span>
              </span>
            </a>
            <nav className="flex items-center gap-1 text-sm">
              <a
                href="#quality"
                className="rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                {t('header.quality')}
              </a>
              <a
                href={REPO_URL}
                rel="noopener noreferrer"
                className="rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              >
                GitHub
              </a>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="ml-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 shadow-sm hover:bg-slate-50"
              >
                {t('header.settings')}
              </button>
            </nav>
          </div>
        </header>

        {route === '' || route === '#' ? (
          <section translate="no" className="notranslate border-b border-slate-200 bg-white">
            <div className="mx-auto max-w-3xl px-6 pb-8 pt-6">
              <p className="text-2xl font-semibold leading-snug tracking-tight text-slate-900 sm:text-3xl">
                {t('hero.title')}
              </p>
              <p className="mt-2 text-slate-600">{t('hero.subtitle')}</p>
              <ul className="mt-5 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                {(['trust.meaning', 'trust.numbers', 'trust.private'] as const).map((key) => (
                  <li
                    key={key}
                    className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 20 20"
                      className="mt-0.5 h-4 w-4 flex-none text-emerald-600"
                    >
                      <path
                        fill="currentColor"
                        d="M8.1 13.6 4.5 10l1.1-1.1 2.5 2.5 6.3-6.3 1.1 1.1z"
                      />
                    </svg>
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* Page translation must not rewrite React's UI text; the sheet opts back in. */}
        <main
          translate="no"
          className="notranslate mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8"
        >
          {route === '#pdf-debug' ? (
            <PdfDebug />
          ) : route === '#translate-test' ? (
            <TranslateTest />
          ) : route === '#quality' ? (
            <Quality />
          ) : route === '#playground' ? (
            <Playground config={config} settings={props.settings} />
          ) : (
            <Workspace config={config} settings={props.settings} />
          )}
        </main>

        <footer translate="no" className="notranslate border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-6 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl">{t('footer.privacy')}</p>
            <div className="flex flex-wrap items-center gap-4">
              <a href="#quality" className="underline" data-testid="quality-link">
                {t('footer.quality')}
              </a>
              <a href={REPO_URL} className="underline" rel="noopener noreferrer">
                {t('footer.source')}
              </a>
              <WorkerStatus />
            </div>
          </div>
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
