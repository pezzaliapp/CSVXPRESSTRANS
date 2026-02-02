/* CSVXPRESSTRANS — service-worker.js (ROOT)
   Struttura repo:
   / (root app)
   /data (dataset root, opzionali)
   /icons (icone)
   /trasporti (PWA separata, con SW proprio)
*/

const VER = '1.0.0';
const CACHE = `csvxpresstrans-root-${VER}`;

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './service-worker.js',
  './sw.js',

  './style.css',
  './style.mobile.cards.rev.v3.css',

  './icons/icon-192.png',
  './icons/icon-512.png',

  // dataset root (se esistono in /data)
  './data/articles.json',
  './data/geo_provinces.json',
  './data/groupage_rates.json',
  './data/pallet_rates_by_region.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // solo stesso origin
  if (url.origin !== location.origin) return;

  // NON interferire con la PWA /trasporti (ha SW proprio)
  if (url.pathname.includes('/trasporti/')) {
    return; // lascia che gestisca il suo SW (o il network)
  }

  // HTML: network-first
  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.includes('text/html');

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req) || await caches.match('./index.html');
        return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  })());
});
