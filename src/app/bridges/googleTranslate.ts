import type { LangPair } from '../../engines/types';

/**
 * Main-thread side of automatic Google translation (ADR-021): a transparent, click-through
 * frame with the translation helper page (translate.html), one per language pair, spoken to
 * with same-origin postMessage. Texts are tagged text; results come back as tagged text.
 */
type Message = { ch: string } & (
  | { type: 'ready' }
  | { type: 'result'; id: number; texts: string[] }
  | { type: 'error'; id?: number; message: string }
);

const READY_MS = 25_000;
/** Per-batch limit: Google is fast, but a slow network must not hang a job for long. */
const BATCH_MS = 75_000;

let frame: HTMLIFrameElement | null = null;
let framePair = '';
let ready: Promise<void> | null = null;
let readyHooks: { resolve: () => void; reject: (e: Error) => void } | null = null;
let nextId = 1;
/** Channel of the current frame: its messages carry it, stale frames' messages do not match. */
let channel = '';
let nextChannel = 1;
const pending = new Map<number, { resolve: (t: string[]) => void; reject: (e: Error) => void }>();

// Matched by origin and channel, not by e.source: WebKit (every iOS browser) gives the helper's
// messages another window object once Google has translated the page.
window.addEventListener('message', (e: MessageEvent<Message>) => {
  if (e.origin !== location.origin || !frame || e.data?.ch !== channel) return;
  const m = e.data;
  if (m.type === 'ready') readyHooks?.resolve();
  else if (m.type === 'result') {
    pending.get(m.id)?.resolve(m.texts);
    pending.delete(m.id);
  } else if (m.type === 'error') {
    // Kept in the console for support: the batch is retried, then the manual sheet takes over.
    console.warn(`Translation helper: ${m.message}`);
    const error = new Error(m.message);
    if (m.id === undefined) readyHooks?.reject(error);
    else {
      pending.get(m.id)?.reject(error);
      pending.delete(m.id);
    }
  }
});

function ensureFrame(pair: LangPair): Promise<void> {
  const key = `${pair.source}>${pair.target}`;
  if (frame && framePair === key && ready) return ready;
  closeGoogleTranslate();
  framePair = key;
  channel = `c${nextChannel++}`;
  frame = document.createElement('iframe');
  frame.src = `${import.meta.env.BASE_URL}translate.html?sl=${encodeURIComponent(pair.source)}&tl=${encodeURIComponent(pair.target)}&ch=${channel}`;
  frame.title = 'Translation helper';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Google translates only what is on screen: the frame covers the viewport, invisibly.
  Object.assign(frame.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Google Translate could not be loaded')),
      READY_MS,
    );
    readyHooks = {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };
  });
  document.body.append(frame);
  ready.catch(() => closeGoogleTranslate());
  return ready;
}

/** Removes the helper frame (language pair changed, job failed or page left). */
export function closeGoogleTranslate(): void {
  frame?.remove();
  frame = null;
  ready = null;
  framePair = '';
  for (const p of pending.values()) p.reject(new Error('Translation helper closed'));
  pending.clear();
}

export async function googleTranslate(pair: LangPair, texts: string[]): Promise<string[]> {
  await ensureFrame(pair);
  const id = nextId++;
  return new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Google Translate did not answer'));
    }, BATCH_MS);
    pending.set(id, {
      resolve: (t) => {
        clearTimeout(timer);
        resolve(t);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    frame!.contentWindow!.postMessage({ type: 'translate', id, texts }, location.origin);
  });
}
