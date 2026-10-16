import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply a local path to @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261016000600_login_rate_limit.sql', import.meta.url), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
let checks = 0;

async function verify(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
async function asRole(role, statement, params = []) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try { return await db.query(statement, params); }
  finally { await db.exec('ROLLBACK'); }
}
async function denied(promise, code = '42501') {
  await assert.rejects(promise, (error) => error.code === code);
}
async function take(username, ip) {
  // Commit calls to model distinct backend requests, unlike rollback-only reads.
  await db.exec('BEGIN; SET LOCAL ROLE service_role;');
  try {
    const result = await db.query('SELECT public.portal_take_login_slot($1, $2) AS allowed', [username, ip]);
    await db.exec('COMMIT');
    return result.rows[0].allowed;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function reset() { await db.exec('TRUNCATE portal_auth_private.login_rate_windows'); }
const rows = async () => (await db.query('SELECT * FROM portal_auth_private.login_rate_windows ORDER BY bucket_kind, bucket_hash')).rows;

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA portal_auth_private;
    ALTER DEFAULT PRIVILEGES IN SCHEMA portal_auth_private
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    GRANT USAGE ON SCHEMA portal_auth_private TO PUBLIC, anon, authenticated, service_role;
  `);

  await verify('the private counter has RLS and all client and service table access is revoked', async () => {
    await db.exec(migration);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'portal_auth_private.login_rate_windows'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await db.query("SELECT has_schema_privilege($1, 'portal_auth_private', 'USAGE') AS allowed", [role])).rows[0].allowed, false);
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        assert.equal((await db.query("SELECT has_table_privilege($1, 'portal_auth_private.login_rate_windows', $2) AS allowed", [role, operation])).rows[0].allowed, false);
      }
      assert.equal((await db.query("SELECT has_function_privilege($1, 'public.portal_take_login_slot(text,text)', 'EXECUTE') AS allowed", [role])).rows[0].allowed, role === 'service_role');
    }
  });

  await verify('only backend execution can take a slot and invalid hashes cannot create state', async () => {
    for (const role of ['anon', 'authenticated']) {
      await denied(asRole(role, 'SELECT public.portal_take_login_slot($1, $2)', [hash('user'), hash('ip')]));
    }
    for (const pair of [[null, hash('ip')], [hash('user'), null], ['', ''], ['raw-username', '192.0.2.1'], ['A'.repeat(64), hash('ip')]]) {
      assert.equal(await take(...pair), false);
    }
    assert.deepEqual(await rows(), []);
  });

  await verify('five attempts are admitted and subsequent requests cannot advance the username counter', async () => {
    const user = hash('user'); const ip = hash('ip');
    for (let i = 0; i < 5; i++) assert.equal(await take(user, ip), true);
    for (let i = 0; i < 4; i++) assert.equal(await take(user, ip), false);
    assert.equal((await rows()).find((row) => row.bucket_kind === 'username').attempt_count, 5);
    assert.equal((await rows()).find((row) => row.bucket_kind === 'ip').attempt_count, 9);
  });

  await verify('changing IP addresses does not bypass the per-username limit', async () => {
    for (let i = 0; i < 3; i++) assert.equal(await take(hash('user'), hash(`different-ip-${i}`)), false);
    assert.equal(await take(hash('another-user'), hash('ip')), true);
  });

  await verify('a shared IP supports 300 requests and rejects new username buckets after its limit', async () => {
    await reset();
    const ip = hash('shared-office-ip');
    for (let i = 0; i < 300; i++) assert.equal(await take(hash(`user-${i}`), ip), true);
    assert.equal(await take(hash('blocked-new-user'), ip), false);
    assert.equal((await rows()).length, 301);
    assert.equal((await rows()).find((row) => row.bucket_kind === 'ip').attempt_count, 300);
    assert.equal(await take(hash('blocked-new-user'), hash('new-ip')), true);
  });

  await verify('expired windows reopen without extending the old window on rejected attempts', async () => {
    await reset();
    const user = hash('user'); const ip = hash('ip');
    for (let i = 0; i < 5; i++) await take(user, ip);
    const before = (await rows()).find((row) => row.bucket_kind === 'username').window_started_at;
    assert.equal(await take(user, ip), false);
    assert.equal((await rows()).find((row) => row.bucket_kind === 'username').window_started_at.getTime(), before.getTime());
    await db.exec("UPDATE portal_auth_private.login_rate_windows SET window_started_at = now() - interval '16 minutes'");
    assert.equal(await take(user, ip), true);
    for (const row of await rows()) assert.equal(row.attempt_count, 1);
  });

  await verify('all API roles are denied direct counter reads and mutations, including a bypass-RLS role', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const query of [
        'SELECT * FROM portal_auth_private.login_rate_windows',
        'UPDATE portal_auth_private.login_rate_windows SET attempt_count = 1',
        'DELETE FROM portal_auth_private.login_rate_windows',
        'TRUNCATE portal_auth_private.login_rate_windows',
      ]) await denied(asRole(role, query));
    }
  });

  await verify('a transaction rollback restores counters and invalid data violates constraints', async () => {
    const before = await rows();
    await asRole('service_role', 'SELECT public.portal_take_login_slot($1, $2)', [hash('rolled-back-user'), hash('rolled-back-ip')]);
    assert.deepEqual(await rows(), before);
    await denied(db.query("UPDATE portal_auth_private.login_rate_windows SET attempt_count = 301"), '23514');
    await denied(db.query("UPDATE portal_auth_private.login_rate_windows SET bucket_hash = 'raw-name'"), '23514');
  });

  await verify('reapplication repairs grants and leaves counters intact', async () => {
    const before = await rows();
    await db.exec('GRANT EXECUTE ON FUNCTION public.portal_take_login_slot(text,text) TO PUBLIC, anon, authenticated');
    await db.exec(migration);
    assert.deepEqual(await rows(), before);
    await denied(asRole('authenticated', 'SELECT public.portal_take_login_slot($1, $2)', [hash('user'), hash('ip')]));
    const definition = (await db.query("SELECT prosecdef, provolatile, proconfig FROM pg_proc WHERE oid = 'public.portal_take_login_slot(text,text)'::regprocedure")).rows[0];
    assert.equal(definition.prosecdef, true);
    assert.equal(definition.provolatile, 'v');
    assert.deepEqual(definition.proconfig, ['search_path=""']);
  });

  console.log(`${checks} PostgreSQL login-rate checks passed in memory. No real data was accessed.`);
} finally { await db.close(); }
