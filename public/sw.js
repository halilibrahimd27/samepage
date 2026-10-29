// samepage service worker (P6.5): offline app shell. Same-origin GET requests only — translation
// providers (other origins) are never touched. Navigations are network-first; hashed assets,
// fonts and the MuPDF WASM are cache-first once used.
const CACHE = 'samepage-v1';

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
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
