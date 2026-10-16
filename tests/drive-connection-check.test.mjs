import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Script, createContext } from 'node:vm';

const source = readFileSync(new URL('../supabase/functions/drive-connection-check/index.ts', import.meta.url), 'utf8');
const runnable = stripTypeScriptTypes(source
  .replace(/^import \{ withSupabase \} from "npm:@supabase\/server@1";\r?\n/, '')
  .replace('export default {', 'globalThis.deployedFunction = {'));
const sampleSecrets = {
  GOOGLE_DRIVE_CLIENT_ID: 'test-client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_DRIVE_REFRESH_TOKEN: 'test-refresh-token',
  GOOGLE_DRIVE_FOLDER_ID: 'test-folder-id',
};
const activeFolder = {
  mimeType: 'application/vnd.google-apps.folder',
  trashed: false,
  capabilities: { canAddChildren: true },
};

// Run the exact single-file dashboard source. Only its SDK boundary is stubbed;
// hosted SDK authentication is checked separately after deployment.
function fixture({ env = {}, responses = [], networkError } = {}) {
  const requests = [];
  let authOptions;
  const context = createContext({
    Request, Response, URL, URLSearchParams, AbortSignal, Error,
    Deno: { env: { get: (name) => ({ ...sampleSecrets, ...env })[name] } },
    withSupabase(options, handler) { authOptions = options; return handler; },
    async fetch(url, options) {
      requests.push({ url: String(url), ...options });
      if (networkError) throw networkError;
      assert.ok(responses.length, 'No unexpected Google request is allowed');
      return responses.shift();
    },
  });
  new Script(runnable).runInContext(context);
  return {
    requests,
    get authOptions() { return authOptions; },
    invoke(method = 'POST', body = '{}') {
      return context.deployedFunction.fetch(new Request('https://test.invalid/drive-connection-check', {
        method, ...(method === 'POST' ? { body } : {}),
      }));
    },
  };
}

async function assertNoSecrets(response) {
  const text = await response.text();
  for (const secret of [...Object.values(sampleSecrets), 'test-access-token', 'upstream-private-detail']) {
    assert.ok(!text.includes(secret), `Response exposed ${secret}`);
  }
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return JSON.parse(text);
}

test('checks only the configured folder and requires the secret auth mode', async () => {
  const f = fixture({ responses: [
    Response.json({ access_token: 'test-access-token', refresh_token: 'never-return-this' }),
    Response.json(activeFolder),
  ] });
  assert.equal(f.authOptions.auth, 'secret');
  const result = await f.invoke('POST', JSON.stringify({ folderId: 'untrusted-folder' }));
  assert.equal(result.status, 200);
  assert.deepEqual(await assertNoSecrets(result), {
    ok: true, checks: { token_refresh: true, folder_access: true, can_add_files: true },
  });
  assert.equal(f.requests.length, 2);
  const [token, folder] = f.requests;
  assert.equal(token.url, 'https://oauth2.googleapis.com/token');
  assert.equal(token.method, 'POST');
  assert.equal(token.body.get('grant_type'), 'refresh_token');
  assert.equal(token.body.get('client_secret'), sampleSecrets.GOOGLE_DRIVE_CLIENT_SECRET);
  assert.equal(token.body.get('refresh_token'), sampleSecrets.GOOGLE_DRIVE_REFRESH_TOKEN);
  assert.equal(folder.method, 'GET');
  const url = new URL(folder.url);
  assert.equal(url.pathname, '/drive/v3/files/test-folder-id');
  assert.equal(url.searchParams.get('fields'), 'mimeType,trashed,capabilities(canAddChildren)');
  assert.equal(folder.headers.Authorization, 'Bearer test-access-token');
  for (const request of f.requests) {
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
  }
});

test('unsupported methods and missing secrets make no Google requests', async () => {
  const f = fixture();
  const wrongMethod = await f.invoke('GET');
  assert.equal(wrongMethod.status, 405);
  assert.equal((await assertNoSecrets(wrongMethod)).error, 'METHOD_NOT_ALLOWED');
  const incomplete = fixture({ env: { GOOGLE_DRIVE_REFRESH_TOKEN: '   ' } });
  const missing = await incomplete.invoke();
  assert.equal(missing.status, 500);
  assert.deepEqual(await assertNoSecrets(missing), {
    ok: false, error: 'MISSING_SECRETS', missing: ['GOOGLE_DRIVE_REFRESH_TOKEN'],
  });
  assert.equal(f.requests.length + incomplete.requests.length, 0);
});

test('Google token errors do not expose the upstream body or continue to Drive', async () => {
  const f = fixture({ responses: [Response.json({ error_description: 'upstream-private-detail' }, { status: 400 })] });
  const result = await f.invoke();
  assert.equal(result.status, 502);
  assert.deepEqual(await assertNoSecrets(result), {
    ok: false, stage: 'token', error: 'GOOGLE_TOKEN_REFRESH_FAILED', upstream_status: 400,
  });
  assert.equal(f.requests.length, 1);
});

test('missing, empty, or malformed token responses never reach Drive', async () => {
  for (const response of [Response.json({}), Response.json({ access_token: ' ' }), new Response('invalid-json')]) {
    const f = fixture({ responses: [response] });
    const result = await f.invoke();
    assert.equal(result.status, 502);
    assert.equal((await assertNoSecrets(result)).stage, 'token');
    assert.equal(f.requests.length, 1);
  }
});

test('a folder outside the granted scope returns a safe folder-stage error', async () => {
  const f = fixture({ responses: [
    Response.json({ access_token: 'test-access-token' }),
    Response.json({ error: { message: 'upstream-private-detail' } }, { status: 404 }),
  ] });
  const result = await f.invoke();
  assert.equal(result.status, 502);
  assert.deepEqual(await assertNoSecrets(result), {
    ok: false, stage: 'folder', error: 'FOLDER_ACCESS_FAILED', upstream_status: 404,
  });
});

test('non-folders, trashed folders, and missing write capability cannot pass', async () => {
  for (const [metadata, error] of [
    [{ ...activeFolder, mimeType: 'image/jpeg' }, 'NOT_A_FOLDER'],
    [{ ...activeFolder, trashed: true }, 'FOLDER_NOT_ACTIVE'],
    [{ ...activeFolder, trashed: undefined }, 'FOLDER_NOT_ACTIVE'],
    [{ ...activeFolder, capabilities: { canAddChildren: false } }, 'CANNOT_ADD_FILES'],
    [{ ...activeFolder, capabilities: undefined }, 'CANNOT_ADD_FILES'],
  ]) {
    const f = fixture({ responses: [Response.json({ access_token: 'test-access-token' }), Response.json(metadata)] });
    const result = await f.invoke();
    assert.equal(result.status, 409);
    assert.equal((await assertNoSecrets(result)).error, error);
  }
});

test('network errors and timeouts never include exception details', async () => {
  for (const [name, status, code] of [
    ['Error', 502, 'GOOGLE_REQUEST_FAILED'],
    ['TimeoutError', 504, 'GOOGLE_REQUEST_TIMEOUT'],
  ]) {
    const error = new Error('upstream-private-detail test-refresh-token');
    error.name = name;
    const f = fixture({ networkError: error });
    const result = await f.invoke();
    assert.equal(result.status, status);
    assert.equal((await assertNoSecrets(result)).error, code);
  }
});
