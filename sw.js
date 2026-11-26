// Amajing Timestamp service worker — ganti CACHE_NAME setiap rilis
const CACHE_NAME = 'amajing-timestamp-v2';
const SHELL = [
  './', './index.html', './style.css', './app.js', './manifest.json',
  './brand/ikon.svg', './brand/ikon-192.png', './brand/ikon-512.png',
  './brand/ikon-maskable-192.png', './brand/ikon-maskable-512.png', './brand/apple-touch-icon.png', './brand/logo-kecil-gelap.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// File aplikasi: ambil versi terbaru dari jaringan, pakai cache saat offline.
// Alamat (Nominatim) dan peta (OSM) di domain lain tidak lewat sini.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
