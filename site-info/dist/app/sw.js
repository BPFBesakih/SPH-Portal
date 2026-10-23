// SPH-Portal service worker, registered by pwa.js with the folder of index.html as its scope.
// It replaces the browser's offline error with a portal
// notice. It stores nothing: pages always come from the network, the Cache Storage is never
// used, and API, file and asset requests are left to the browser untouched.
'use strict';

const OFFLINE_PAGE = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#7b1e34">
<title>Tidak ada koneksi — SPH-Portal</title>
<style>
:root{color-scheme:light dark;--bg:#faf8f7;--text:#171415;--muted:#5d5557;--accent:#7b1e34;--on-accent:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#191516;--text:#f5eef0;--muted:#c7babe;--accent:#f2bcc9;--on-accent:#481021}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:360px;text-align:center}
.mark{width:64px;height:64px;margin:0 auto 20px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on-accent)}
h1{margin:0 0 8px;font-size:22px;line-height:1.3}
p{margin:0 0 24px;color:var(--muted)}
button{font:inherit;font-weight:600;min-height:48px;padding:0 28px;border:0;border-radius:999px;background:var(--accent);color:var(--on-accent);cursor:pointer}
button:focus-visible{outline:3px solid var(--text);outline-offset:3px}
</style>
</head>
<body>
<main>
<div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M4 3l16 18"/><circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none"/></svg></div>
<h1>Tidak ada koneksi internet</h1>
<p>SPH-Portal memerlukan internet untuk membuka data. Periksa sinyal atau Wi-Fi, lalu coba lagi.</p>
<button type="button" id="retry">Coba lagi</button>
</main>
<script>
document.getElementById('retry').addEventListener('click', () => location.reload());
addEventListener('online', () => location.reload());
</script>
</body>
</html>`;

const OFFLINE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Lets the page request start while the worker boots, so pages load as fast as without it.
    try { await self.registration.navigationPreload?.enable(); } catch { /* unsupported */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  // Only the workspace document uses the fallback, including on the local root scope.
  const url = new URL(request.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || ![scope.pathname, `${scope.pathname}index.html`].includes(url.pathname)) return;
  event.respondWith((async () => {
    // A preload failure must still allow a normal network retry.
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
    } catch { /* retry below */ }
    try {
      return await fetch(request);
    } catch {
      return new Response(OFFLINE_PAGE, {status: 200, headers: OFFLINE_HEADERS});
    }
  })());
});
