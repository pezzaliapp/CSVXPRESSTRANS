/* Trasporti PWA — sw.js (scope locale /trasporti/)
   Cache aggiornata e isolata per evitare interferenze con altre PWA sullo stesso dominio.
*/
const CACHE = "trasporti-v2026-02-04-1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./data/articles.json",
  "./data/pallet_rates_by_region.json",
  "./data/groupage_rates.json",
  "./data/geo_provinces.json"
];

// Install: pre-cache (tollera file opzionali)
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE_ASSETS.map(u => new Request(u, { cache: "reload" })));
    self.skipWaiting();
  })().catch(() => self.skipWaiting()));
});

// Activate: pulizia vecchie cache
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Fetch: network-first per JSON (sempre freschi), cache-first per asset statici
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if(req.method !== "GET") return;

  const url = new URL(req.url);

  // Solo stesso origin
  if(url.origin !== location.origin) return;

  const isJSON = url.pathname.endsWith(".json");
  if(isJSON){
    event.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      }catch{
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }

  // Asset statici: cache-first, fallback rete
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if(cached) return cached;
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});
