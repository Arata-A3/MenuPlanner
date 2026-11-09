// 更新が届くように「ネットワーク優先・つながらないときはキャッシュ」で動かす
const CACHE_NAME = 'menu-planner-v2.5.0';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './data.js',
  './data-extra.js',
  './meta.js',
  './enrich.js',
  './icons.js',
  './app.js',
  './icon.png',
  './icon-192.png',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // 古いバージョンのキャッシュを消す
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
        return response;
      })
      .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
  );
});
