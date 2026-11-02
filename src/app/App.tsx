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
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-blue-900" />
      <rect x="7" y="7" width="12" height="16" rx="2" className="fill-blue-300/60" />
      <rect x="12" y="10" width="13" height="16" rx="2" className="fill-white" />
      <path
        d="M15 15h7M15 18h7M15 21h4.5"
        className="stroke-blue-900"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-none text-emerald-300">
    <path fill="currentColor" d="M8.1 13.6 4.5 10l1.1-1.1 2.5 2.5 6.3-6.3 1.1 1.1z" />
  </svg>
);

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
        <header
          translate="no"
          className="notranslate sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
            <a href="#" className="flex items-center gap-3">
              <Logo />
              <span className="leading-tight">
                <h1 className="text-lg font-semibold tracking-tight text-slate-900">samepage</h1>
                <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                  {t('header.badge')}
                </span>
              </span>
            </a>
            <nav className="flex items-center gap-1 text-sm">
              <a
                href="#quality"
                aria-current={route === '#quality' ? 'page' : undefined}
                className={`rounded-md px-3 py-2 font-medium ${
                  route === '#quality'
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {t('header.quality')}
              </a>
              <a
                href={REPO_URL}
                rel="noopener noreferrer"
                className="rounded-md px-3 py-2 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                GitHub
              </a>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="ml-2 inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 font-medium text-slate-800 shadow-sm hover:border-slate-400 hover:bg-slate-50"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 text-slate-500">
                  <path
                    fill="currentColor"
                    d="M11.5 1.5h-3l-.5 2.3a6.6 6.6 0 0 0-1.6.9L4.2 4l-1.5 2.6 1.7 1.6a6.7 6.7 0 0 0 0 1.8L2.7 11.6 4.2 14.2l2.2-.7c.5.4 1 .7 1.6.9l.5 2.3h3l.5-2.3c.6-.2 1.1-.5 1.6-.9l2.2.7 1.5-2.6-1.7-1.6a6.7 6.7 0 0 0 0-1.8l1.7-1.6L15.8 4l-2.2.7a6.6 6.6 0 0 0-1.6-.9zM10 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6"
                  />
                </svg>
                {t('header.settings')}
              </button>
            </nav>
          </div>
        </header>

        {route === '' || route === '#' ? (
          <section
            translate="no"
            className="notranslate bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 text-white"
          >
            <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">
                {t('header.badge')}
              </p>
              <p className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-[2.6rem]">
                {t('hero.title')}
              </p>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-blue-100/90">
                {t('hero.subtitle')}
              </p>
              <ul className="mt-8 grid max-w-4xl gap-3 text-sm sm:grid-cols-3">
                {(['trust.meaning', 'trust.numbers', 'trust.private'] as const).map((key) => (
                  <li
                    key={key}
                    className="flex items-start gap-2.5 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-blue-50"
                  >
                    <Check />
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
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex max-w-xl items-start gap-3">
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="mt-0.5 h-4 w-4 flex-none text-slate-400"
              >
                <path
                  fill="currentColor"
                  d="M10 1.7 3.5 4.2v4.6c0 4 2.8 7.7 6.5 9.5 3.7-1.8 6.5-5.5 6.5-9.5V4.2zm-1.1 11.5L6 10.3l1.1-1.1 1.8 1.8 4-4 1.1 1.1z"
                />
              </svg>
              <p>{t('footer.privacy')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a
                href="#quality"
                className="font-medium text-slate-700 hover:text-blue-700"
                data-testid="quality-link"
              >
                {t('footer.quality')}
              </a>
              <a
                href={REPO_URL}
                className="font-medium text-slate-700 hover:text-blue-700"
                rel="noopener noreferrer"
              >
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
