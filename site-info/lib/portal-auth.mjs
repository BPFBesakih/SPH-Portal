// Cloudflare Pages backend. No Supabase token or key is returned to the browser.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const RANDOM = /^[A-Za-z0-9_-]{43}$/;
const SESSION_COOKIE = '__Host-sph_session';
const CSRF_COOKIE = '__Host-sph_csrf';
const SCOPES = new Set(['SELF', 'ASSIGNED_UNITS', 'ASSIGNED_POSTS', 'ALL']);
const messages = {
  INVALID_CREDENTIALS: 'Username atau password salah, atau akun belum dapat digunakan.',
  LOGIN_LIMITED: 'Terlalu banyak percobaan. Coba lagi nanti.',
  SESSION_ENDED: 'Sesi berakhir. Silakan masuk kembali.',
  SESSION_BUSY: 'Permintaan sebelumnya masih diproses. Coba lagi sebentar.',
  INVALID_REQUEST: 'Periksa kembali isian permintaan.',
  FORBIDDEN: 'Permintaan tidak diizinkan. Muat ulang halaman.',
  PASSWORD_REJECTED: 'Password saat ini tidak cocok atau password baru belum memenuhi ketentuan.',
  PASSWORD_UPDATE_INCOMPLETE: 'Perubahan belum dapat dikonfirmasi. Coba masuk kembali dengan password baru.',
  AUTH_UNAVAILABLE: 'Layanan masuk belum tersedia. Coba lagi nanti.',
};
class Failure extends Error {
  constructor(code = 'AUTH_UNAVAILABLE', status = 503, supportCode) { super(code); this.code = code; this.status = status; this.supportCode = supportCode; }
}
function requireValue(condition, code = 'AUTH_UNAVAILABLE', status = 503) {
  if (!condition) throw new Failure(code, status);
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64url(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 20000);
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0));
  requireValue(base64url(bytes) === value);
  return bytes;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function configuration(env) {
  const origin = new URL(env.PORTAL_ORIGIN);
  const base = new URL(env.SUPABASE_URL);
  requireValue(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.port
    && origin.pathname === '/' && !origin.search && !origin.hash);
  requireValue(base.protocol === 'https:' && /^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)
    && !base.username && !base.password && !base.port && base.pathname === '/' && !base.search && !base.hash);
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  const publishable = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  requireValue(typeof secret === 'string' && /^sb_secret_[A-Za-z0-9_-]+$/.test(secret) && secret.length <= 512);
  requireValue(typeof publishable === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishable) && publishable.length <= 512);
  const keyBytes = unbase64url(env.PORTAL_SESSION_KEY?.trim());
  requireValue(keyBytes.length === 32);
  const lifetime = env.PORTAL_SESSION_SECONDS === undefined ? 28800 : Number(env.PORTAL_SESSION_SECONDS);
  requireValue(Number.isInteger(lifetime) && lifetime >= 900 && lifetime <= 86400);
  return { origin: origin.origin, base: base.origin, secret, publishable, keyBytes, lifetime };
}
function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; Secure; SameSite=Strict; Max-Age=${seconds}${name === SESSION_COOKIE ? '; HttpOnly' : ''}`;
}
function cookies(request) {
  const result = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const position = part.indexOf('='); if (position < 0) continue;
    const name = part.slice(0, position).trim();
    if (![SESSION_COOKIE, CSRF_COOKIE].includes(name)) continue;
    requireValue(!(name in result), 'SESSION_ENDED', 401);
    result[name] = part.slice(position + 1).trim();
  }
  return result;
}
function response(data, status = 200, setCookies = []) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Strict-Transport-Security': 'max-age=31536000',
  });
  if ([409, 429].includes(status)) headers.set('Retry-After', status === 409 ? '1' : '900');
  if (status === 405) headers.set('Allow', 'GET, POST');
  for (const value of setCookies) headers.append('Set-Cookie', value);
  return new Response(JSON.stringify(data), { status, headers });
}
async function readJson(stream, maximum) {
  requireValue(stream, 'INVALID_REQUEST', 400);
  const reader = stream.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Failure('INVALID_REQUEST', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Failure('INVALID_REQUEST', 400); }
}
function jwtClaims(token) {
  requireValue(typeof token === 'string' && token.length <= 8192
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
  const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64url(token.split('.')[1])));
  requireValue(UUID.test(claims.sub) && UUID.test(claims.session_id) && Number.isSafeInteger(claims.exp));
  return claims;
}
function accountContext(value, expectedId, expectedUsername) {
  const user = value?.user;
  requireValue(user?.id === expectedId && user.status === 'ACTIVE'
    && typeof user.username === 'string' && user.username.length > 0 && user.username.length <= 64
    && user.username === user.username.trim().toLowerCase()
    && (!expectedUsername || user.username === expectedUsername)
    && typeof user.must_change_password === 'boolean'
    && Number.isSafeInteger(user.row_version) && user.row_version > 0
    && Array.isArray(value.role_assignments) && value.role_assignments.length <= 256);
  const assignments = value.role_assignments.map((a) => {
    requireValue(UUID.test(a?.assignment_id) && UUID.test(a?.role_id) && typeof a.role === 'string'
      && a.role.length > 0 && a.role.length <= 64 && SCOPES.has(a.scope_kind)
      && Array.isArray(a.permissions) && a.permissions.length <= 256
      && a.permissions.every((p) => typeof p === 'string' && p.length <= 128 && /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(p)));
    return { role: a.role, scope_kind: a.scope_kind, permissions: [...new Set(a.permissions)] };
  });
  return { id: user.id, row_version: user.row_version, username: user.username,
    must_change_password: user.must_change_password, role_assignments: assignments };
}
function publicAccount(account) {
  return { username: account.username, must_change_password: account.must_change_password,
    role_assignments: account.role_assignments };
}
function clientIp(request) {
  // Only deploy behind Cloudflare's ingress. Never accept a body or XFF override.
  const ip = request.headers.get('CF-Connecting-IP')?.toLowerCase();
  requireValue(typeof ip === 'string' && ip.length <= 45
    && (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((s) => Number(s) <= 255)
      || /^[a-f0-9:]+$/.test(ip) && ip.includes(':')));
  return ip;
}

// Workers runtime functions can depend on their global receiver. Keep the
// production fetch bound; injected test transports still remain replaceable.
export function createAuthHandler({ fetchImpl = globalThis.fetch.bind(globalThis), cryptoImpl = globalThis.crypto,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const encode = (value) => new TextEncoder().encode(value);
  const random = () => base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  const hash = async (value) => Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', encode(value))), (b) => b.toString(16).padStart(2, '0')).join('');

  return async function handle(request, env) {
    const clearCookies = [cookie(SESSION_COOKIE, '', 0), cookie(CSRF_COOKIE, '', 0)];
    let clear = false;
    let config; let key; let held; let pair; let currentAccount; let tokenHash; let leaseHash;
    let leaseOwned = false; let createdHash; let receivedLoginToken;
    let loginStage;
    const deadline = now() + 40000;
    async function api(path, { body, token, admin = false, method = 'POST', cleanup = false } = {}) {
      const remaining = cleanup ? 4000 : Math.min(10000, deadline - now());
      requireValue(remaining > 0);
      const result = await fetchImpl(`${config.base}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(Math.ceil(remaining)),
        headers: { apikey: admin ? config.secret : config.publishable,
          'User-Agent': 'SPH-Portal-Backend/1.0',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (path === '/functions/v1/portal-login') loginStage = 'LOGIN_SERVICE_BODY';
      let data = null;
      if (result.status !== 204 && result.body) {
        try { data = await readJson(result.body, 1048576); }
        catch { throw new Failure(); }
      }
      return { status: result.status, ok: result.ok, data };
    }
    async function rpc(name, body, cleanup = false) {
      const result = await api(`/rest/v1/rpc/${name}`, { body, admin: true, cleanup });
      requireValue(result.ok); return result.data;
    }
    async function signout(token, scope = 'local') {
      const result = await api(`/auth/v1/logout?scope=${scope}`, { token, cleanup: true });
      // If the user/session is already gone there is nothing left to sign out.
      requireValue(result.ok || [401, 403, 404].includes(result.status));
    }
    const aad = (hashValue, userId, authId) => encode(`sph-web-session-v1\0${hashValue}\0${userId}\0${authId}`);
    async function encrypt(tokens, hashValue, userId, authId) {
      const nonce = cryptoImpl.getRandomValues(new Uint8Array(12));
      const ciphertext = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv: nonce,
        additionalData: aad(hashValue, userId, authId), tagLength: 128 }, key, encode(JSON.stringify(tokens)));
      return `v1.${base64url(nonce)}.${base64url(new Uint8Array(ciphertext))}`;
    }
    async function decrypt(value, hashValue, userId, authId) {
      requireValue(typeof value === 'string' && value.length <= 16020
        && /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.test(value));
      const [, nonce, cipher] = value.split('.');
      const bytes = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(nonce),
        additionalData: aad(hashValue, userId, authId), tagLength: 128 }, key, unbase64url(cipher));
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    function validatePair(value) {
      requireValue(typeof value?.refresh_token === 'string' && value.refresh_token.length > 0 && value.refresh_token.length <= 4096);
      const claims = jwtClaims(value.access_token);
      requireValue(claims.iss === `${config.base}/auth/v1` && claims.role === 'authenticated');
      return claims;
    }
    async function verifyTokens(tokens, userId, authId) {
      const claims = validatePair(tokens);
      requireValue(claims.sub === userId && claims.session_id === authId
        && claims.exp * 1000 > now() && claims.exp * 1000 <= now() + 86400000);
      // JWT decoding above is shape/binding validation, NOT authentication.
      const result = await api('/auth/v1/user', { method: 'GET', token: tokens.access_token });
      if ([401, 403, 404].includes(result.status)) throw new Failure('SESSION_ENDED', 401);
      requireValue(result.ok && result.data?.id === userId && !result.data.is_anonymous);
      return claims;
    }
    async function profile(tokens, userId, username) {
      const result = await api('/rest/v1/rpc/portal_current_account', { body: {}, token: tokens.access_token });
      if ([401, 403].includes(result.status) || result.ok && result.data === null) throw new Failure('SESSION_ENDED', 401);
      requireValue(result.ok); return accountContext(result.data, userId, username);
    }
    async function withSession(action, body, refreshAttempt = 0) {
      const values = cookies(request);
      if (!values[SESSION_COOKIE] && action === 'logout') { clear = true; return response({ ok: true }, 200, clearCookies); }
      requireValue(RANDOM.test(values[SESSION_COOKIE] ?? '') && RANDOM.test(values[CSRF_COOKIE] ?? ''), 'SESSION_ENDED', 401);
      if (action !== 'me') requireValue(equal(values[CSRF_COOKIE], request.headers.get('x-csrf-token')), 'FORBIDDEN', 403);
      tokenHash = await hash(values[SESSION_COOKIE]); leaseHash = await hash(random());
      for (let attempt = 0; attempt < 2; attempt++) {
        held = await rpc('portal_acquire_web_session', { p_token_hash: tokenHash, p_lease_hash: leaseHash });
        if (held?.status !== 'busy') break;
        if (attempt === 0) await sleep(60);
      }
      if (held?.status === 'busy') throw new Failure('SESSION_BUSY', 409);
      requireValue(held, 'SESSION_ENDED', 401);
      leaseOwned = true;
      requireValue(held.status === 'acquired' && UUID.test(held.id) && UUID.test(held.user_id)
        && UUID.test(held.auth_session_id) && HASH.test(held.csrf_hash)
        && Number.isSafeInteger(held.version) && held.version >= 1
        && Number.isFinite(Date.parse(held.expires_at)) && Date.parse(held.expires_at) > now()
        && Number.isFinite(Date.parse(held.access_expires_at)));
      requireValue(equal(await hash(values[CSRF_COOKIE]), held.csrf_hash), 'FORBIDDEN', 403);
      try { pair = await decrypt(held.token_box, tokenHash, held.user_id, held.auth_session_id); }
      catch { throw new Failure('SESSION_ENDED', 401); }
      let claims = validatePair(pair);
      requireValue(claims.sub === held.user_id && claims.session_id === held.auth_session_id);
      if (action === 'logout') {
        const revoked = await rpc('portal_revoke_web_session', { p_token_hash: tokenHash });
        requireValue(revoked === true); leaseOwned = false; clear = true;
        // A revoked portal cookie can never be used again, even if Auth is down.
        if (claims.exp * 1000 > now()) await signout(pair.access_token);
        else {
          const refreshed = await api('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: pair.refresh_token } });
          if (refreshed.ok) {
            const refreshedClaims = validatePair(refreshed.data);
            requireValue(refreshedClaims.sub === held.user_id && refreshedClaims.session_id === held.auth_session_id);
            await signout(refreshed.data.access_token);
          } else requireValue([400, 401, 403].includes(refreshed.status));
        }
        return response({ ok: true }, 200, clearCookies);
      }
      if (Math.min(claims.exp * 1000, Date.parse(held.access_expires_at)) <= now() + 60000) {
        requireValue(refreshAttempt === 0);
        const refreshed = await api('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: pair.refresh_token } });
        if ([400, 401, 403].includes(refreshed.status)) throw new Failure('SESSION_ENDED', 401);
        requireValue(refreshed.ok);
        const next = { access_token: refreshed.data?.access_token, refresh_token: refreshed.data?.refresh_token };
        claims = await verifyTokens(next, held.user_id, held.auth_session_id); pair = next;
        const box = await encrypt(pair, tokenHash, held.user_id, held.auth_session_id);
        const saved = await rpc('portal_save_web_session', { p_token_hash: tokenHash, p_lease_hash: leaseHash,
          p_expected_version: held.version, p_token_box: box, p_access_expires_at: new Date(claims.exp * 1000).toISOString() });
        requireValue(saved === true, 'SESSION_ENDED', 401);
        leaseOwned = false;
        // Saving releases the lease. Reacquire before any further use of tokens.
        return await withSession(action, body, refreshAttempt + 1);
      }
      await verifyTokens(pair, held.user_id, held.auth_session_id);
      currentAccount = await profile(pair, held.user_id);
      if (action === 'me') return response({ ok: true, account: publicAccount(currentAccount) });

      // Only 'password' reaches here; every future operational route must also
      // enforce must_change_password, action permissions, and assignment scopes.
      const ip = clientIp(request);
      const allowed = await rpc('portal_take_login_slot', {
        p_username_hash: await hash(`username\0${currentAccount.username}`), p_ip_hash: await hash(`ip\0${ip}`),
      });
      requireValue(typeof allowed === 'boolean');
      requireValue(allowed, 'LOGIN_LIMITED', 429);
      let updated;
      try {
        updated = await api('/auth/v1/user', { method: 'PUT', token: pair.access_token,
          body: { password: body.new_password, current_password: body.current_password } });
      } catch { clear = true; throw new Failure('PASSWORD_UPDATE_INCOMPLETE', 503); }
      if ([400, 422].includes(updated.status)) throw new Failure('PASSWORD_REJECTED', 422);
      if (updated.status === 429) throw new Failure('LOGIN_LIMITED', 429);
      if ([401, 403].includes(updated.status)) throw new Failure('SESSION_ENDED', 401);
      clear = true;
      requireValue(updated.ok, 'PASSWORD_UPDATE_INCOMPLETE', 503);
      requireValue(updated.data?.id === held.user_id, 'PASSWORD_UPDATE_INCOMPLETE', 503);
      try {
        const completed = await rpc('portal_complete_password_change', { p_token_hash: tokenHash,
          p_lease_hash: leaseHash, p_expected_account_version: currentAccount.row_version });
        requireValue(completed === true);
        leaseOwned = false;
        await signout(pair.access_token, 'global');
      } catch { throw new Failure('PASSWORD_UPDATE_INCOMPLETE', 503); }
      return response({ ok: true, password_changed: true, sign_in_required: true }, 200, clearCookies);
    }
    try {
      const url = new URL(request.url);
      const match = /^\/api\/auth\/(login|me|logout|password)$/.exec(url.pathname);
      if (!match) return response({ ok: false, error: 'NOT_FOUND' }, 404);
      const action = match[1]; const method = action === 'me' ? 'GET' : 'POST';
      if (request.method !== method) return response({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
      requireValue(!url.search, 'INVALID_REQUEST', 400);
      config = configuration(env);
      requireValue(url.origin === config.origin, 'FORBIDDEN', 403);
      requireValue(!['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site')), 'FORBIDDEN', 403);
      if (method === 'POST') requireValue(request.headers.get('origin') === config.origin, 'FORBIDDEN', 403);
      key = await cryptoImpl.subtle.importKey('raw', config.keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
      let body = {};
      if (method === 'POST') {
        requireValue(request.headers.get('content-type')?.toLowerCase().startsWith('application/json'), 'INVALID_REQUEST', 415);
        body = await readJson(request.body, 4096);
        requireValue(body && typeof body === 'object' && !Array.isArray(body), 'INVALID_REQUEST', 400);
      }
      if (action === 'password') {
        requireValue(typeof body.current_password === 'string' && body.current_password.length >= 1 && body.current_password.length <= 128
          && typeof body.new_password === 'string' && body.new_password.length >= 12 && body.new_password.length <= 128
          && body.new_password !== body.current_password, 'INVALID_REQUEST', 400);
      }
      if (action !== 'login') return await withSession(action, body);

      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
      requireValue(username.length > 0 && username.length <= 64 && typeof body.password === 'string'
        && body.password.length > 0 && body.password.length <= 128, 'INVALID_REQUEST', 400);
      // This IP comes from Cloudflare ingress, never from JSON or X-Forwarded-For.
      loginStage = 'LOGIN_CLIENT_ADDRESS';
      const ingressIp = clientIp(request);
      loginStage = 'LOGIN_SERVICE_NETWORK';
      const result = await api('/functions/v1/portal-login', { admin: true,
        body: { action: 'login', username, password: body.password, client_ip: ingressIp } });
      if (result.status === 401 && result.data?.error === 'INVALID_CREDENTIALS') throw new Failure('INVALID_CREDENTIALS', 401);
      if (result.status === 429) throw new Failure('LOGIN_LIMITED', 429);
      if ([401, 403].includes(result.status)) throw new Failure('AUTH_UNAVAILABLE', 503, 'LOGIN_SERVICE_AUTH');
      if (result.status === 404) throw new Failure('AUTH_UNAVAILABLE', 503, 'LOGIN_SERVICE_MISSING');
      loginStage = 'LOGIN_SERVICE_RESPONSE';
      requireValue(result.ok && result.data?.ok === true);
      loginStage = 'LOGIN_SESSION_RESPONSE';
      pair = { access_token: result.data.session?.access_token, refresh_token: result.data.session?.refresh_token };
      // Capture any well-shaped returned JWT for cleanup even if the rest fails.
      if (typeof pair.access_token === 'string' && pair.access_token.length <= 8192
        && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(pair.access_token)) receivedLoginToken = pair.access_token;
      const claims = validatePair(pair);
      loginStage = 'LOGIN_AUTH_VERIFICATION';
      await verifyTokens(pair, claims.sub, claims.session_id);
      loginStage = 'LOGIN_ACCOUNT_CONTEXT';
      currentAccount = await profile(pair, claims.sub, username);
      loginStage = 'LOGIN_SESSION_STORAGE';
      const token = random(); const csrf = random();
      tokenHash = await hash(token);
      const box = await encrypt(pair, tokenHash, claims.sub, claims.session_id);
      createdHash = tokenHash;
      const registered = await rpc('portal_create_web_session', { p_user_id: claims.sub,
        p_auth_session_id: claims.session_id, p_token_hash: tokenHash, p_csrf_hash: await hash(csrf),
        p_token_box: box, p_access_expires_at: new Date(claims.exp * 1000).toISOString(), p_lifetime_seconds: config.lifetime });
      requireValue(registered && UUID.test(registered.id) && Number.isFinite(Date.parse(registered.expires_at)));
      const remaining = Date.parse(registered.expires_at) - now();
      const seconds = Math.min(config.lifetime, Math.floor(remaining / 1000));
      requireValue(seconds > 0 && remaining <= config.lifetime * 1000 + 60000);
      const answer = response({ ok: true, account: publicAccount(currentAccount) }, 200,
        [cookie(SESSION_COOKIE, token, seconds), cookie(CSRF_COOKIE, csrf, seconds)]);
      receivedLoginToken = undefined; createdHash = undefined;
      return answer;
    } catch (error) {
      const failure = error instanceof Failure ? error : new Failure();
      if (failure.code === 'SESSION_ENDED') {
        clear = true;
        if (tokenHash && config) { try { await rpc('portal_revoke_web_session', { p_token_hash: tokenHash }, true); } catch {} }
        if (held && pair?.access_token && !receivedLoginToken) { try { await signout(pair.access_token); } catch {} }
      }
      if (createdHash) { try { await rpc('portal_revoke_web_session', { p_token_hash: createdHash }, true); } catch {} }
      if (receivedLoginToken) { try { await signout(receivedLoginToken); } catch {} }
      if (clear && pair?.access_token && !receivedLoginToken && failure.code === 'PASSWORD_UPDATE_INCOMPLETE') {
        try { await rpc('portal_revoke_web_session', { p_token_hash: tokenHash }, true); } catch {}
        try { await signout(pair.access_token, 'global'); } catch {}
      }
      // Fixed support labels only: never include an exception, upstream body,
      // username, IP, identifier, credential, or request data in diagnostics.
      const supportCode = failure.code === 'AUTH_UNAVAILABLE' ? failure.supportCode ?? loginStage : undefined;
      return response({ ok: false, error: failure.code, message: messages[failure.code] ?? messages.AUTH_UNAVAILABLE,
        ...(supportCode ? { support_code: supportCode } : {}) }, failure.status, clear ? clearCookies : []);
    } finally {
      if (leaseOwned) { try { await rpc('portal_release_web_session', { p_token_hash: tokenHash, p_lease_hash: leaseHash }, true); } catch {} }
    }
  };
}

export const handleAuth = createAuthHandler();
