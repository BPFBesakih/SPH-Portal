import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Script, createContext } from 'node:vm';

const source = readFileSync(new URL('../supabase/functions/portal-login/index.ts', import.meta.url), 'utf8');
const runnable = stripTypeScriptTypes(source
  .replace(/^import \{ withSupabase \} from "npm:@supabase\/server@1";\r?\n/, '')
  .replace('export default {', 'globalThis.deployedFunction = {'));
const envDefaults = {
  SUPABASE_URL: 'https://fixture-project.supabase.co',
  SUPABASE_SECRET_KEYS: '{"default":"fixture-service-key"}',
  SUPABASE_PUBLISHABLE_KEYS: '{"default":"fixture-public-key"}',
};
const userId = '10000000-0000-4000-8000-000000000001';
const credentials = { username: '  ITAdmin  ', password: 'fixture-password-for-tests' };
const identity = { auth_user_id: userId, login_email: 'fixture-manager@example.invalid' };
const session = {
  access_token: 'fixture.access.token', refresh_token: 'fixture-refresh-token',
  expires_in: 3600, token_type: 'bearer', user: { id: userId, email: identity.login_email },
};
const account = {
  user: { id: userId, username: 'itadmin', status: 'ACTIVE', must_change_password: true, row_version: 1,
    email: identity.login_email, private_detail: 'upstream-private-detail' },
  role_assignments: [{
    assignment_id: '20000000-0000-4000-8000-000000000001',
    role_id: '30000000-0000-4000-8000-000000000001',
    role: 'SUPER_ADMIN', scope_kind: 'ALL',
    permissions: ['admin.users.read', 'admin.users.manage'],
    private_detail: 'upstream-private-detail',
  }],
};
const response = (value, status = 200) => Response.json(value, { status });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const successResponses = () => [response(true), response([identity]), response(session), response(account)];

// Execute the actual dashboard source with fake HTTP/env. The SDK boundary is
// stubbed; this validates its configured auth mode, not hosted SDK key checking.
function fixture({ env = {}, responses = [], networkErrorAt = -1 } = {}) {
  const requests = [];
  const logs = [];
  let authOptions;
  const context = createContext({
    Request, Response, URL, AbortSignal, Error, TextEncoder, TextDecoder,
    crypto: webcrypto, console: { log: (...args) => logs.push(args), info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    Deno: { env: { get: (name) => ({ ...envDefaults, ...env })[name] } },
    withSupabase(options, handler) { authOptions = options; return handler; },
    async fetch(url, options) {
      requests.push({ url: String(url), ...options });
      if (requests.length - 1 === networkErrorAt) throw new Error('upstream-private-detail');
      assert.ok(responses.length, 'No unexpected upstream request is allowed');
      return responses.shift();
    },
  });
  new Script(runnable).runInContext(context);
  return {
    requests, logs,
    get authOptions() { return authOptions; },
    invoke(body = credentials, { method = 'POST', type = 'application/json' } = {}) {
      return context.deployedFunction.fetch(new Request('https://function.invalid/portal-login', {
        method, headers: { 'content-type': type },
        ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }));
    },
  };
}

async function safeBody(result, { allowSession = false } = {}) {
  const text = await result.text();
  for (const value of [...Object.values(envDefaults), 'fixture-service-key', 'fixture-public-key',
    credentials.password, identity.login_email, 'upstream-private-detail']) assert.ok(!text.includes(value), `Response exposed ${value}`);
  if (!allowSession) {
    assert.ok(!text.includes(session.access_token));
    assert.ok(!text.includes(session.refresh_token));
  }
  assert.equal(result.headers.get('cache-control'), 'no-store');
  return JSON.parse(text);
}

test('probe uses only the configured backend and user RPCs, then signs out its own temporary session', async () => {
  const f = fixture({ responses: [...successResponses(), new Response(null, { status: 204 })] });
  const result = await f.invoke({ ...credentials, backend_url: 'https://untrusted.invalid', folder_id: 'ignored' });
  assert.equal(result.status, 200);
  assert.deepEqual(await safeBody(result), {
    ok: true, checks: { password_sign_in: true, account_context: true, temporary_session_signout: true },
    account: { username: 'itadmin', must_change_password: true, role_count: 1, permission_count: 2 },
  });
  assert.equal(f.authOptions.auth, 'secret');
  assert.deepEqual(f.requests.map((request) => new URL(request.url).pathname), [
    '/rest/v1/rpc/portal_take_login_slot', '/rest/v1/rpc/portal_resolve_login', '/auth/v1/token',
    '/rest/v1/rpc/portal_current_account', '/auth/v1/logout',
  ]);
  assert.deepEqual(JSON.parse(f.requests[0].body), { p_username_hash: hash('username\0itadmin'), p_ip_hash: hash('ip\0operator-probe') });
  assert.deepEqual(JSON.parse(f.requests[1].body), { p_username: 'itadmin' });
  assert.deepEqual(JSON.parse(f.requests[2].body), { email: identity.login_email, password: credentials.password });
  assert.equal(f.requests[3].headers.apikey, 'fixture-public-key');
  assert.equal(f.requests[3].headers.Authorization, `Bearer ${session.access_token}`);
  assert.equal(new URL(f.requests[4].url).searchParams.get('scope'), 'local');
  for (const request of f.requests) {
    assert.equal(new URL(request.url).origin, envDefaults.SUPABASE_URL);
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
  }
  assert.deepEqual(f.logs, []);
});

test('explicit backend login returns its session and keeps scope and password flag intact', async () => {
  const f = fixture({ responses: successResponses() });
  const result = await f.invoke({ ...credentials, action: 'login', client_ip: '192.0.2.10' });
  assert.equal(result.status, 200);
  const data = await safeBody(result, { allowSession: true });
  assert.equal(data.session.access_token, session.access_token);
  assert.equal(data.session.refresh_token, session.refresh_token);
  assert.equal(data.account.user.must_change_password, true);
  assert.equal(data.account.role_assignments[0].scope_kind, 'ALL');
  assert.equal(data.account.user.email, undefined);
  assert.equal(f.requests.length, 4);
  assert.deepEqual(JSON.parse(f.requests[0].body), { p_username_hash: hash('username\0itadmin'), p_ip_hash: hash('ip\u0000192.0.2.10') });
});

test('malformed, oversized, unsupported, and incomplete requests do not reach Auth or consume slots', async () => {
  for (const [body, options] of [
    [credentials, { method: 'GET' }], ['invalid-json'], ['null'], ['[]'], [{ ...credentials, action: 'unknown' }],
    [{ ...credentials, action: 'login' }], [{ ...credentials, username: '' }],
    [{ ...credentials, password: 'x'.repeat(129) }], ['{"padding":"' + 'x'.repeat(5000) + '"}'],
    [credentials, { type: 'text/plain' }],
  ]) {
    const f = fixture(); const result = await f.invoke(body, options);
    assert.ok([400, 405].includes(result.status));
    await safeBody(result);
    assert.equal(f.requests.length, 0);
  }
});

test('invalid URL or missing API configuration fails closed without network requests', async () => {
  for (const env of [
    { SUPABASE_URL: 'https://untrusted.invalid' }, { SUPABASE_URL: 'http://fixture-project.supabase.co' },
    { SUPABASE_URL: 'https://fixture-project.supabase.co/other' },
    { SUPABASE_SECRET_KEYS: 'invalid-json' }, { SUPABASE_SECRET_KEYS: '{}' },
    { SUPABASE_PUBLISHABLE_KEYS: '{}' },
  ]) {
    const f = fixture({ env }); const result = await f.invoke();
    assert.equal(result.status, 503); await safeBody(result); assert.equal(f.requests.length, 0);
  }
});

test('an exhausted or unavailable limiter prevents username resolution and password authentication', async () => {
  for (const [first, expectedStatus] of [[response(false), 429], [response({}), 503], [response({}, 500), 503]]) {
    const f = fixture({ responses: [first] }); const result = await f.invoke();
    assert.equal(result.status, expectedStatus);
    if (expectedStatus === 429) assert.equal(result.headers.get('retry-after'), '900');
    await safeBody(result); assert.equal(f.requests.length, 1);
  }
});

test('unknown usernames and wrong passwords share a generic response and both reach password Auth', async () => {
  const outcomes = [];
  for (const identities of [[], [identity]]) {
    const f = fixture({ responses: [response(true), response(identities), response({ message: 'upstream-private-detail' }, 400)] });
    const result = await f.invoke(); assert.equal(result.status, 401);
    outcomes.push(await safeBody(result)); assert.equal(f.requests.length, 3);
    const authBody = JSON.parse(f.requests[2].body);
    assert.equal(authBody.email, identities.length ? identity.login_email : 'unavailable-account@portal.invalid');
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test('unavailable resolution or malformed identity never reaches password Auth', async () => {
  for (const value of [null, {}, [identity, identity], [{ ...identity, auth_user_id: 'invalid' }]]) {
    const f = fixture({ responses: [response(true), response(value)] });
    const result = await f.invoke(); assert.equal(result.status, 503);
    await safeBody(result); assert.equal(f.requests.length, 2);
  }
});

test('a mismatched or disappearing account cannot obtain a session and triggers local signout', async () => {
  for (const [signedSession, profile, expectedCalls] of [
    [{ ...session, user: { id: '10000000-0000-4000-8000-000000000002' } }, undefined, 4],
    [session, null, 5],
    [session, { ...account, user: { ...account.user, status: 'INACTIVE' } }, 5],
  ]) {
    const f = fixture({ responses: [response(true), response([identity]), response(signedSession),
      ...(profile === undefined ? [] : [response(profile)]), new Response(null, { status: 204 })] });
    const result = await f.invoke({ ...credentials, action: 'login', client_ip: '192.0.2.10' });
    assert.ok([401, 503].includes(result.status)); await safeBody(result);
    assert.equal(f.requests.length, expectedCalls);
    assert.equal(new URL(f.requests.at(-1).url).pathname, '/auth/v1/logout');
  }
});

test('invalid profile scopes or missing password flags fail closed and sign out', async () => {
  for (const badAccount of [
    { ...account, user: { ...account.user, must_change_password: undefined } },
    { ...account, role_assignments: [{ ...account.role_assignments[0], scope_kind: 'ANY' }] },
    { ...account, role_assignments: [{ ...account.role_assignments[0], permissions: ['*'] }] },
  ]) {
    const f = fixture({ responses: [response(true), response([identity]), response(session), response(badAccount), new Response(null, { status: 204 })] });
    const result = await f.invoke(); assert.equal(result.status, 503); await safeBody(result);
    assert.equal(f.requests.length, 5);
  }
});

test('probe signout failure is not reported as successful authentication verification', async () => {
  const f = fixture({ responses: [...successResponses(), response({ message: 'upstream-private-detail' }, 500)] });
  const result = await f.invoke(); assert.equal(result.status, 503);
  assert.equal((await safeBody(result)).ok, false); assert.equal(f.requests.length, 5);
});

test('network failures remain generic and a profile failure still attempts signout', async () => {
  for (const index of [0, 3]) {
    const responses = index === 0 ? [] : [response(true), response([identity]), response(session), new Response(null, { status: 204 })];
    const f = fixture({ responses, networkErrorAt: index }); const result = await f.invoke();
    assert.equal(result.status, 503); await safeBody(result); assert.deepEqual(f.logs, []);
    assert.equal(f.requests.length, index === 0 ? 1 : 5);
  }
});

test('legacy environment keys retain bearer headers for privileged RPCs without leaking key values', async () => {
  const f = fixture({ env: {
    SUPABASE_SECRET_KEYS: '', SUPABASE_PUBLISHABLE_KEYS: '',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJ.fixture-service-key', SUPABASE_ANON_KEY: 'eyJ.fixture-public-key',
  }, responses: [...successResponses(), new Response(null, { status: 204 })] });
  const result = await f.invoke(); assert.equal(result.status, 200); await safeBody(result);
  assert.equal(f.requests[0].headers.Authorization, 'Bearer eyJ.fixture-service-key');
  assert.equal(f.requests[3].headers.Authorization, `Bearer ${session.access_token}`);
});
