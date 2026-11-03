import { useEffect } from 'react';

/** The Screen Wake Lock API, where the browser has it (Chrome, Edge, Safari 16.4+). */
interface WakeLockSentinel {
  release(): Promise<void>;
}
interface WakeLock {
  request(type: 'screen'): Promise<WakeLockSentinel>;
}

/**
 * Keeps the screen on while `active`: a phone that sleeps in the middle of a long translation
 * stops it (iOS suspends the page), and the user finds it where it was an hour later. Asked again
 * when the page comes back to the front, since the browser lets go of it on leaving.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const lock = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
    if (!active || !lock) return;
    let sentinel: WakeLockSentinel | null = null;
    let done = false;
    const take = () => {
      if (document.visibilityState !== 'visible') return;
      void lock
        .request('screen')
        .then((s) => {
          if (done) void s.release().catch(() => undefined);
          else sentinel = s;
        })
        .catch(() => undefined);
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', take);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
