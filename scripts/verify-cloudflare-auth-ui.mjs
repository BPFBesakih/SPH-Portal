// Isolated browser checks: no production requests, real accounts, or stored profiles.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

const [playwrightPath, executablePath] = process.argv.slice(2);
if (!playwrightPath || !executablePath) throw new Error('Usage: node scripts/verify-cloudflare-auth-ui.mjs <playwright/index.mjs> <browser executable>');
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const root = resolve('site-info/dist');
const output = resolve('test-results/auth-ui');
await mkdir(output, { recursive: true });
const headersSource = await readFile(resolve(root, '_headers'), 'utf8');
const csp = headersSource.split(/\r?\n/).find((line) => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const relative = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
  const path = resolve(root, `.${decodeURIComponent(relative)}`);
  if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(path);
    response.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png','.webp':'image/webp' }[extname(path)] ?? 'application/octet-stream', 'Content-Security-Policy': csp, 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const base = `http://localhost:${server.address().port}`;
const browserOrigin = 'https://portal.test';
assert.equal((await fetch(`${base}/portal/`)).status, 200);
console.log('Local static page: HTTP 200');
const browser = await chromium.launch({ executablePath, headless: true });
const csrf = 'synthetic-csrf-cookie-for-browser-fixture';
const account = { username: 'akun_uji', must_change_password: true, role_assignments: [] };
const oldPassword = 'Fiktif-saat-ini-2026!';
const newPassword = '654321';
const browserErrors = [];
let passed = 0;

async function fixture(handler, viewport = { width: 1440, height: 960 }) {
  const context = await browser.newContext({ viewport, baseURL: browserOrigin });
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) browserErrors.push(message.text()); });
  await page.route(`${browserOrigin}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/auth/')) {
      const result = await fetch(`${base}${url.pathname}`);
      await route.fulfill({ status: result.status, headers: Object.fromEntries(result.headers), body: Buffer.from(await result.arrayBuffer()) });
      return;
    }
    const action = url.pathname.split('/').at(-1);
    const answer = await handler(action, route.request());
    await route.fulfill({ status: answer.status ?? 200, contentType: 'application/json', headers: answer.headers ?? {}, body: JSON.stringify(answer.body) });
  });
  await context.addCookies([{ name: '__Host-sph_csrf', value: csrf, url: `${browserOrigin}/`, secure: true, sameSite: 'Strict' }]);
  await page.goto('/portal/');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  return { page, context };
}
const ended = { status: 401, body: { ok: false, error: 'SESSION_ENDED' } };
const success = (value = account) => ({ body: { ok: true, account: value } });
async function login(page) {
  await page.getByLabel('Username', { exact: true }).fill(account.username);
  await page.getByLabel('Password', { exact: true }).fill(oldPassword);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}
async function password(page, confirmation = newPassword) {
  await page.getByLabel('Password saat ini', { exact: true }).fill(oldPassword);
  await page.getByLabel('Password baru', { exact: true }).fill(newPassword);
  await page.getByLabel('Ulangi password baru', { exact: true }).fill(confirmation);
}
function pass(name) { passed++; console.log(`PASS ${name}`); }

try {
  {
    const { page, context } = await fixture(() => ended);
    assert.equal(await page.locator('#login-view').isVisible(), true);
    assert.equal(await page.locator('#notice').isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Masuk', exact: true }).isEnabled(), true);
    assert.equal(await page.locator('.photo-slide').count(), 4);
    assert(await page.locator('.photo-slide').evaluateAll(async images => { await Promise.all(images.map(image => image.decode())); return images.every(image => image.naturalWidth > 0); }));
    await page.screenshot({ path: resolve(output, 'login-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: resolve(output, 'login-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 568 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await context.close(); pass('no session opens login quietly; desktop/mobile/320px layout');
  }
  {
    let calls = 0;
    const { page, context } = await fixture(async (action, request) => {
      if (action === 'me') return ended;
      assert.equal(action, 'login'); calls++;
      assert.equal(request.method(), 'POST');
      assert.equal(request.headers()['content-type'], 'application/json');
      assert.deepEqual(request.postDataJSON(), { username: account.username, password: oldPassword });
      await new Promise((done) => setTimeout(done, 120));
      return success();
    });
    await login(page);
    await page.locator('#password-view').waitFor({ state: 'visible' });
    assert.equal(calls, 1);
    assert.equal(await page.locator('#password-cancel').isVisible(), false);
    assert.equal(await page.locator('#login-password').inputValue(), '');
    assert.equal(new URL(page.url()).search, '');
    assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
    await page.screenshot({ path: resolve(output, 'password-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: resolve(output, 'password-mobile.png'), fullPage: true });
    await context.close(); pass('login uses JSON, clears credentials, enforces password change without storage/query');
  }
  {
    let calls = 0;
    const { page, context } = await fixture((action, request) => {
      if (action === 'me') return success();
      assert.equal(action, 'password'); calls++;
      assert.equal(request.headers()['x-csrf-token'], csrf);
      assert.deepEqual(request.postDataJSON(), { current_password: oldPassword, new_password: newPassword });
      return { body: { ok: true, password_changed: true, sign_in_required: true } };
    });
    await password(page, 'Fiktif-konfirmasi-berbeda');
    await page.getByRole('button', { name: 'Simpan password baru' }).click();
    assert.equal(calls, 0);
    await page.getByLabel('Ulangi password baru', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Simpan password baru' }).click();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.equal(calls, 1);
    assert.match(await page.locator('#notice').textContent(), /Password berhasil diubah/);
    assert.equal(await page.locator('#username').inputValue(), account.username);
    for (const id of ['current-password', 'new-password', 'confirm-password']) assert.equal(await page.locator(`#${id}`).inputValue(), '');
    await context.close(); pass('confirmation blocks request; successful CSRF-protected change requires fresh login');
  }
  {
    const { page, context } = await fixture((action) => action === 'me' ? success() : { status: 422, body: { ok: false, error: 'PASSWORD_REJECTED', message: '<script>untrusted</script>' } });
    await password(page);
    await page.getByRole('button', { name: 'Simpan password baru' }).click();
    await page.locator('#notice').waitFor({ state: 'visible' });
    assert.match(await page.locator('#notice').textContent(), /Password saat ini tidak cocok/);
    assert.equal(await page.locator('#password-view').isVisible(), true);
    assert.equal(await page.locator('#current-password').inputValue(), '');
    await context.close(); pass('password rejection keeps required flow; upstream message never rendered');
  }
  {
    const { page, context } = await fixture((action) => action === 'me' ? success() : { status: 503, body: { ok: false, error: 'PASSWORD_UPDATE_INCOMPLETE' } });
    await password(page);
    await page.getByRole('button', { name: 'Simpan password baru' }).click();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#notice').textContent(), /belum dapat dikonfirmasi/);
    await context.close(); pass('uncertain password update asks for new sign-in without automatic retry');
  }
  {
    const signedIn = { ...account, must_change_password: false, username: '<img src=x onerror=alert(1)>' };
    let signedOut = false;
    const { page, context } = await fixture((action, request) => {
      if (action === 'me') return signedOut ? ended : success(signedIn);
      assert.equal(action, 'logout');
      assert.equal(request.headers()['x-csrf-token'], csrf);
      signedOut = true;
      return { status: 503, body: { ok: false, error: 'AUTH_UNAVAILABLE' } };
    });
    assert.equal(await page.locator('#account-username').textContent(), signedIn.username);
    assert.equal(await page.locator('#account-username img').count(), 0);
    await page.getByRole('button', { name: 'Ganti password', exact: true }).click();
    assert.equal(await page.locator('#password-cancel').isVisible(), true);
    await page.getByRole('button', { name: 'Kembali', exact: true }).click();
    await page.screenshot({ path: resolve(output, 'account-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Keluar dari akun', exact: true }).click();
    await page.locator('#login-view').waitFor({ state: 'visible' });
    assert.match(await page.locator('#notice').textContent(), /Sesi portal sudah berakhir/);
    await context.close(); pass('account text is escaped; optional change can cancel; logout handles partial upstream failure');
  }
  {
    let calls = 0;
    const { page, context } = await fixture((action) => {
      if (action === 'me') return ended;
      calls++;
      return { status: 429, body: { ok: false, error: 'LOGIN_LIMITED' } };
    });
    await login(page);
    await page.locator('#notice').waitFor({ state: 'visible' });
    assert.equal(calls, 1);
    assert.match(await page.locator('#notice').textContent(), /15 menit/);
    assert.equal(await page.locator('#login-password').inputValue(), '');
    await context.close(); pass('rate limit shows actionable message without automatic retry');
  }
  assert.deepEqual(browserErrors, []);
  console.log(`${passed} browser checks passed; API fixtures only. Screenshots: test-results/auth-ui/`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
