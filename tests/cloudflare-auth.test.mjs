import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createAuthHandler } from '../site-info/lib/portal-auth.mjs';

const userId = '10000000-0000-4000-8000-000000000001';
const authId = '20000000-0000-4000-8000-000000000001';
const webId = '30000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const clock = Date.now();
const hash = (s) => createHash('sha256').update(s).digest('hex');
const key = Buffer.alloc(32, 7);
const env = {
  PORTAL_ORIGIN: 'https://fixture-portal.pages.dev', SUPABASE_URL: 'https://fixture-project.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_fixture-only', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture-only',
  PORTAL_SESSION_KEY: key.toString('base64url'),
};
const credentials = { username: '  ITAdmin  ', password: 'fixture-current-password' };
const changed = { current_password: credentials.password, new_password: 'fixture-new-password' };
const claims = (extra = {}) => ({ sub: userId, session_id: authId, exp: Math.floor(clock / 1000) + 3600,
  iss: `${env.SUPABASE_URL}/auth/v1`, role: 'authenticated', ...extra });
const jwt = (extra) => `${Buffer.from('{"alg":"fixture-only"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims(extra))).toString('base64url')}.fixture-signature`;
const originalToken = jwt();
function profile() {
  return { user: { id: userId, username: 'itadmin', status: 'ACTIVE', must_change_password: true, row_version: 1 },
    role_assignments: [
      { assignment_id: '40000000-0000-4000-8000-000000000001', role_id: '50000000-0000-4000-8000-000000000001',
        role: 'SUPER_ADMIN', scope_kind: 'ALL', permissions: ['admin.users.read'] },
      { assignment_id: '40000000-0000-4000-8000-000000000002', role_id: '50000000-0000-4000-8000-000000000002',
        role: 'HR_READER', scope_kind: 'SELF', permissions: ['hr.employees.read'] },
    ] };
}
function fixture(options = {}) {
  const calls = []; let stored; let revoked = false; let currentProfile = profile(); let acquireCount = 0;
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url); const path = parsed.pathname + parsed.search;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init.headers);
    calls.push({ path, body, headers, method: init.method, redirect: init.redirect, signal: init.signal });
    assert.equal(parsed.origin, env.SUPABASE_URL); assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    const answer = (data, status = 200) => status === 204 ? new Response(null, { status }) : Response.json(data, { status });
    if (path === '/functions/v1/portal-login') {
      assert.equal(headers.get('apikey'), env.SUPABASE_SECRET_KEY);
      return answer(options.loginData ?? { ok: true, session: { access_token: originalToken, refresh_token: 'fixture-refresh' } }, options.loginStatus ?? 200);
    }
    if (path === '/auth/v1/user' && init.method === 'GET') {
      assert.equal(headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
      return answer({ id: options.verifiedUser ?? userId, is_anonymous: false, email: 'fixture-private@example.invalid' }, options.verifyStatus ?? 200);
    }
    if (path === '/auth/v1/user' && init.method === 'PUT') {
      if (options.updateThrows) throw new Error('fixture-sensitive-upstream-error');
      return answer({ id: options.updatedUser ?? userId, error_code: 'fixture-private-error' }, options.updateStatus ?? 200);
    }
    if (path === '/rest/v1/rpc/portal_current_account') {
      assert.equal(headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
      assert.ok(headers.get('authorization')?.startsWith('Bearer '));
      return answer(options.profileData === undefined ? currentProfile : options.profileData);
    }
    if (path === '/auth/v1/token?grant_type=refresh_token') {
      assert.equal(body.refresh_token, 'fixture-refresh');
      return answer({ access_token: jwt(options.refreshedClaims), refresh_token: 'fixture-next-refresh' }, options.refreshStatus ?? 200);
    }
    if (path.startsWith('/auth/v1/logout?scope=')) {
      if (options.signoutThrows) throw new Error('fixture-private-signout-error');
      return answer(null, options.signoutStatus ?? 204);
    }
    const rpc = parsed.pathname.split('/').at(-1);
    assert.equal(headers.get('apikey'), env.SUPABASE_SECRET_KEY);
    assert.equal(headers.has('authorization'), false);
    if (rpc === 'portal_create_web_session') {
      stored = { status: 'acquired', id: webId, user_id: body.p_user_id, auth_session_id: body.p_auth_session_id,
        csrf_hash: body.p_csrf_hash, token_box: body.p_token_box, token_hash: body.p_token_hash,
        access_expires_at: body.p_access_expires_at,
        expires_at: new Date(clock + body.p_lifetime_seconds * 1000).toISOString(), version: 1 };
      return answer(options.registerFails ? null : { id: options.registeredId ?? webId, expires_at: stored.expires_at });
    }
    if (rpc === 'portal_acquire_web_session') {
      acquireCount++;
      if (options.busy) return answer({ status: 'busy' });
      if (options.sessionGone || revoked || body.p_token_hash !== stored?.token_hash) return answer(null);
      const { token_hash, ...result } = stored;
      return answer(result);
    }
    if (rpc === 'portal_save_web_session') {
      if (!options.staleRefreshState) Object.assign(stored, { token_box: body.p_token_box,
        access_expires_at: body.p_access_expires_at, version: stored.version + 1 });
      return answer(!options.saveFails);
    }
    if (rpc === 'portal_release_web_session') return answer(true);
    if (rpc === 'portal_revoke_web_session') { revoked = true; return answer(true); }
    if (rpc === 'portal_take_login_slot') return answer(!options.limited);
    if (rpc === 'portal_complete_password_change') {
      if (options.completeFails) return answer(false);
      revoked = true; return answer(true);
    }
    throw new Error(`Unexpected fixture request: ${path}`);
  };
  const handler = createAuthHandler({ fetchImpl, cryptoImpl: webcrypto, now: () => clock, sleep: async () => {} });
  return { options, handler, calls, env: { ...env }, get stored() { return stored; },
    get acquired() { return acquireCount; }, get revoked() { return revoked; },
    setProfile: (value) => { currentProfile = value; },
    called: (name) => calls.filter((c) => c.path.includes(name)),
  };
}
function request(action, { body, cookie, csrf, method, headers = {}, raw, origin = env.PORTAL_ORIGIN } = {}) {
  const verb = method ?? (action === 'me' ? 'GET' : 'POST');
  return new Request(`${origin}/api/auth/${action}`, { method: verb,
    headers: { origin, 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.1',
      'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
    ...(verb !== 'GET' && verb !== 'HEAD' ? { body: raw ?? JSON.stringify(body ?? {}) } : {}),
  });
}
async function login(f) {
  const response = await f.handler(request('login', { body: credentials }), f.env);
  assert.equal(response.status, 200, await response.clone().text());
  const values = response.headers.getSetCookie();
  const cookie = values.map((c) => c.split(';')[0]).join('; ');
  const csrf = values.find((c) => c.startsWith('__Host-sph_csrf=')).split(';')[0].split('=')[1];
  return { response, cookie, csrf };
}
function assertPrivate(responseText) {
  for (const value of [env.SUPABASE_SECRET_KEY, env.PORTAL_SESSION_KEY, credentials.password,
    'fixture-refresh', 'fixture-next-refresh', 'fixture-private@example.invalid', 'fixture-sensitive-upstream-error', originalToken, userId, authId]) {
    assert.equal(responseText.includes(value), false, value);
  }
}

test('login verifies Auth and current profile, stores real AES-GCM ciphertext, and exposes only safe account data and opaque cookies', async () => {
  const f = fixture(); const result = await login(f);
  const text = await result.response.text(); assertPrivate(text);
  const cookies = result.response.headers.getSetCookie();
  assert.match(cookies[0], /^__Host-sph_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; SameSite=Strict; Max-Age=28800; HttpOnly$/);
  assert.match(cookies[1], /^__Host-sph_csrf=[A-Za-z0-9_-]{43}; Path=\/; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.notEqual(result.cookie.split(';')[0].split('=')[1], result.csrf);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  const data = JSON.parse(text); assert.equal(data.account.must_change_password, true);
  assert.deepEqual(data.account.role_assignments.map((a) => [a.scope_kind, a.permissions]),
    [['ALL', ['admin.users.read']], ['SELF', ['hr.employees.read']]]);
  const created = f.called('portal_create_web_session')[0].body;
  assert.equal(created.p_token_hash, hash(cookies[0].split(';')[0].split('=')[1]));
  assert.equal(created.p_csrf_hash, hash(result.csrf));
  const [, nonce, cipher] = created.p_token_box.split('.');
  const cryptoKey = await webcrypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const decrypted = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(nonce, 'base64url'),
    additionalData: Buffer.from(`sph-web-session-v1\0${created.p_token_hash}\0${userId}\0${authId}`), tagLength: 128 }, cryptoKey, Buffer.from(cipher, 'base64url'));
  assert.deepEqual(JSON.parse(Buffer.from(decrypted).toString()), { access_token: originalToken, refresh_token: 'fixture-refresh' });
  assert.ok(f.calls.findIndex((c) => c.path === '/auth/v1/user') < f.calls.findIndex((c) => c.path.endsWith('portal_create_web_session')));
});

test('login normalizes username and takes IP only from Cloudflare ingress', async () => {
  const f = fixture();
  const response = await f.handler(request('login', { body: { ...credentials, client_ip: '198.51.100.5' },
    headers: { 'x-forwarded-for': '198.51.100.6' } }), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(f.called('portal-login')[0].body, { action: 'login', username: 'itadmin', password: credentials.password, client_ip: '192.0.2.1' });
  const noIp = fixture();
  const missing = request('login', { body: credentials }); missing.headers.delete('CF-Connecting-IP');
  assert.equal((await noIp.handler(missing, noIp.env)).status, 503); assert.equal(noIp.calls.length, 0);
});

test('credential failures and rate limits use safe messages without forwarding upstream payloads', async () => {
  for (const [status, error] of [[401, 'INVALID_CREDENTIALS'], [429, 'LOGIN_LIMITED'], [500, 'AUTH_UNAVAILABLE']]) {
    const f = fixture({ loginStatus: status, loginData: { error: status === 401 ? 'INVALID_CREDENTIALS' : 'fixture-error', message: credentials.password } });
    const response = await f.handler(request('login', { body: credentials }), f.env);
    assert.equal(response.status, status === 500 ? 503 : status);
    const text = await response.text(); assertPrivate(text); assert.equal(JSON.parse(text).error, error);
    assert.equal(response.headers.getSetCookie().length, 0); assert.equal(f.called('portal_create_web_session').length, 0);
  }
  const f = fixture({ loginStatus: 401, loginData: { error: { code: 'INVALID_API_KEY', message: env.SUPABASE_SECRET_KEY } } });
  const response = await f.handler(request('login', { body: credentials }), f.env);
  assert.equal(response.status, 503); assertPrivate(await response.text());
});

test('upstream identity or profile failures cannot create a portal session and clean up the received Auth session', async () => {
  const variants = [{ verifiedUser: otherId }, { verifyStatus: 401 }, { profileData: null },
    { profileData: { ...profile(), user: { ...profile().user, id: otherId } } },
    { profileData: { ...profile(), user: { ...profile().user, username: 'other' } } },
    { profileData: { ...profile(), user: { ...profile().user, status: 'INACTIVE' } } },
    { profileData: { ...profile(), role_assignments: [{ ...profile().role_assignments[0], scope_kind: 'UNKNOWN' }] } }];
  for (const options of variants) {
    const f = fixture(options); const response = await f.handler(request('login', { body: credentials }), f.env);
    assert.notEqual(response.status, 200); assert.equal(f.called('portal_create_web_session').length, 0);
    assert.equal(f.called('/auth/v1/logout?scope=local').length, 1); assertPrivate(await response.text());
  }
});

test('registration failures revoke any possibly created registry entry and sign out Auth', async () => {
  for (const options of [{ registerFails: true }, { registeredId: 'bad-id' }]) {
    const f = fixture(options); const response = await f.handler(request('login', { body: credentials }), f.env);
    assert.equal(response.status, 503); assert.equal(f.called('portal_revoke_web_session').length, 1);
    assert.equal(f.called('/auth/v1/logout?scope=local').length, 1); assertPrivate(await response.text());
  }
});

test('invalid configuration, origins, routes, methods, content types, JSON, and body sizes fail before any upstream request', async () => {
  const cases = [
    [request('login', { body: credentials }), { ...env, SUPABASE_URL: 'https://attacker.invalid' }, 503],
    [request('login', { body: credentials }), { ...env, PORTAL_SESSION_KEY: 'bad-key' }, 503],
    [request('login', { body: credentials }), { ...env, SUPABASE_SECRET_KEY: env.SUPABASE_PUBLISHABLE_KEY }, 503],
    [request('login', { body: credentials }), { ...env, PORTAL_SESSION_SECONDS: '86401' }, 503],
    [request('login', { body: credentials, origin: 'https://preview.fixture-portal.pages.dev' }), env, 403],
    [request('login', { body: credentials, headers: { origin: 'https://attacker.invalid' } }), env, 403],
    [request('login', { body: credentials, headers: { 'sec-fetch-site': 'same-site' } }), env, 403],
    [request('login', { method: 'GET' }), env, 405],
    [request('admin'), env, 404],
    [request('login', { body: credentials, headers: { 'content-type': 'text/plain' } }), env, 415],
    [request('login', { raw: '{invalid' }), env, 400],
    [request('login', { raw: '[]' }), env, 400],
    [request('login', { raw: JSON.stringify({ username: 'itadmin', password: '界'.repeat(2000) }) }), env, 413],
    [request('login', { body: { username: '', password: 'x' } }), env, 400],
  ];
  for (const [req, config, status] of cases) {
    const f = fixture(); const response = await f.handler(req, config);
    assert.equal(response.status, status); assert.equal(f.calls.length, 0); assertPrivate(await response.text());
  }
  const f = fixture(); const req = request('login', { body: credentials }); req.headers.delete('origin');
  assert.equal((await f.handler(req, env)).status, 403); assert.equal(f.calls.length, 0);
});

test('me revalidates Auth and reads fresh assignment-scoped permissions on every request', async () => {
  const f = fixture(); const session = await login(f);
  const next = profile(); next.role_assignments = [next.role_assignments[1]]; f.setProfile(next);
  const response = await f.handler(request('me', session), f.env);
  assert.equal(response.status, 200);
  const text = await response.text(); assertPrivate(text);
  assert.deepEqual(JSON.parse(text).account.role_assignments, [{ role: 'HR_READER', scope_kind: 'SELF', permissions: ['hr.employees.read'] }]);
  assert.equal(f.called('/auth/v1/user').length, 2); assert.equal(f.called('portal_current_account').length, 2);
  assert.equal(f.called('portal_release_web_session').length, 1);
  assert.equal(response.headers.getSetCookie().length, 0);
});

test('mutations require a matching CSRF header plus the server-stored hash', async () => {
  const f = fixture(); const session = await login(f);
  for (const csrf of [undefined, 'wrong-csrf']) {
    const response = await f.handler(request('password', { ...session, body: changed, csrf }), f.env);
    assert.equal(response.status, 403); assert.equal(f.called('portal_acquire_web_session').length, 0);
  }
  const wrong = Buffer.alloc(32, 8).toString('base64url');
  const response = await f.handler(request('password', { ...session, body: changed, csrf: wrong,
    cookie: session.cookie.replace(session.csrf, wrong) }), f.env);
  assert.equal(response.status, 403); assert.equal(f.called('portal_release_web_session').length, 1);
  assert.equal(f.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('malformed or duplicate session cookies are rejected and cleared', async () => {
  const f = fixture(); const session = await login(f);
  for (const cookie of ['__Host-sph_session=bad; __Host-sph_csrf=bad', `${session.cookie}; ${session.cookie}`, '']) {
    const response = await f.handler(request('me', { cookie }), f.env);
    assert.equal(response.status, 401); assert.equal(response.headers.getSetCookie().length, 2);
    assert.match(response.headers.getSetCookie()[0], /Max-Age=0/);
  }
});

test('refresh rotates encrypted tokens under a lease, reacquires, and keeps the original opaque cookies and absolute expiry', async () => {
  const f = fixture(); const session = await login(f);
  const expires = f.stored.expires_at; const originalBox = f.stored.token_box;
  f.stored.access_expires_at = new Date(clock - 1000).toISOString();
  const response = await f.handler(request('me', session), f.env);
  assert.equal(response.status, 200, await response.clone().text()); assertPrivate(await response.text());
  assert.equal(f.called('grant_type=refresh_token').length, 1); assert.equal(f.acquired, 2);
  assert.notEqual(f.stored.token_box, originalBox); assert.equal(f.stored.version, 2);
  assert.equal(f.stored.expires_at, expires); assert.equal(response.headers.getSetCookie().length, 0);
  const saved = f.called('portal_save_web_session')[0].body;
  assert.equal(saved.p_expected_version, 1); assert.match(saved.p_lease_hash, /^[a-f0-9]{64}$/);
});

test('failed refresh or stale refresh saves end the session; temporary outages release the lease', async () => {
  for (const [options, status] of [[{ refreshStatus: 400 }, 401], [{ saveFails: true }, 401], [{ refreshStatus: 503 }, 503]]) {
    const f = fixture(options); const session = await login(f);
    f.stored.access_expires_at = new Date(clock - 1000).toISOString();
    const response = await f.handler(request('me', session), f.env);
    assert.equal(response.status, status);
    if (status === 401) { assert.ok(f.revoked); assert.equal(response.headers.getSetCookie().length, 2); }
    else assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(f.called('portal_release_web_session').length, 1); assertPrivate(await response.text());
  }
});

test('refresh identity changes and stale reacquisition fail closed with a bounded refresh attempt', async () => {
  for (const options of [{ refreshedClaims: { sub: otherId } }, { staleRefreshState: true }]) {
    const f = fixture(options); const session = await login(f);
    f.stored.access_expires_at = new Date(clock - 1000).toISOString();
    const response = await f.handler(request('me', session), f.env);
    assert.equal(response.status, 503); assert.equal(f.called('grant_type=refresh_token').length, 1);
    assert.equal(f.called('portal_release_web_session').length, 1);
  }
});

test('missing or expired portal sessions cannot use valid-looking JWTs', async () => {
  for (const gone of [true, false]) {
    const f = fixture(); const session = await login(f);
    if (gone) f.options.sessionGone = true; else f.stored.expires_at = new Date(clock - 1000).toISOString();
    const response = await f.handler(request('me', session), f.env);
    assert.notEqual(response.status, 200); assertPrivate(await response.text());
    assert.equal(f.called('/auth/v1/user').length, 1);
  }
});

test('two busy lease results return a retryable conflict without exposing session data', async () => {
  const f = fixture(); const session = await login(f); f.options.busy = true;
  const response = await f.handler(request('me', session), f.env);
  assert.equal(response.status, 409); assert.equal(response.headers.get('retry-after'), '1');
  assert.equal(f.acquired, 2); assert.equal(f.called('portal_release_web_session').length, 0); assertPrivate(await response.text());
});

test('ciphertext tampering, key changes, or changed AAD revoke the portal session before any Auth use', async () => {
  for (const mutate of [
    (f) => { const b = f.stored.token_box; const i = b.lastIndexOf('.') + 10; f.stored.token_box = b.slice(0, i) + (b[i] === 'A' ? 'B' : 'A') + b.slice(i + 1); },
    (f) => { f.env.PORTAL_SESSION_KEY = Buffer.alloc(32, 9).toString('base64url'); },
    (f) => { f.stored.auth_session_id = '20000000-0000-4000-8000-000000000002'; },
  ]) {
    const f = fixture(); const session = await login(f); mutate(f);
    const response = await f.handler(request('me', session), f.env);
    assert.equal(response.status, 401); assert.equal(f.revoked, true);
    assert.equal(f.called('/auth/v1/user').length, 1); assertPrivate(await response.text());
  }
});

test('logout revokes the portal session before Auth signout and clears cookies even if signout fails', async () => {
  for (const signoutThrows of [false, true]) {
    const f = fixture({ signoutThrows }); const session = await login(f);
    const response = await f.handler(request('logout', session), f.env);
    assert.equal(response.status, signoutThrows ? 503 : 200); assert.equal(f.revoked, true);
    assert.equal(response.headers.getSetCookie().length, 2);
    assert.ok(f.calls.findIndex((c) => c.path.endsWith('portal_revoke_web_session')) < f.calls.findIndex((c) => c.path.includes('/auth/v1/logout')));
    assertPrivate(await response.text());
  }
  const f = fixture();
  assert.equal((await f.handler(request('logout'), f.env)).status, 200); assert.equal(f.calls.length, 0);
});

test('password change sends current_password to user Auth before clearing the flag and globally signing out', async () => {
  const f = fixture(); const session = await login(f);
  const response = await f.handler(request('password', { ...session, body: { ...changed, user_id: otherId, must_change_password: false } }), f.env);
  assert.equal(response.status, 200, await response.clone().text()); assertPrivate(await response.text());
  assert.equal(response.headers.getSetCookie().length, 2);
  const update = f.calls.find((c) => c.method === 'PUT');
  assert.deepEqual(update.body, { password: changed.new_password, current_password: changed.current_password });
  assert.equal(update.headers.get('authorization'), `Bearer ${originalToken}`);
  const complete = f.called('portal_complete_password_change')[0];
  assert.deepEqual(Object.keys(complete.body).sort(), ['p_expected_account_version', 'p_lease_hash', 'p_token_hash']);
  assert.equal(complete.body.p_expected_account_version, 1);
  assert.ok(f.calls.indexOf(update) < f.calls.indexOf(complete));
  assert.ok(f.calls.indexOf(complete) < f.calls.indexOf(f.called('/auth/v1/logout?scope=global')[0]));
  const rate = f.called('portal_take_login_slot')[0].body;
  assert.deepEqual(rate, { p_username_hash: hash('username\0itadmin'), p_ip_hash: hash('ip\0' + '192.0.2.1') });
});

test('rejected or rate-limited password updates never call completion and retain the current session', async () => {
  for (const [options, status] of [[{ updateStatus: 400 }, 422], [{ updateStatus: 422 }, 422], [{ limited: true }, 429]]) {
    const f = fixture(options); const session = await login(f);
    const response = await f.handler(request('password', { ...session, body: changed }), f.env);
    assert.equal(response.status, status); assert.equal(f.called('portal_complete_password_change').length, 0);
    assert.equal(f.revoked, false); assert.equal(response.headers.getSetCookie().length, 0);
    if (options.limited) assert.equal(f.calls.filter((c) => c.method === 'PUT').length, 0);
    assertPrivate(await response.text());
  }
});

test('uncertain password updates or failed completion clear cookies, revoke the portal session, and report no false success', async () => {
  for (const options of [{ updateThrows: true }, { updateStatus: 500 }, { completeFails: true }, { updatedUser: otherId }, { signoutThrows: true }]) {
    const f = fixture(options); const session = await login(f);
    const response = await f.handler(request('password', { ...session, body: changed }), f.env);
    assert.equal(response.status, 503); const data = await response.json();
    assert.equal(data.error, 'PASSWORD_UPDATE_INCOMPLETE'); assert.equal(data.ok, false);
    assert.equal(f.revoked, true); assert.equal(response.headers.getSetCookie().length, 2);
    if (options.updateThrows || options.updatedUser) assert.equal(f.called('portal_complete_password_change').length, 0);
  }
});

test('invalid password changes fail before acquiring a session', async () => {
  const f = fixture(); const session = await login(f);
  for (const body of [{}, { ...changed, new_password: 'short' }, { ...changed, new_password: changed.current_password },
    { ...changed, current_password: '' }, { ...changed, new_password: 'x'.repeat(129) }]) {
    assert.equal((await f.handler(request('password', { ...session, body }), f.env)).status, 400);
  }
  assert.equal(f.called('portal_acquire_web_session').length, 0);
});
