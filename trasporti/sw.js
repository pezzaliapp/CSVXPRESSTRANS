// trasporti-pwa — Service Worker
// iOS-safe update strategy: precache with cache-bust + robust network-first for app shell
const CACHE = "trasporti-pwa-v5"; // <-- bump ad ogni release reale

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",

  // Data
  "./data/articles.json",
  "./data/pallet_rates_by_region.json",
  "./data/groupage_rates.json",
  "./data/geo_provinces.json",
  "./data/geo_provinces.csv",
  "./data/template_articles.csv",

  // Icons
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// ---------- Helpers ----------
async function putInCache(request, response) {
  const cache = await caches.open(CACHE);
  await cache.put(request, response);
}

async function networkFirst(request) {
  try {
    // cache: "no-store" aiuta, ma su iOS è utile anche "reload" in alcuni casi
    const fresh = await fetch(request, { cache: "no-store" });
    await putInCache(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  const fetchPromise = fetch(request)
    .then(async (fresh) => {
      await putInCache(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  return cached || (await fetchPromise) || Response.error();
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;

  const fresh = await fetch(request);
  await putInCache(request, fresh.clone());
  return fresh;
}

// Precache “hard” per evitare cache Safari/iOS
async function precacheAll() {
  const cache = await caches.open(CACHE);

  // Fetch one-by-one con cache:"reload" per forzare rete (molto utile su iOS)
  for (const url of ASSETS) {
    const req = new Request(url, { cache: "reload" });
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res);
    } catch (e) {
      // se offline durante install, non blocchiamo: la cache precedente coprirà
    }
  }
}

// ---------- Lifecycle ----------
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await precacheAll();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));

    await self.clients.claim();

    // Notifica per far ricaricare UI (index.html già gestisce controllerchange)
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: "SW_UPDATED", cache: CACHE });
    }
  })());
});

// Permette “aggiorna ora” da pagina se vuoi in futuro (postMessage SKIP_WAITING)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ---------- Fetch ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo same-origin
  if (url.origin !== self.location.origin) return;

  // Navigations (molto importante su iOS)
  if (req.mode === "navigate") {
    event.respondWith(networkFirst(new Request("./index.html")));
    return;
  }

  const path = url.pathname;

  // App shell: sempre network-first
  const isAppShell =
    path.endsWith("/index.html") ||
    path.endsWith("/app.js") ||
    path.endsWith("/styles.css") ||
    path === "/" ||
    path.endsWith("/");

  if (isAppShell) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Dati critici: articles.json deve aggiornarsi subito (relazioni/force PALLET)
  if (path.endsWith("/data/articles.json")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Altri JSON: stale-while-revalidate (veloce + si aggiorna in background)
  if (path.endsWith(".json")) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Tutto il resto: cache-first
  event.respondWith(cacheFirst(req));
});
