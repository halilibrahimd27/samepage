// samepage service worker (P6.5): offline app shell. Same-origin requests only — translation
// providers (other origins) are never touched. Navigations are network-first; hashed assets,
// fonts and the MuPDF WASM are cache-first once used. Files shared from another app ("Share →
// samepage") are posted here: GitHub Pages cannot take a POST, so they are kept until the app
// takes them (src/app/incomingFiles.ts holds the same names).
const CACHE = 'samepage-v2';
/** Shared files wait here for the app; kept when a new version replaces the app shell. */
const SHARE_CACHE = 'samepage-share';
/** The manifest's share_target: its action and the form field of the files. */
const SHARE_URL = new URL('./share-target', self.location.href).pathname;
const SHARE_FIELD = 'files';
/** The query parameter the app is sent to (./?share=<id>) and the header of a file's name. */
const SHARE_PARAM = 'share';
const SHARE_NAME_HEADER = 'x-samepage-name';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', './favicon.svg', './manifest.webmanifest'])),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Keeps the shared files (…/share/<id>/<n>, in their order) and sends the app to them with a
 * 303 to ./?share=<id>. A share that cannot be read still lands in the app, which says so.
 */
async function receiveShare(request) {
  const id = `${Date.now().toString(36)}-${self.crypto.randomUUID().slice(0, 8)}`;
  try {
    const form = await request.formData();
    const files = form.getAll(SHARE_FIELD).filter((value) => value instanceof File);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all(
      files.map((file, n) =>
        cache.put(
          new URL(`./share/${id}/${n}`, self.location.href).href,
          new Response(file, {
            headers: {
              'content-type': file.type || 'application/octet-stream',
              [SHARE_NAME_HEADER]: encodeURIComponent(file.name),
            },
          }),
        ),
      ),
    );
  } catch {
    // Nothing is kept: the app finds no files for this share and tells the user.
  }
  return Response.redirect(new URL(`./?${SHARE_PARAM}=${id}`, self.location.href).href, 303);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && url.pathname === SHARE_URL) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  // The translation helper page is never cached (and must not replace the app shell).
  if (url.pathname.endsWith('/translate.html')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only the app itself becomes the offline shell, not a 404 or another page of the site.
          const app = new URL(response.url || request.url).pathname.replace(/index\.html$/, '');
          if (response.ok && app === new URL('./', self.location.href).pathname) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('./', copy));
          }
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }
  // The app fetched under a share marker is not an asset: it is not kept under that address.
  if (url.searchParams.has(SHARE_PARAM)) return;
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
