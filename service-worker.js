/* CSVXPRESSTRANS — service-worker.js
   Offline-first leggero (HTML network-first, assets cache-first)
*/
const VER = '0.1.0';
const CACHE = `csvxpresstrans-${VER}`;

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './style.css',
  './style.mobile.cards.rev.v3.css',
  './icon-192.png',
  './icon-512.png',
  './articles.json',
  './geo_provinces.json',
  './groupage_rates.json',
  './pallet_rates_by_region.json'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS).catch(()=>{}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo stesso origin
  if (url.origin !== location.origin) return;

  // HTML: network-first
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req) || await caches.match('./index.html');
        return cached || new Response('Offline', { status: 503, headers: { 'Content-Type':'text/plain' }});
      }
    })());
    return;
  }

  // Asset: cache-first
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
