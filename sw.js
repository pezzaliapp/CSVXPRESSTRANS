// CSVXPRESSTRANS/sw.js
// Wrapper per aggiornare più facilmente il service-worker principale anche su device "testardi".
// Carica service-worker.js con cache-busting.
const VER = '1.0.3';
importScripts(`./service-worker.js?v=${VER}`);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
