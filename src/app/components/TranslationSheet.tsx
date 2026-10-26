import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { tokenize } from '../../core/segment/codec';
import { languageName } from '../../core/languages';
import { detectBrowser, sheetStore } from '../bridges/browserTranslator';
import {
  harvestTagged,
  looksTranslated,
  pageTranslationState,
  renderTagged,
} from '../bridges/pageTranslation';
import { useI18n } from '../i18n';

/** Quiet period after the last DOM change before a partially translated batch is returned. */
const SETTLE_MS = 6000;
/** Without any change after this long, the user probably has not picked the target language. */
const STUCK_MS = 20_000;

/**
 * The `browser` engine's translation sheet (ADR-015). Renders the pending batch in the source
 * language; once the user turns on the browser's page translation, harvests the result.
 * Everything else in the app is marked translate="no".
 */
export function TranslationSheet() {
  const { t, lang } = useI18n();
  const batch = useSyncExternalStore(sheetStore.subscribe, sheetStore.get);
  const root = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [state, setState] = useState(pageTranslationState());
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!batch || !el) return;
    const html = document.documentElement;
    const previousLang = html.lang;
    if (!pageTranslationState().chromeTranslated) html.lang = batch.pair.source;

    el.replaceChildren();
    const items = batch.texts.map((text, i) => {
      const p = document.createElement('p');
      p.dataset.seg = String(i);
      p.dataset.tags = tokenize(text)
        .filter((tok) => tok.type === 'open')
        .map((tok) => (tok as { id: string }).id)
        .join(',');
      renderTagged(p, text);
      p.className = 'mb-2';
      el.append(p);
      return p;
    });

    let firstChange = 0;
    let lastChange = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      sheetStore.finish(
        batch.id,
        items.map((p, i) => (looksTranslated(p) ? harvestTagged(p) : batch.texts[i]!)),
      );
    };
    const check = () => {
      const done = items.filter(looksTranslated).length;
      setProgress({ done, total: items.length });
      setState(pageTranslationState());
      if (done === items.length) setTimeout(finish, 500); // let the browser finish its last node
    };
    const stuckTimer = setTimeout(() => setStuck(!firstChange), STUCK_MS);
    const observer = new MutationObserver(() => {
      const now = performance.now();
      if (!firstChange) {
        firstChange = now;
        setStuck(false);
      }
      lastChange = now;
      check();
    });
    observer.observe(el, { subtree: true, childList: true, characterData: true });
    const htmlObserver = new MutationObserver(() => setState(pageTranslationState()));
    htmlObserver.observe(html, { attributes: true, attributeFilter: ['class', 'lang'] });
    const timer = setInterval(() => {
      if (firstChange && performance.now() - lastChange > SETTLE_MS) finish();
    }, 1000);
    check();
    return () => {
      observer.disconnect();
      htmlObserver.disconnect();
      clearInterval(timer);
      clearTimeout(stuckTimer);
      if (!pageTranslationState().chromeTranslated) html.lang = previousLang;
    };
  }, [batch]);

  if (!batch) return null;
  const target = languageName(batch.pair.target, lang);
  const translatedTo = state.htmlLang && state.chromeTranslated ? state.htmlLang.slice(0, 2) : '';
  const wrongLanguage = translatedTo && translatedTo !== batch.pair.target;

  return (
    <section
      className="flex flex-col gap-3 rounded-xl border-2 border-blue-400 bg-blue-50 p-4"
      data-testid="translation-sheet"
    >
      <div translate="no" className="notranslate flex flex-col gap-2 text-sm">
        <h3 className="text-lg font-semibold">{t('sheet.title')}</h3>
        <p>{t('sheet.intro')}</p>
        <p className="font-medium">{t(`sheet.step.${detectBrowser()}`, { target })}</p>
        <p className="text-slate-600">{t('sheet.privacy')}</p>
        <p aria-live="polite" data-testid="sheet-progress">
          {progress.done === 0 ? t('sheet.waiting') : t('sheet.progress', progress)}
        </p>
        {stuck && !wrongLanguage && (
          <p role="alert" className="text-amber-800" data-testid="sheet-stuck">
            {t('sheet.stuck', { target })} {'Translator' in globalThis && t('sheet.stuckChrome')}
          </p>
        )}
        {wrongLanguage && (
          <p role="alert" className="text-amber-800">
            {t('sheet.wrongLanguage', { got: languageName(translatedTo, lang), target })}
          </p>
        )}
        <button
          type="button"
          className="self-start rounded border border-slate-400 px-3 py-1"
          onClick={() => sheetStore.cancel()}
        >
          {t('playground.cancel')}
        </button>
      </div>
      <div
        ref={root}
        lang={batch.pair.source}
        className="max-h-96 overflow-y-auto rounded border border-slate-200 bg-white p-3 font-serif"
      />
    </section>
  );
}
