import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply a local path to @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const sql = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const migration = sql('20261016000800_password_change_completion.sql');
const user = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const hash = (s) => createHash('sha256').update(s).digest('hex');
const box = `v1.${'N'.repeat(16)}.${'C'.repeat(100)}`;
const statement = 'SELECT public.portal_complete_password_change($1, $2, $3::bigint) AS result';
let checks = 0;
async function verify(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
async function asRole(query, params = [], role = 'service_role', rollback = false) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    const result = await db.query(query, params);
    await db.exec(rollback ? 'ROLLBACK' : 'COMMIT'); return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const account = async (id = user) => (await db.query('SELECT * FROM public.app_users WHERE id = $1', [id])).rows[0];
const events = async () => (await db.query('SELECT * FROM portal_auth_private.password_change_events ORDER BY changed_at, id')).rows;
const sessions = async () => (await db.query('SELECT * FROM portal_auth_private.web_sessions ORDER BY id')).rows;
const auth = async () => (await db.query('SELECT * FROM auth.users ORDER BY id')).rows;
const complete = async (f, version = f.version) => (await asRole(statement, [f.token, f.lease, version])).rows[0].result;
async function fixture(label, id = user) {
  const f = { id, token: hash(`cookie:${label}`), lease: hash(`lease:${label}`), authId: randomUUID(), version: (await account(id)).row_version };
  await db.query('INSERT INTO auth.sessions (id, user_id) VALUES ($1, $2)', [f.authId, id]);
  await asRole('SELECT public.portal_create_web_session($1, $2, $3, $4, $5, $6::timestamptz)',
    [id, f.authId, f.token, hash(`csrf:${label}`), box, new Date(Date.now() + 3600000).toISOString()]);
  await asRole('SELECT public.portal_acquire_web_session($1, $2)', [f.token, f.lease]);
  return f;
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
      ('${user}', 'fixture-admin@example.invalid', now()), ('${other}', 'fixture-other@example.invalid', now());
  `);
  for (const file of ['20261016000100_import_staging.sql', '20261016000200_app_user_links.sql',
    '20261016000300_app_role_foundation.sql', '20261016000400_app_permissions.sql',
    '20261016000500_account_access_functions.sql', '20261016000600_login_rate_limit.sql', '20261016000700_web_sessions.sql']) await db.exec(sql(file));
  await db.query('INSERT INTO public.app_users (id, username) VALUES ($1,$2),($3,$4)', [user, 'fixture_admin', other, 'fixture_other']);
  await db.exec(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA portal_auth_private GRANT ALL ON TABLES TO anon, authenticated, service_role;
    INSERT INTO import_staging.employee_candidates (full_name, positions, source_name, source_cells)
    SELECT 'Fiktif ' || g, '[]'::jsonb, 'fixture', '[]'::jsonb FROM generate_series(1,157) AS g;
  `);
  const originalAuth = await auth(); const originalAccount = await account();

  await verify('migration exposes only one backend RPC and a private RLS event table without changing existing account state', async () => {
    const results = await db.exec(migration);
    assert.equal(results.at(-1).rows.length, 2);
    const table = results.at(-1).rows.find((r) => r.jenis === 'table');
    assert.deepEqual([table.rls_aktif, table.anon_boleh, table.authenticated_boleh, table.backend_boleh], [true, false, false, false]);
    const func = results.at(-1).rows.find((r) => r.jenis === 'function');
    assert.deepEqual([func.anon_boleh, func.authenticated_boleh, func.backend_boleh], [false, false, true]);
    const actual = await account(); assert.equal(actual.password_changed_at, null);
    delete actual.password_changed_at; assert.deepEqual(actual, originalAccount);
    assert.deepEqual(await auth(), originalAuth); assert.deepEqual(await events(), []);
    const definition = (await db.query("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.portal_complete_password_change(text,text,bigint)'::regprocedure")).rows[0];
    assert.equal(definition.prosecdef, true); assert.deepEqual(definition.proconfig, ['search_path=""']);
  });

  await verify('authenticated administrators and anonymous users cannot call completion or read/write events directly', async () => {
    const f = await fixture('permissions');
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(asRole(statement, [f.token, f.lease, f.version], role), (e) => e.code === '42501');
      await assert.rejects(asRole('UPDATE public.app_users SET must_change_password = false', [], role), (e) => e.code === '42501');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await db.query("SELECT has_table_privilege($1, 'portal_auth_private.password_change_events', $2) AS allowed", [role, operation])).rows[0].allowed, false);
      }
      await assert.rejects(asRole('SELECT * FROM portal_auth_private.password_change_events', [], role), (e) => e.code === '42501');
    }
    assert.equal((await account()).must_change_password, true); assert.deepEqual(await events(), []);
  });

  await verify('invalid hashes, missing leases, and stale versions cannot clear the flag or write events', async () => {
    const f = await fixture('invalid');
    for (const params of [[null, f.lease, f.version], ['raw-cookie', f.lease, f.version], [f.token, null, f.version],
      [f.token, 'raw-lease', f.version], [f.token, hash('wrong-lease'), f.version], [f.token, f.lease, null],
      [f.token, f.lease, 0], [f.token, f.lease, f.version + 1], [hash('missing-cookie'), f.lease, f.version]]) {
      assert.equal((await asRole(statement, params)).rows[0].result, false);
    }
    assert.equal((await account()).must_change_password, true); assert.deepEqual(await events(), []);
  });

  await verify('expired leases, expired portal sessions, and missing Auth sessions fail closed', async () => {
    for (const kind of ['lease', 'portal', 'auth']) {
      const f = await fixture(`expired-${kind}`);
      if (kind === 'lease') await db.query("UPDATE portal_auth_private.web_sessions SET lease_until = now() - interval '1 second' WHERE token_hash = $1", [f.token]);
      if (kind === 'portal') await db.query("UPDATE portal_auth_private.web_sessions SET created_at = now() - interval '9 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1", [f.token]);
      if (kind === 'auth') await db.query('DELETE FROM auth.sessions WHERE id = $1', [f.authId]);
      assert.equal(await complete(f), false);
    }
    assert.equal((await account()).must_change_password, true); assert.deepEqual(await events(), []);
  });

  await verify('completion atomically records the change and revokes every portal session for that account only', async () => {
    const f = await fixture('successful'); await fixture('same-user-second'); const unaffected = await fixture('other-user', other);
    const beforeOther = await account(other);
    assert.equal(await complete(f), true);
    const updated = await account();
    assert.equal(updated.must_change_password, false); assert.equal(updated.row_version, f.version + 1);
    assert.ok(updated.password_changed_at); assert.equal(updated.password_changed_at.getTime(), updated.updated_at.getTime());
    for (const s of await sessions()) {
      if (s.user_id === user) { assert.ok(s.revoked_at); assert.equal(s.token_box, null); assert.equal(s.lease_hash, null); }
    }
    assert.equal((await sessions()).find((s) => s.token_hash === unaffected.token).revoked_at, null);
    assert.deepEqual(await account(other), beforeOther); assert.deepEqual(await auth(), originalAuth);
    const audit = await events(); assert.equal(audit.length, 1); assert.equal(audit[0].user_id, user);
    assert.equal(audit[0].previous_account_version, f.version); assert.equal(audit[0].new_account_version, f.version + 1);
    assert.deepEqual(Object.keys(audit[0]).sort(), ['changed_at', 'id', 'new_account_version', 'previous_account_version', 'user_id', 'web_session_id']);
    assert.equal(await complete(f), false); assert.equal((await events()).length, 1);
  });

  await verify('ordinary later password changes remain supported when the first-change flag is already false', async () => {
    const f = await fixture('later-password-change');
    assert.equal((await account()).must_change_password, false);
    assert.equal(await complete(f), true); assert.equal((await account()).row_version, f.version + 1);
    assert.equal((await events()).length, 2);
  });

  await verify('account deactivation or version changes between Auth and completion prevent stale finalization', async () => {
    for (const kind of ['status', 'version']) {
      const f = await fixture(`account-change-${kind}`); const beforeCount = (await events()).length;
      if (kind === 'status') await db.query("UPDATE public.app_users SET status = 'INACTIVE' WHERE id = $1", [user]);
      else await db.query('UPDATE public.app_users SET row_version = row_version + 1 WHERE id = $1', [user]);
      assert.equal(await complete(f), false); assert.equal((await events()).length, beforeCount);
      if (kind === 'status') await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [user]);
    }
  });

  await verify('transaction rollback restores the flag, versions, all session ciphertext, and event records', async () => {
    await db.query('UPDATE public.app_users SET must_change_password = true WHERE id = $1', [user]);
    const f = await fixture('rollback'); const before = { account: await account(), sessions: await sessions(), events: await events() };
    assert.equal((await asRole(statement, [f.token, f.lease, f.version], 'service_role', true)).rows[0].result, true);
    assert.deepEqual({ account: await account(), sessions: await sessions(), events: await events() }, before);
  });

  await verify('an event insert failure rolls back the account update and session revocations', async () => {
    const f = await fixture('event-failure'); const before = { account: await account(), sessions: await sessions(), events: await events() };
    await db.exec(`CREATE FUNCTION public.fixture_reject_event() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'fixture event failure'; END $$;
      CREATE TRIGGER fixture_reject_event BEFORE INSERT ON portal_auth_private.password_change_events
      FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_event();`);
    await assert.rejects(complete(f), (e) => e.code === 'P0001');
    assert.deepEqual({ account: await account(), sessions: await sessions(), events: await events() }, before);
    await db.exec('DROP TRIGGER fixture_reject_event ON portal_auth_private.password_change_events; DROP FUNCTION public.fixture_reject_event();');
  });

  await verify('reapplication repairs grants and preserves account, session, Auth, event, and staging data', async () => {
    const before = { account: await account(), sessions: await sessions(), events: await events(), auth: await auth() };
    await db.exec(`GRANT EXECUTE ON FUNCTION public.portal_complete_password_change(text,text,bigint) TO PUBLIC, anon, authenticated;
      GRANT SELECT ON portal_auth_private.password_change_events TO PUBLIC, anon, authenticated, service_role;`);
    await db.exec(migration);
    assert.deepEqual({ account: await account(), sessions: await sessions(), events: await events(), auth: await auth() }, before);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await db.query("SELECT has_function_privilege($1, 'public.portal_complete_password_change(text,text,bigint)', 'EXECUTE') AS allowed", [role])).rows[0].allowed, role === 'service_role');
      assert.equal((await db.query("SELECT has_table_privilege($1, 'portal_auth_private.password_change_events', 'SELECT') AS allowed", [role])).rows[0].allowed, false);
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM import_staging.employee_candidates')).rows[0].count, 157);
    assert.deepEqual(await auth(), originalAuth);
  });

  console.log(`${checks} PostgreSQL password-completion checks passed in memory. No real Auth password was changed.`);
} finally { await db.close(); }
