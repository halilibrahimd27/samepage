import { harvestTagged, looksTranslated, renderTagged } from '../app/bridges/pageTranslation';
import { tokenize } from '../core/segment/codec';

/**
 * Translation helper page (ADR-021): hosts Google's website translator so text is translated
 * automatically into the language the user chose, whatever the browser's own language. Runs in a
 * transparent, click-through frame of the app (same origin; its own CSP allows Google). Google
 * only translates what is on screen, so each batch is set in tiny type across many columns to
 * fit the viewport.
 *
 * Protocol (postMessage, same origin only): parent → { type: 'translate', id, texts };
 * helper → { type: 'ready' } | { type: 'result', id, texts } | { type: 'error', id?, message },
 * each tagged with the frame's channel `ch` (from the URL).
 */

interface TranslateElementCtor {
  new (options: { pageLanguage: string; autoDisplay: boolean }, elementId: string): unknown;
}
declare global {
  interface Window {
    gtInit?: () => void;
    google?: { translate?: { TranslateElement?: TranslateElementCtor } };
  }
}

const params = new URLSearchParams(location.search);
const source = params.get('sl') ?? 'en';
const target = params.get('tl') ?? 'tr';
const channel = params.get('ch') ?? '';
const sheet = document.getElementById('sheet')!;
const post = (message: object) => parent.postMessage({ ...message, ch: channel }, location.origin);

/** Quiet period after the last change before a batch counts as done. */
const SETTLE_MS = 2500;
/** A batch where nothing changes in this time failed. */
const NOTHING_MS = 20_000;
/** Upper bound for one batch. */
const MAX_MS = 60_000;

Object.assign(sheet.style, {
  position: 'fixed',
  inset: '0',
  overflow: 'hidden',
  columnGap: '1px',
  columnCount: '16',
  fontFamily: 'serif',
});
sheet.lang = source;

const waitFor = (test: () => boolean, ms: number) =>
  new Promise<void>((resolve, reject) => {
    const start = performance.now();
    const timer = setInterval(() => {
      if (test()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - start > ms) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, 100);
  });

window.gtInit = () => {
  const Ctor = window.google?.translate?.TranslateElement;
  if (!Ctor) return post({ type: 'error', message: 'Google Translate did not load' });
  new Ctor({ pageLanguage: source, autoDisplay: false }, 'gte');
  const combo = () => document.querySelector<HTMLSelectElement>('select.goog-te-combo');
  waitFor(() => (combo()?.options.length ?? 0) > 1, 20_000)
    .then(() => {
      const select = combo()!;
      select.value = target;
      select.dispatchEvent(new Event('change'));
      post({ type: 'ready' });
    })
    .catch(() => post({ type: 'error', message: 'Google Translate did not start' }));
};

// Google remembers the last pair in its own `googtrans` cookie and applies it to the next helper
// frame; after a back-translation (tr → en) the next en → tr frame would ask for tr → tr and fail.
// Each frame starts clean and gets its pair from the parameters above.
for (const domain of ['', `; domain=${location.hostname}`, `; domain=.${location.hostname}`])
  document.cookie = `googtrans=; max-age=0; path=/${domain}`;

const script = document.createElement('script');
script.src = 'https://translate.google.com/translate_a/element.js?cb=gtInit';
script.onerror = () => post({ type: 'error', message: 'Google Translate could not be loaded' });
document.head.append(script);

/** Shrinks the type until every paragraph of the batch is inside the viewport. */
function fit(): void {
  let size = 2;
  sheet.style.fontSize = `${size}px`;
  sheet.style.lineHeight = '1.2';
  while (sheet.scrollWidth > sheet.clientWidth + 1 && size > 0.3) {
    size *= 0.7;
    sheet.style.fontSize = `${size}px`;
  }
}

async function translate(texts: string[]): Promise<string[]> {
  const items = texts.map((text) => {
    const p = document.createElement('p');
    p.style.margin = '0 0 0.5em';
    p.dataset.tags = tokenize(text)
      .filter((t) => t.type === 'open')
      .map((t) => (t as { id: string }).id)
      .join(',');
    renderTagged(p, text);
    return p;
  });
  sheet.replaceChildren(...items);
  fit();
  let first = 0;
  let last = 0;
  const observer = new MutationObserver(() => {
    last = performance.now();
    first ||= last;
  });
  observer.observe(sheet, { subtree: true, childList: true, characterData: true });
  const start = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        const now = performance.now();
        const done = items.every(looksTranslated)
          ? now - last > 300
          : first > 0 && now - last > SETTLE_MS;
        if (done || now - start > MAX_MS) {
          clearInterval(timer);
          resolve();
        } else if (!first && now - start > NOTHING_MS) {
          clearInterval(timer);
          reject(new Error('nothing was translated'));
        }
      }, 100);
    });
  } finally {
    observer.disconnect();
  }
  return items.map((p, i) => (looksTranslated(p) ? harvestTagged(p) : texts[i]!));
}

window.addEventListener(
  'message',
  (e: MessageEvent<{ type?: string; id?: number; texts?: string[] }>) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    const { type, id, texts } = e.data ?? {};
    if (type !== 'translate' || typeof id !== 'number' || !Array.isArray(texts)) return;
    translate(texts).then(
      (out) => post({ type: 'result', id, texts: out }),
      (error: unknown) => post({ type: 'error', id, message: String(error) }),
    );
  },
);
