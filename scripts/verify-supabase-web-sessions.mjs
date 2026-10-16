import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply a local path to @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const sqlFile = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = sqlFile('20261016000700_web_sessions.sql');
const user = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const hash = (value) => createHash('sha256').update(value).digest('hex');
// These are envelope-shaped fixtures, not encryption tests or real credentials.
const box = `v1.${'N'.repeat(16)}.${'C'.repeat(100)}`;
const newBox = `v1.${'Z'.repeat(16)}.${'D'.repeat(140)}`;
const future = () => new Date(Date.now() + 3600000).toISOString();
const funcs = {
  portal_create_web_session: ['uuid', 'uuid', 'text', 'text', 'text', 'timestamptz', 'integer'],
  portal_acquire_web_session: ['text', 'text'],
  portal_save_web_session: ['text', 'text', 'bigint', 'text', 'timestamptz'],
  portal_release_web_session: ['text', 'text'],
  portal_revoke_web_session: ['text'],
};
let checks = 0;
async function verify(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
async function denied(promise, code = '42501') {
  await assert.rejects(promise, (error) => error.code === code);
}
async function asRole(role, statement, params = []) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    const result = await db.query(statement, params);
    await db.exec('COMMIT');
    return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const statement = (name) => `SELECT public.${name}(${funcs[name].map((type, i) => `$${i + 1}::${type}`).join(',')}) AS result`;
async function call(name, params, role = 'service_role') {
  return (await asRole(role, statement(name), params)).rows[0].result;
}
async function fixture(label, userId = user, lifetime = 28800) {
  const authId = randomUUID();
  await db.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1, $2)', [authId, userId]);
  const value = { userId, authId, token: hash(`cookie:${label}`), csrf: hash(`csrf:${label}`) };
  value.params = [userId, authId, value.token, value.csrf, box, future(), lifetime];
  return value;
}
const create = (f) => call('portal_create_web_session', f.params);
const acquire = (f, lease = hash('lease')) => call('portal_acquire_web_session', [f.token, lease]);
const save = (f, lease, version = 1) => call('portal_save_web_session', [f.token, lease, version, newBox, future()]);
const release = (f, lease) => call('portal_release_web_session', [f.token, lease]);
const revoke = (f) => call('portal_revoke_web_session', [f.token]);
const row = async (f) => (await db.query('SELECT * FROM portal_auth_private.web_sessions WHERE token_hash = $1', [f.token])).rows[0];
const sessionRows = async () => (await db.query('SELECT * FROM portal_auth_private.web_sessions ORDER BY id')).rows;
async function originalState() {
  const state = {};
  for (const table of ['public.app_users', 'public.app_roles', 'public.app_user_roles', 'public.app_permissions',
    'public.app_role_permissions', 'auth.users', 'auth.sessions', 'import_staging.employee_candidates', 'portal_auth_private.login_rate_windows']) {
    state[table] = (await db.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return state;
}

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
      encrypted_password text DEFAULT 'never-return-this-fixture-hash');
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id));
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
      ('${user}', 'fixture-admin@example.invalid', now()),
      ('${other}', 'fixture-other@example.invalid', now());
  `);
  for (const name of ['20261016000100_import_staging.sql', '20261016000200_app_user_links.sql',
    '20261016000300_app_role_foundation.sql', '20261016000400_app_permissions.sql',
    '20261016000500_account_access_functions.sql', '20261016000600_login_rate_limit.sql']) {
    await db.exec(sqlFile(name));
  }
  await db.query('INSERT INTO public.app_users (id, username) VALUES ($1, $2), ($3, $4)', [user, 'fixture_admin', other, 'fixture_other']);
  await db.exec(`
    INSERT INTO import_staging.employee_candidates (full_name, positions, source_name, source_cells)
    SELECT 'Fiktif ' || g, '[]'::jsonb, 'fixture', '[]'::jsonb FROM generate_series(1,157) AS g;
    ALTER DEFAULT PRIVILEGES IN SCHEMA portal_auth_private GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA portal_auth_private GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA portal_auth_private TO PUBLIC, anon, authenticated, service_role;
  `);
  const initialState = await originalState();

  await verify('RLS, private schema, function grants, and empty search paths resist permissive defaults', async () => {
    const summaries = await db.exec(migration);
    assert.deepEqual(await originalState(), initialState);
    const summary = summaries.at(-1).rows;
    assert.equal(summary.length, 6);
    assert.deepEqual(summary.find((r) => r.jenis === 'table'), {
      objek: 'web_sessions', jenis: 'table', rls_aktif: true,
      anon_boleh: false, authenticated_boleh: false, backend_boleh: false,
    });
    for (const r of summary.filter((r) => r.jenis === 'function')) {
      assert.equal(r.anon_boleh, false); assert.equal(r.authenticated_boleh, false); assert.equal(r.backend_boleh, true);
    }
    for (const [name, types] of Object.entries(funcs)) {
      const signature = `public.${name}(${types.join(',')})`;
      const definition = (await db.query('SELECT prosecdef, provolatile, proconfig FROM pg_proc WHERE oid = $1::regprocedure', [signature])).rows[0];
      assert.equal(definition.prosecdef, true); assert.equal(definition.provolatile, 'v');
      assert.deepEqual(definition.proconfig, ['search_path=""']);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await db.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS allowed", [role, signature])).rows[0].allowed, role === 'service_role');
      }
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await db.query("SELECT has_schema_privilege($1, 'portal_auth_private', 'USAGE') AS allowed", [role])).rows[0].allowed, false);
      assert.equal((await db.query("SELECT has_function_privilege($1, 'portal_auth_private.revoke_web_sessions_for_account_change()', 'EXECUTE') AS allowed", [role])).rows[0].allowed, false);
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await db.query("SELECT has_table_privilege($1, 'portal_auth_private.web_sessions', $2) AS allowed", [role, operation])).rows[0].allowed, false);
      }
      for (const query of ['SELECT * FROM portal_auth_private.web_sessions',
        'UPDATE portal_auth_private.web_sessions SET revoked_at = now()', 'DELETE FROM portal_auth_private.web_sessions',
        'TRUNCATE portal_auth_private.web_sessions', 'SELECT * FROM auth.sessions', 'SELECT encrypted_password FROM auth.users']) {
        await denied(asRole(role, query));
      }
    }
  });

  await verify('anonymous callers and authenticated users cannot call any session RPC', async () => {
    const params = {
      portal_create_web_session: [user, randomUUID(), hash('cookie'), hash('csrf'), box, future(), 28800],
      portal_acquire_web_session: [hash('cookie'), hash('lease')],
      portal_save_web_session: [hash('cookie'), hash('lease'), 1, box, future()],
      portal_release_web_session: [hash('cookie'), hash('lease')],
      portal_revoke_web_session: [hash('cookie')],
    };
    for (const role of ['anon', 'authenticated']) {
      await asRole(role, "SELECT set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)");
      for (const name of Object.keys(funcs)) await denied(call(name, params[name], role));
    }
    assert.deepEqual(await sessionRows(), []);
  });

  await verify('a session binds one active app account to its Auth session and has an absolute eight-hour lifetime', async () => {
    const f = await fixture('create');
    const created = await create(f);
    assert.deepEqual(Object.keys(created).sort(), ['expires_at', 'id']);
    const stored = await row(f);
    assert.equal(stored.user_id, user); assert.equal(stored.auth_session_id, f.authId);
    assert.equal(stored.account_version, 1); assert.equal(stored.token_hash, f.token); assert.equal(stored.csrf_hash, f.csrf);
    assert.equal(stored.token_box, box); assert.equal(stored.version, 1);
    assert.equal(stored.expires_at - stored.created_at, 8 * 3600000);
    assert.equal(await create(f), null);
    const duplicate = [...f.params]; duplicate[2] = hash('another-cookie-same-auth');
    assert.equal(await call('portal_create_web_session', duplicate), null);
    assert.equal((await row(f)).version, 1);
    assert.equal((await originalState())['public.app_users'][0].value.must_change_password, true);
  });

  await verify('invalid hashes, envelope formats, times, and lifetimes cannot create sessions', async () => {
    const f = await fixture('invalid');
    const variants = [[0, null], [1, null], [2, null], [2, 'raw-cookie'], [2, 'A'.repeat(64)],
      [3, null], [3, 'raw-csrf'], [4, null], [4, 'raw-access-token'], [4, 'v1.bad.bad'],
      [4, `v1.${'N'.repeat(16)}.${'C'.repeat(16001)}`], [4, box + '\n'],
      [5, null], [5, '2000-01-01T00:00:00Z'], [5, new Date(Date.now() + 90000000).toISOString()],
      [6, null], [6, 899], [6, 86401]];
    for (const [index, value] of variants) {
      const params = [...f.params]; params[index] = value;
      assert.equal(await call('portal_create_web_session', params), null);
    }
    assert.equal(await row(f), undefined);
    for (const seconds of [900, 86400]) {
      const valid = await fixture(`lifetime-${seconds}`, user, seconds);
      assert.ok(await create(valid));
      const stored = await row(valid); assert.equal(stored.expires_at - stored.created_at, seconds * 1000);
    }
  });

  await verify('unknown, mismatched, unconfirmed, inactive, or locked identities cannot obtain a session', async () => {
    const f = await fixture('identity');
    const mismatch = [...f.params]; mismatch[0] = other;
    assert.equal(await call('portal_create_web_session', mismatch), null);
    const missing = [...f.params]; missing[1] = randomUUID();
    assert.equal(await call('portal_create_web_session', missing), null);
    for (const status of ['INACTIVE', 'LOCKED']) {
      await db.query('UPDATE public.app_users SET status = $1 WHERE id = $2', [status, user]);
      assert.equal(await create(f), null);
    }
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [user]);
    await db.query('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1', [user]);
    assert.equal(await create(f), null);
    await db.query('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [user]);
  });

  await verify('leases serialize access and return only a busy status to competing requests', async () => {
    const f = await fixture('leases'); await create(f);
    const leaseA = hash('lease-A'); const leaseB = hash('lease-B');
    const result = await acquire(f, leaseA);
    assert.equal(result.status, 'acquired'); assert.equal(result.token_box, box);
    assert.equal(result.auth_session_id, f.authId); assert.equal(result.user_id, user);
    assert.equal(result.csrf_hash, f.csrf); assert.equal(result.version, 1);
    assert.equal('permissions' in result, false); assert.equal('must_change_password' in result, false);
    assert.deepEqual(await acquire(f, leaseB), { status: 'busy' });
    assert.equal(await release(f, leaseB), false);
    assert.equal(await release(f, leaseA), true);
    assert.equal((await acquire(f, leaseB)).status, 'acquired');
    assert.equal(await release(f, leaseA), false);
    assert.equal(await release(f, leaseB), true);
    assert.equal(await call('portal_acquire_web_session', [null, leaseA]), null);
    assert.equal(await call('portal_acquire_web_session', [f.token, 'raw-lease']), null);
    assert.equal(await call('portal_release_web_session', [f.token, null]), false);
  });

  await verify('a stale lease cannot overwrite or release a later request after recovery from a timeout', async () => {
    const f = await fixture('stale'); await create(f);
    const oldLease = hash('old-lease'); const newLease = hash('new-lease');
    await acquire(f, oldLease);
    const expires = (await row(f)).expires_at;
    await db.query("UPDATE portal_auth_private.web_sessions SET lease_until = now() - interval '1 second' WHERE token_hash = $1", [f.token]);
    assert.equal(await save(f, oldLease), false);
    assert.equal((await acquire(f, newLease)).status, 'acquired');
    assert.equal(await save(f, oldLease), false); assert.equal(await release(f, oldLease), false);
    assert.equal(await save(f, newLease, 2), false); assert.equal(await save(f, newLease, 1), true);
    const stored = await row(f);
    assert.equal(stored.token_box, newBox); assert.equal(stored.version, 2);
    assert.equal(stored.lease_hash, null); assert.equal(stored.expires_at.getTime(), expires.getTime());
    assert.equal(await save(f, newLease, 1), false);
  });

  await verify('invalid refresh output cannot replace the encrypted token envelope', async () => {
    const f = await fixture('bad-refresh'); await create(f);
    const lease = hash('bad-refresh-lease'); await acquire(f, lease);
    for (const [index, value] of [[0, null], [1, null], [2, null], [2, 0], [3, null], [3, 'raw-refresh-token'],
      [3, `v1.${'N'.repeat(16)}.${'C'.repeat(16001)}`], [4, null], [4, '2000-01-01T00:00:00Z'],
      [4, new Date(Date.now() + 90000000).toISOString()]]) {
      const params = [f.token, lease, 1, newBox, future()]; params[index] = value;
      assert.equal(await call('portal_save_web_session', params), false);
    }
    assert.equal((await row(f)).token_box, box);
    assert.equal((await row(f)).version, 1);
    assert.equal(await release(f, lease), true);
  });

  await verify('an expired access token can be refreshed while an expired portal session is denied', async () => {
    const f = await fixture('expiry'); await create(f);
    const lease = hash('expiry-lease');
    await db.query("UPDATE portal_auth_private.web_sessions SET access_expires_at = now() - interval '1 minute' WHERE token_hash = $1", [f.token]);
    assert.equal((await acquire(f, lease)).status, 'acquired');
    await db.query("UPDATE portal_auth_private.web_sessions SET created_at = now() - interval '9 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1", [f.token]);
    assert.equal(await save(f, lease), false); await release(f, lease);
    assert.equal(await acquire(f, lease), null);
    assert.equal(await revoke(f), true);
  });

  await verify('logout revokes a leased session, erases ciphertext, and prevents stale token writes', async () => {
    const f = await fixture('logout'); await create(f);
    const lease = hash('logout-lease'); await acquire(f, lease);
    assert.equal(await revoke(f), true);
    const stored = await row(f);
    assert.ok(stored.revoked_at); assert.equal(stored.token_box, null); assert.equal(stored.lease_hash, null);
    assert.equal(await acquire(f, lease), null); assert.equal(await save(f, lease), false);
    assert.equal(await release(f, lease), false); assert.equal(await revoke(f), false);
    assert.equal(await call('portal_revoke_web_session', ['raw-cookie']), false);
    assert.equal(await call('portal_revoke_web_session', [null]), false);
    // The RPC only revokes the portal session; Auth signout belongs to the backend.
    assert.equal((await db.query('SELECT count(*)::int AS count FROM auth.sessions WHERE id = $1', [f.authId])).rows[0].count, 1);
  });

  await verify('removing an Auth session prevents both new acquisition and refresh saves', async () => {
    const f = await fixture('auth-signout'); await create(f);
    const lease = hash('auth-signout-lease'); await acquire(f, lease);
    await db.query('DELETE FROM auth.sessions WHERE id = $1', [f.authId]);
    assert.equal(await save(f, lease), false); await release(f, lease);
    assert.equal(await acquire(f, lease), null);
  });

  await verify('account status changes revoke only that account and reactivation cannot revive old sessions', async () => {
    const f = await fixture('inactive'); const unaffected = await fixture('unaffected', other);
    await create(f); await create(unaffected);
    await db.query("UPDATE public.app_users SET status = 'INACTIVE' WHERE id = $1", [user]);
    assert.ok((await row(f)).revoked_at); assert.equal((await row(f)).token_box, null);
    assert.equal((await row(unaffected)).revoked_at, null);
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [user]);
    assert.equal(await acquire(f), null); assert.equal((await acquire(unaffected)).status, 'acquired');
    await release(unaffected, hash('lease'));
    const locked = await fixture('locked'); await create(locked);
    await db.query("UPDATE public.app_users SET status = 'LOCKED' WHERE id = $1", [user]);
    assert.equal(await acquire(locked), null);
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [user]);
  });

  await verify('password-flag and account-version changes revoke all existing sessions without clearing flags themselves', async () => {
    const f = await fixture('flag'); const second = await fixture('flag-second');
    await create(f); await create(second);
    await db.query('UPDATE public.app_users SET must_change_password = false WHERE id = $1', [user]);
    for (const value of [f, second]) assert.equal(await acquire(value), null);
    await db.query('UPDATE public.app_users SET must_change_password = true WHERE id = $1', [user]);
    const versioned = await fixture('versioned'); await create(versioned);
    const lease = hash('versioned-lease'); await acquire(versioned, lease);
    await db.query('UPDATE public.app_users SET row_version = row_version + 1 WHERE id = $1', [user]);
    assert.equal(await save(versioned, lease), false); assert.equal(await acquire(versioned), null);
    await db.query('UPDATE public.app_users SET row_version = 1 WHERE id = $1', [user]);
    const noChange = await fixture('no-change'); await create(noChange);
    await db.query('UPDATE public.app_users SET status = status, row_version = row_version WHERE id = $1', [user]);
    assert.equal((await row(noChange)).revoked_at, null);
  });

  await verify('database constraints reject malformed direct writes and rollback preserves session state', async () => {
    const f = await fixture('constraints'); await create(f);
    for (const query of ["UPDATE portal_auth_private.web_sessions SET token_hash = 'raw-cookie' WHERE token_hash = $1",
      "UPDATE portal_auth_private.web_sessions SET csrf_hash = 'raw-csrf' WHERE token_hash = $1",
      "UPDATE portal_auth_private.web_sessions SET token_box = 'raw-token' WHERE token_hash = $1",
      "UPDATE portal_auth_private.web_sessions SET lease_hash = 'raw-lease' WHERE token_hash = $1",
      'UPDATE portal_auth_private.web_sessions SET revoked_at = now() WHERE token_hash = $1',
      "UPDATE portal_auth_private.web_sessions SET expires_at = created_at + interval '25 hours' WHERE token_hash = $1"]) {
      await denied(db.query(query, [f.token]), '23514');
    }
    const before = await sessionRows();
    await db.exec('BEGIN; SET LOCAL ROLE service_role;');
    await db.query(statement('portal_revoke_web_session'), [f.token]);
    await db.exec('ROLLBACK');
    assert.deepEqual(await sessionRows(), before);
  });

  await verify('reapplication repairs grants and preserves sessions, accounts, roles, permissions, staging, and counters', async () => {
    const before = await sessionRows();
    const stateBefore = await originalState();
    for (const [name, types] of Object.entries(funcs)) {
      await db.exec(`GRANT EXECUTE ON FUNCTION public.${name}(${types.join(',')}) TO PUBLIC, anon, authenticated;`);
    }
    await db.exec('GRANT SELECT ON portal_auth_private.web_sessions TO PUBLIC, anon, authenticated, service_role;');
    await db.exec(migration);
    assert.deepEqual(await sessionRows(), before);
    assert.deepEqual(await originalState(), stateBefore);
    // Timestamps altered by explicit test fixtures are compared separately.
    const finalState = await originalState();
    for (const table of Object.keys(initialState).filter((t) => !['auth.users', 'auth.sessions'].includes(t))) {
      assert.deepEqual(finalState[table], initialState[table]);
    }
    assert.deepEqual(finalState['auth.users'].map((r) => r.value.encrypted_password), initialState['auth.users'].map((r) => r.value.encrypted_password));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await denied(asRole(role, 'SELECT * FROM portal_auth_private.web_sessions'));
      assert.equal((await db.query("SELECT has_table_privilege($1, 'portal_auth_private.web_sessions', 'SELECT') AS allowed", [role])).rows[0].allowed, false);
    }
    const trigger = await db.query("SELECT count(*)::int AS count FROM pg_trigger WHERE tgrelid = 'public.app_users'::regclass AND tgname = 'app_users_revoke_web_sessions'");
    assert.equal(trigger.rows[0].count, 1);
    await denied(call('portal_acquire_web_session', [hash('cookie'), hash('lease')], 'authenticated'));
  });

  console.log(`${checks} PostgreSQL web-session checks passed in memory. No real data was accessed.`);
} finally { await db.close(); }
