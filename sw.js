// CSVXPRESSTRANS/sw.js
// Wrapper SW: importa service-worker.js con cache-busting per forzare update su iOS/Chrome.
// Registra SOLO questo file (index.html -> navigator.serviceWorker.register('./sw.js')).
const VER = '1.0.4';
importScripts(`./service-worker.js?v=${VER}`);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
