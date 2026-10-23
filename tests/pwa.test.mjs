import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, sep} from 'node:path';
import {openDb} from '../lib/db.mjs';
import {createApp} from '../server.mjs';
import {registerServiceWorker} from '../public/pwa.js';

const file = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const manifest = JSON.parse(file('public/manifest.webmanifest'));
function png(path) {
  const data = file(path);
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} harus PNG.`);
  return {width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25]};
}

test('PWA: manifest dapat dipasang dengan ikon any dan maskable berukuran tepat', () => {
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.id, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'id');
  assert(manifest.name && manifest.short_name.length <= 12, 'short_name tampil di bawah ikon; maksimal 12 karakter.');
  const themeColor = file('public/index.html').toString().match(/<meta name="theme-color" content="([^"]+)">/)[1];
  assert.equal(manifest.theme_color, themeColor);
  for (const purpose of ['any', 'maskable']) {
    for (const size of [192, 512]) {
      const icon = manifest.icons.find((item) => item.purpose === purpose && item.sizes === `${size}x${size}`);
      assert(icon, `Ikon ${purpose} ${size} px wajib ada.`);
      assert.equal(icon.type, 'image/png');
      assert(!icon.src.startsWith('/') && !icon.src.includes('/assets/'), 'Alamat ikon harus relatif terhadap manifest.');
      const image = png(`public/${icon.src}`);
      assert.deepEqual([image.width, image.height], [size, size]);
      // Android fills the whole mask with a maskable icon, so it must have no transparent area.
      if (purpose === 'maskable') assert.equal(image.colorType, 2, 'Ikon maskable harus tanpa transparansi.');
    }
  }
});

test('PWA: index.html menautkan manifest dan ikon iPhone', () => {
  const html = file('public/index.html').toString();
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/icons\/apple-touch-icon\.png">/);
  const icon = png('public/assets/icons/apple-touch-icon.png');
  assert.deepEqual([icon.width, icon.height, icon.colorType], [180, 180, 2], 'iOS menghitamkan area transparan; ikon harus 180 px tanpa transparansi.');
});

test('PWA: hasil build Cloudflare memuat manifest, service worker, dan ikon di /app/', () => {
  const icons = [...manifest.icons.map((icon) => icon.src), 'assets/icons/apple-touch-icon.png'];
  for (const path of ['manifest.webmanifest', 'sw.js', 'pwa.js', ...icons]) {
    assert.deepEqual(file(`site-info/dist/app/${path}`), file(`public/${path}`), `Jalankan node scripts/build-cloud-deploy.mjs (${path}).`);
  }
  const html = file('site-info/dist/app/index.html').toString();
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/app\/assets\/icons\/apple-touch-icon\.png">/);
  const bundle = html.match(/src="\/portal-static\/(portal-[a-f0-9]+\.js)"/)[1];
  assert.match(file(`site-info/dist/portal-static/${bundle}`).toString(), /["']sw\.js["']/, 'Bundel /app/ harus mendaftarkan service worker.');
  assert.match(file('site-info/dist/portal/index.html').toString(), /<link rel="apple-touch-icon" href="\/app\/assets\/icons\/apple-touch-icon\.png">/);
});

function loadWorker(scope = 'https://bpbesakih.com/app/') {
  const listeners = {}, calls = {skipWaiting: 0, preload: 0, claim: 0, fetch: 0};
  let network = async () => new Response('ruang kerja', {status: 200, headers: {'Content-Type': 'text/html'}});
  const self = {
    addEventListener: (type, listener) => { listeners[type] = listener; },
    skipWaiting: () => { calls.skipWaiting++; return Promise.resolve(); },
    registration: {scope, navigationPreload: {enable: async () => { calls.preload++; }}},
    clients: {claim: async () => { calls.claim++; }},
  };
  const context = vm.createContext({self, Response, URL, fetch: (request) => { calls.fetch++; return network(request); }});
  vm.runInContext(file('public/sw.js').toString(), context);
  const dispatch = (request, preloadResponse = Promise.resolve(undefined)) => {
    let response = null;
    listeners.fetch({request, preloadResponse, respondWith: (value) => { response = value; }});
    return response;
  };
  return {listeners, calls, dispatch, offline: () => { network = async () => { throw new TypeError('Failed to fetch'); }; }};
}
const page = {mode: 'navigate', method: 'GET', url: 'https://bpbesakih.com/app/'};

test('PWA: service worker aktif segera dan memakai navigation preload', async () => {
  const worker = loadWorker();
  let installation;
  worker.listeners.install({waitUntil: (promise) => { installation = promise; }});
  await installation;
  assert.equal(worker.calls.skipWaiting, 1);
  let activation;
  worker.listeners.activate({waitUntil: (promise) => { activation = promise; }});
  await activation;
  assert.deepEqual([worker.calls.preload, worker.calls.claim], [1, 1]);
});

test('PWA: halaman diambil dari jaringan dan tidak ada data yang disimpan', async () => {
  const worker = loadWorker();
  assert.equal(await (await worker.dispatch(page)).text(), 'ruang kerja');
  assert.equal(worker.calls.fetch, 1);
  const preloaded = new Response('dari preload');
  assert.equal(await worker.dispatch(page, Promise.resolve(preloaded)), preloaded);
  assert.equal(worker.calls.fetch, 1, 'Respons preload dipakai tanpa permintaan kedua.');
  for (const request of [
    {mode: 'cors', method: 'GET', url: 'https://bpbesakih.com/api/portal/me'},
    {mode: 'no-cors', method: 'GET', url: 'https://bpbesakih.com/api/files/x?inline=1'},
    {mode: 'navigate', method: 'POST', url: page.url},
    {mode: 'navigate', method: 'GET', url: 'https://bpbesakih.com/api/files/x?inline=1'},
    {mode: 'navigate', method: 'GET', url: 'https://bpbesakih.com/app/assets/icons/icon-192.png'},
    {mode: 'navigate', method: 'GET', url: 'https://bpbesakih.com/portal/'},
    {mode: 'navigate', method: 'GET', url: 'https://other.test/app/'},
  ]) assert.equal(worker.dispatch(request), null, `${request.method} ${request.url} harus dibiarkan ke browser.`);
  assert.doesNotMatch(file('public/sw.js').toString(), /\bcaches\b|indexedDB|localStorage/);
});

test('PWA: preload gagal tetap mencoba jaringan; lingkup lokal hanya menangani dokumen ruang kerja', async () => {
  const worker = loadWorker();
  const response = await worker.dispatch(page, Promise.reject(new TypeError('preload failed')));
  assert.equal(await response.text(), 'ruang kerja');
  assert.equal(worker.calls.fetch, 1);
  assert.equal(await (await worker.dispatch({...page, url: `${page.url}index.html?check=1`})).text(), 'ruang kerja');
  const local = loadWorker('http://127.0.0.1:3000/');
  assert.equal(await (await local.dispatch({...page, url: 'http://127.0.0.1:3000/'})).text(), 'ruang kerja');
  for (const path of ['/api/files/x?inline=1', '/quick-report.html', '/coaching/', '/assets/icons/icon-192.png']) {
    assert.equal(local.dispatch({...page, url: `http://127.0.0.1:3000${path}`}), null);
  }
});

test('PWA: tanpa jaringan tampil halaman offline dengan tombol coba lagi', async () => {
  const worker = loadWorker();
  worker.offline();
  for (const preload of [() => undefined, () => Promise.reject(new TypeError('Failed to fetch'))]) {
    const response = await worker.dispatch(page, preload());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text();
    assert.match(html, /Tidak ada koneksi internet/);
    assert.match(html, /id="retry">Coba lagi</);
  }
});

test('PWA: service worker didaftarkan dari folder halaman setelah halaman dimuat', async () => {
  const environment = (href, extra = {}) => {
    const registered = [], listeners = {};
    return {
      registered, listeners, isSecureContext: true, location: {href},
      document: {readyState: 'complete'},
      navigator: {serviceWorker: {register: async (url) => { registered.push(String(url)); return {scope: new URL('./', url).href}; }}},
      addEventListener: (type, listener) => { listeners[type] = listener; },
      ...extra,
    };
  };
  const cloud = environment('https://sph-portal.pages.dev/app/#employees');
  await registerServiceWorker(cloud);
  assert.deepEqual(cloud.registered, ['https://sph-portal.pages.dev/app/sw.js']);
  const local = environment('http://127.0.0.1:3000/');
  await registerServiceWorker(local);
  assert.deepEqual(local.registered, ['http://127.0.0.1:3000/sw.js']);

  const loading = environment('https://sph-portal.pages.dev/app/', {document: {readyState: 'interactive'}});
  const pending = registerServiceWorker(loading);
  assert.deepEqual(loading.registered, [], 'Pendaftaran menunggu event load.');
  loading.listeners.load();
  await pending;
  assert.deepEqual(loading.registered, ['https://sph-portal.pages.dev/app/sw.js']);

  assert.equal(await registerServiceWorker(environment('http://contoh.test/', {isSecureContext: false})), null);
  assert.equal(await registerServiceWorker(environment('https://sph-portal.pages.dev/app/', {navigator: {}})), null);
  const failing = environment('https://sph-portal.pages.dev/app/', {navigator: {serviceWorker: {register: async () => { throw new Error('ditolak'); }}}});
  assert.equal(await registerServiceWorker(failing), null);
});

test('PWA: server lokal menyajikan manifest dan service worker', async (t) => {
  const db = openDb(':memory:'), directory = mkdtempSync(resolve(tmpdir(), 'besakih-pwa-'));
  const {server} = createApp({db, dataDir: directory});
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(async () => {
    await new Promise((done) => server.close(done));
    db.close();
    const absolute = resolve(directory);
    assert(absolute.startsWith(resolve(tmpdir()) + sep) && absolute.split(sep).at(-1).startsWith('besakih-'));
    rmSync(absolute, {recursive: true, force: true});
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manifestResponse = await fetch(`${origin}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.equal(manifestResponse.headers.get('content-type'), 'application/manifest+json');
  assert.deepEqual(await manifestResponse.json(), manifest);
  const worker = await fetch(`${origin}/sw.js`);
  assert.equal(worker.status, 200);
  assert.equal(worker.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const icon = await fetch(`${origin}/assets/icons/maskable-512.png`);
  assert.equal(icon.status, 200);
  assert.deepEqual(Buffer.from(await icon.arrayBuffer()), file('public/assets/icons/maskable-512.png'));
});
