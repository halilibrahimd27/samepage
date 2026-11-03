import { useEffect, useRef } from 'react';

/*
 * Files that reach samepage from outside the page: shared from another app ("Share → samepage",
 * the manifest's share_target) or opened with the installed desktop app (its file_handlers).
 * Both open as a dropped file does, through the same checks.
 *
 * GitHub Pages cannot take the share's POST: the service worker (public/sw.js) answers it, keeps
 * the files in a cache of their own and sends the app to ./?share=<id>, where they are read and
 * removed. The names below are shared with public/sw.js and public/manifest.webmanifest.
 */

/** The share URL, relative to the app (the manifest's share_target action). */
export const SHARE_ACTION = 'share-target';
/** The form field the files come in (the manifest's share_target files param). */
export const SHARE_FIELD = 'files';
/** The cache the service worker keeps shared files in until the app takes them. */
export const SHARE_CACHE = 'samepage-share';
/** The query parameter the service worker sends the app to: ./?share=<id>. */
export const SHARE_PARAM = 'share';
/** The header holding a kept file's name (URI-encoded). */
export const SHARE_NAME_HEADER = 'x-samepage-name';
/** Shares never opened (the app was closed first) are removed once this old. */
export const SHARE_MAX_AGE_MS = 60 * 60_000;

/** A share id from the service worker: its time in base 36, a dash, eight hex digits. */
const SHARE_ID = /^[0-9a-z]{1,12}-[0-9a-f]{8}$/;

/** The share id in the address (`?share=<id>`), or null when there is none or it is malformed. */
export function shareIdFrom(search: string): string | null {
  const id = new URLSearchParams(search).get(SHARE_PARAM);
  return id !== null && SHARE_ID.test(id) ? id : null;
}

/** The address without the share marker: other parameters and the #route stay. */
export function withoutShareMarker(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(SHARE_PARAM);
  return url.href;
}

/** A kept file's cache key (…/share/<id>/<n>): its share, its place in the share and the time. */
export function shareEntry(url: string): { id: string; n: number; time: number } | null {
  const match = /\/share\/([^/]+)\/(\d+)$/.exec(new URL(url).pathname);
  if (!match || !SHARE_ID.test(match[1]!)) return null;
  const id = match[1]!;
  return { id, n: Number(match[2]), time: parseInt(id.split('-')[0]!, 36) };
}

/** A kept file's name: decoded, without path separators; a nameless file is "document". */
export function sharedFileName(header: string | null): string {
  let name: string;
  try {
    name = decodeURIComponent(header ?? '');
  } catch {
    name = header ?? '';
  }
  return name.replace(/[\\/]/g, '_').slice(0, 200) || 'document';
}

/**
 * Takes the files kept for share `id`, in the order they were shared, and removes them. Shares
 * older than an hour that were never opened are removed too.
 */
export async function takeSharedFiles(
  id: string,
  storage: CacheStorage = caches,
  now: number = Date.now(),
): Promise<File[]> {
  if (!(await storage.has(SHARE_CACHE))) return [];
  const cache = await storage.open(SHARE_CACHE);
  const mine: { request: Request; n: number }[] = [];
  for (const request of await cache.keys()) {
    const entry = shareEntry(request.url);
    if (entry?.id === id) mine.push({ request, n: entry.n });
    else if (!entry || !(now - entry.time < SHARE_MAX_AGE_MS)) await cache.delete(request);
  }
  const files: File[] = [];
  for (const { request } of mine.sort((a, b) => a.n - b.n)) {
    const response = await cache.match(request);
    if (response) {
      // Read now: the kept copy is removed below.
      const bytes = await response.arrayBuffer();
      const type = response.headers.get('content-type') ?? '';
      files.push(
        new File([bytes], sharedFileName(response.headers.get(SHARE_NAME_HEADER)), { type }),
      );
    }
    await cache.delete(request);
  }
  return files;
}

/** File Handling (installed desktop app): not in TypeScript's DOM types yet. */
interface LaunchParams {
  readonly files: readonly FileSystemHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
  handle.kind === 'file';

/**
 * Calls `onFiles` with the files shared to samepage or opened with it on this page load.
 * `lost` is true when some of them could not be read: a share whose files are gone, or a file
 * the system would not hand over. The share marker is removed from the address at once, so a
 * reload does not look for the files again.
 */
export function useIncomingFiles(onFiles: (files: File[], lost: boolean) => void): void {
  const handler = useRef(onFiles);
  useEffect(() => {
    handler.current = onFiles;
  });
  useEffect(() => {
    const id = shareIdFrom(window.location.search);
    if (id) {
      window.history.replaceState(
        window.history.state,
        '',
        withoutShareMarker(window.location.href),
      );
      void ('caches' in window ? takeSharedFiles(id) : Promise.resolve([])).then(
        (files) => handler.current(files, files.length === 0),
        () => handler.current([], true),
      );
    }
    const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
    queue?.setConsumer((params) => {
      const handles = params.files.filter(isFileHandle);
      if (handles.length === 0) return;
      void Promise.allSettled(handles.map((h) => h.getFile())).then((results) => {
        const files = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        handler.current(files, files.length < handles.length);
      });
    });
  }, []);
}
