/* =========================================================
   sw.js — Service Worker formulir penilaian guide (SPH-Portal)
   Lingkup: /penilaian-guide/ saja. Menyimpan app shell; balasan /api/
   TIDAK PERNAH disimpan (ATR-FL-15). Naikkan CACHE bersama APP_VERSION.
   ========================================================= */
const CACHE = 'bpb-penilaian-guide-v2.1.1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/sync.js',
  './js/app/00-inti.js',
  './js/app/01-navigasi.js',
  './js/app/02-guide.js',
  './js/app/03-form.js',
  './js/app/04-riwayat.js',
  './js/app/05-export.js',
  './js/app/06-status.js',
  './js/app/07-mulai.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bpb-penilaian-guide-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'versi' && event.source) {
    event.source.postMessage({ versiCache: CACHE });
  }
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API dan halaman portal lain tidak dilayani dari cache ini.
  if (url.pathname.startsWith('/api/') || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;

  // Cache-first untuk app shell; jaringan memperbarui cache di belakang.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
      return cached || network;
    })
  );
});
