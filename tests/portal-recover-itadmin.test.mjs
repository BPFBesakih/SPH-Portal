import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Script, createContext } from 'node:vm';

const source = readFileSync(new URL('../supabase/functions/portal-recover-itadmin/index.ts', import.meta.url), 'utf8');
const runnable = stripTypeScriptTypes(source
  .replace(/^import \{ withSupabase \} from "npm:@supabase\/server@1";\r?\n/, '')
  .replace('export default {', 'globalThis.deployedFunction = {'));
const userId = '10000000-0000-4000-8000-000000000001';
const roleId = '20000000-0000-4000-8000-000000000001';
const assignmentId = '30000000-0000-4000-8000-000000000001';
const password = 'fixture-recovery-password';
const identity = { auth_user_id: userId, login_email: 'bpfbesakih@gmail.com' };
const defaultEnv = {
  SUPABASE_URL: 'https://fixture-project.supabase.co',
  SUPABASE_SECRET_KEYS: '{"default":"fixture-service-key"}',
};
const response = (body, status = 200) => Response.json(body, { status });
const prerequisites = () => [response([identity]), response([{ id: roleId }]), response([{ id: assignmentId }])];

// The real dashboard source runs here. SDK key checking is a hosted test;
// this stub records the configured mode and supplies no authentication claim.
function fixture({ env = {}, responses = [], networkError = false } = {}) {
  const requests = []; const logs = []; let authOptions;
  const context = createContext({
    Request, Response, URL, AbortSignal, Error, TextDecoder,
    console: { log: (...args) => logs.push(args), info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    Deno: { env: { get: (name) => ({ ...defaultEnv, ...env })[name] } },
    withSupabase(options, handler) { authOptions = options; return handler; },
    async fetch(url, options) {
      requests.push({ url: String(url), ...options });
      if (networkError) throw new Error(`upstream-private-detail ${password}`);
      assert.ok(responses.length, 'No unexpected request is allowed');
      return responses.shift();
    },
  });
  new Script(runnable).runInContext(context);
  return { requests, logs,
    get authOptions() { return authOptions; },
    invoke(body = { new_password: password }, { method = 'POST', type = 'application/json' } = {}) {
      return context.deployedFunction.fetch(new Request('https://function.invalid/portal-recover-itadmin', {
        method, headers: { 'content-type': type },
        ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      }));
    },
  };
}

async function safeBody(result) {
  const text = await result.text();
  for (const privateValue of [password, 'fixture-service-key', 'upstream-private-detail', 'never-return-this-hash', 'bpfbesakih@gmail.com']) {
    assert.ok(!text.includes(privateValue), `Response exposed ${privateValue}`);
  }
  assert.equal(result.headers.get('cache-control'), 'no-store');
  return JSON.parse(text);
}

test('recovery is configured for secret auth and changes only the intended Auth password after checking its role', async () => {
  const f = fixture({ responses: [...prerequisites(), response({ id: userId, encrypted_password: 'never-return-this-hash' })] });
  const result = await f.invoke({ new_password: password, user_id: 'untrusted-id', username: 'other', status: 'INACTIVE', role: 'OTHER' });
  assert.equal(f.authOptions.auth, 'secret');
  assert.equal(result.status, 200);
  assert.deepEqual(await safeBody(result), { ok: true, username: 'itadmin', password_reset: true });
  assert.equal(f.requests.length, 4);
  assert.deepEqual(JSON.parse(f.requests[0].body), { p_username: 'itadmin' });
  const roles = new URL(f.requests[1].url);
  assert.equal(roles.searchParams.get('code'), 'eq.SUPER_ADMIN');
  assert.equal(roles.searchParams.get('is_active'), 'eq.true');
  assert.equal(roles.searchParams.get('is_system'), 'eq.true');
  const assignment = new URL(f.requests[2].url);
  assert.equal(assignment.searchParams.get('user_id'), `eq.${userId}`);
  assert.equal(assignment.searchParams.get('role_id'), `eq.${roleId}`);
  assert.equal(assignment.searchParams.get('scope_kind'), 'eq.ALL');
  assert.equal(f.requests[3].url, `${defaultEnv.SUPABASE_URL}/auth/v1/admin/users/${userId}`);
  assert.equal(f.requests[3].method, 'PUT');
  assert.deepEqual(JSON.parse(f.requests[3].body), { password });
  for (const request of f.requests) {
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.headers.apikey, 'fixture-service-key');
  }
  assert.deepEqual(f.logs, []);
});

test('malformed and oversized requests or insufficient passwords never reach the backend', async () => {
  for (const [body, options] of [
    [{ new_password: password }, { method: 'GET' }], ['invalid-json'], ['null'], ['[]'], [{}],
    [{ new_password: 'short' }], [{ new_password: 'x'.repeat(129) }], [{ new_password: ' '.repeat(12) }],
    ['{"padding":"' + 'x'.repeat(3000) + '"}'], [{ new_password: password }, { type: 'text/plain' }],
  ]) {
    const f = fixture(); const result = await f.invoke(body, options);
    assert.ok([400, 405].includes(result.status)); await safeBody(result);
    assert.equal(f.requests.length, 0);
  }
});

test('missing, wrong, malformed, or ambiguous account identities cannot be reset', async () => {
  for (const identities of [[], null, [identity, identity], [{ ...identity, login_email: 'other@example.invalid' }], [{ ...identity, auth_user_id: 'bad-id' }]]) {
    const f = fixture({ responses: [response(identities)] });
    const result = await f.invoke(); assert.equal(result.status, 409); await safeBody(result);
    assert.equal(f.requests.length, 1);
  }
});

test('missing or ambiguous active system role or ALL assignment prevents the Auth update', async () => {
  for (const invalid of [[], null, [{ id: 'invalid' }], [{ id: roleId }, { id: roleId }]]) {
    const f = fixture({ responses: [response([identity]), response(invalid)] });
    assert.equal((await f.invoke()).status, 409); assert.equal(f.requests.length, 2);
  }
  const f = fixture({ responses: [response([identity]), response([{ id: roleId }]), response([])] });
  const result = await f.invoke(); assert.equal(result.status, 409); await safeBody(result);
  assert.equal(f.requests.length, 3);
});

test('configuration and upstream errors remain generic and do not leak passwords or raw responses', async () => {
  for (const env of [{ SUPABASE_URL: 'https://untrusted.invalid' }, { SUPABASE_SECRET_KEYS: '{}' }, { SUPABASE_SECRET_KEYS: 'invalid-json' }]) {
    const f = fixture({ env }); const result = await f.invoke();
    assert.equal(result.status, 503); await safeBody(result); assert.equal(f.requests.length, 0);
  }
  const f = fixture({ networkError: true }); const result = await f.invoke();
  assert.equal(result.status, 503); await safeBody(result); assert.deepEqual(f.logs, []);
  const failedLookup = fixture({ responses: [response({ message: `upstream-private-detail ${password}` }, 500)] });
  const failedResult = await failedLookup.invoke(); assert.equal(failedResult.status, 503); await safeBody(failedResult);
});

test('Auth password rejection is surfaced without echoing the candidate password', async () => {
  for (const upstreamStatus of [400, 422, 500]) {
    const f = fixture({ responses: [...prerequisites(), response({ message: `upstream-private-detail ${password}` }, upstreamStatus)] });
    const result = await f.invoke(); assert.equal(result.status, upstreamStatus === 500 ? 503 : 400);
    assert.equal((await safeBody(result)).error, upstreamStatus === 500 ? 'RECOVERY_UNAVAILABLE' : 'PASSWORD_REJECTED');
  }
});

test('legacy admin keys use their bearer header and still leave account links and flags out of the update payload', async () => {
  const f = fixture({ env: { SUPABASE_SECRET_KEYS: '', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.fixture-service-key' },
    responses: [...prerequisites(), response({ id: userId })] });
  const result = await f.invoke(); assert.equal(result.status, 200); await safeBody(result);
  assert.equal(f.requests.at(-1).headers.Authorization, 'Bearer eyJ.fixture-service-key');
  assert.deepEqual(Object.keys(JSON.parse(f.requests.at(-1).body)), ['password']);
});
