// App-shell service worker.
// Caches only the static shell (HTML/CSS/JS/icons) so the app installs
// and opens even on a flaky connection. Live ledger data still requires
// a network connection to your Apps Script Web App — this file does not
// cache or touch that data.

// Bumped v1 -> v2 alongside the fetch-strategy change below, so the
// activate handler's cache cleanup actually runs once for everyone
// currently on v1 (a same-named cache never looked "old", so it never
// got purged).
const CACHE_NAME = 'audited-accounts-shell-v2';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

// Requests that must always try the network FIRST — the page shell
// itself. The old strategy (cache-first, refresh cache in the
// background for next time) meant every edit to index.html took an
// extra reload — sometimes two — to actually show up, because the very
// page you just loaded was always served from whatever was cached
// BEFORE this visit, not what was just fetched. Network-first fixes
// that: online, you always get the latest index.html; offline, it
// falls back to whatever's cached so the app still opens.
function isShellNavigation_(req) {
  if (req.mode === 'navigate') return true;
  const path = new URL(req.url).pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests for the shell. Everything else
  // (Apps Script API calls, Google Fonts, the SheetJS CDN script, etc.)
  // goes straight to the network untouched.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  if (isShellNavigation_(req)) {
    // Network-first: try the live file, cache a copy of it for offline
    // use, and only fall back to whatever's cached if the network
    // request itself fails (actually offline / unreachable).
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else in the shell (icons, manifest) changes rarely, so
  // cache-first (with a background refresh for next time) is still
  // fine here — it just shouldn't apply to the HTML shell above.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
