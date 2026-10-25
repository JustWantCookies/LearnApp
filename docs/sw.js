// App-shell cache only. Book content lives in IndexedDB, never here.
// Bump CACHE on every release so clients pick up the new shell.
const CACHE = 'app-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/purify.es.mjs',
  'js/main.js',
  'js/appearance.js',
  'js/router.js',
  'js/db.js',
  'js/dom.js',
  'js/dates.js',
  'js/sanitize.js',
  'js/packs.js',
  'js/progress.js',
  'js/reader.js',
  'js/quiz.js',
  'js/scheduler.js',
  'js/exportImport.js',
  'js/views/today.js',
  'js/views/library.js',
  'js/views/book.js',
  'js/views/settings.js',
  'js/views/about.js',
  'js/views/export.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new release never mixes in stale files.
  event.waitUntil(caches.open(CACHE).then((cache) =>
    cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks the waiting worker to take over only after the user taps "Reload".
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // The app itself (scope root) always comes from the cache, so it opens offline.
  // Other pages (tests.html) and files not in the shell go to the network.
  const scopePath = new URL(self.registration.scope).pathname;
  if (req.mode === 'navigate' && (url.pathname === scopePath || url.pathname === scopePath + 'index.html')) {
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
