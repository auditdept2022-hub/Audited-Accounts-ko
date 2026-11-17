// App-shell service worker (v4).
// Caches only the static shell. Live ledger data is never cached here.
//
// v3 -> v4 fixes for the "white screen" problem:
//  1. Page load now has a timeout. If the network is slow or hanging
//     (weak signal), it opens the saved copy after NAV_TIMEOUT_MS
//     instead of leaving a blank screen.
//  2. If the exact page URL is not in the cache, it falls back to the
//     saved index.html instead of returning nothing (nothing = white screen).
//  3. Install no longer fails completely if one icon file is missing.
const CACHE_NAME = 'audited-accounts-shell-v4';
const NAV_TIMEOUT_MS = 4000;
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

function isShellNavigation_(req) {
  if (req.mode === 'navigate') return true;
  const path = new URL(req.url).pathname;
  return path.endsWith('/') || path.endsWith('/index.html');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        SHELL_FILES.map((f) => cache.add(f).catch(() => { /* skip missing file */ }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// Best saved copy of the page: exact URL first, then index.html, then './'.
function savedShell_(req) {
  return caches.match(req)
    .then((r) => r || caches.match('./index.html'))
    .then((r) => r || caches.match('./'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (isShellNavigation_(req)) {
    event.respondWith((async () => {
      const network = fetch(req, { cache: 'no-store' }).then((res) => {
        if (res && res.status === 200 && !res.redirected) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('./index.html', clone)).catch(() => {});
        }
        return res;
      });
      // Race the network against a timer. Network wins if fast enough
      // (always the latest file); otherwise show the saved copy.
      const timer = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
      try {
        const first = await Promise.race([network, timer]);
        if (first) return first;
        const saved = await savedShell_(req);
        if (saved) return saved;
        return await network; // nothing saved yet: keep waiting for network
      } catch (err) {
        const saved = await savedShell_(req);
        if (saved) return saved;
        return new Response(
          '<meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px sans-serif;padding:24px">No connection and no saved copy yet. Please connect to the internet and reopen the app.</body>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // Icons/manifest: saved copy first, refresh in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
