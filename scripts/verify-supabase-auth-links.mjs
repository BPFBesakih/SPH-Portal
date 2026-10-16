import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Supply the local path to @electric-sql/pglite/dist/index.js. No production database is used.');
const { PGlite } = await import(pathToFileURL(resolve(modulePath)).href);
const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261016000200_app_user_links.sql', import.meta.url), 'utf8');
const stagingMigration = readFileSync(new URL('../supabase/migrations/20261016000100_import_staging.sql', import.meta.url), 'utf8');
const link = readFileSync(new URL('../supabase/setup/link-itadmin.sql', import.meta.url), 'utf8');
const manager = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
let checks = 0;

async function verify(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

async function asRole(role, subject, sql, params = []) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [subject ?? '']);
    return await db.query(sql, params);
  } finally {
    await db.exec('ROLLBACK');
  }
}

async function denied(promise, code = '42501') {
  const codes = Array.isArray(code) ? code : [code];
  await assert.rejects(promise, (error) => codes.includes(error.code));
}

async function failedLink(pattern) {
  try {
    await assert.rejects(db.exec(link), pattern);
  } finally {
    await db.exec('ROLLBACK');
  }
}

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    INSERT INTO auth.users VALUES
      ('${manager}', 'bpfbesakih@gmail.com', now()),
      ('${other}', 'other@example.invalid', now());
  `);
  await db.exec(stagingMigration);
  await db.exec(`
    INSERT INTO import_staging.employee_candidates
      (full_name, positions, source_name, source_cells)
    SELECT 'Fiktif ' || g, '[]'::jsonb, 'test-fixture', '[]'::jsonb
    FROM generate_series(1, 157) AS g;
  `);

  await verify('migration enables RLS and removes default write/anon grants', async () => {
    await db.exec(migration);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.app_users'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
        const result = await db.query("SELECT has_table_privilege($1, 'public.app_users', $2) AS allowed", [role, operation]);
        assert.equal(result.rows[0].allowed, role !== 'anon' && operation === 'SELECT', `${role} ${operation}`);
      }
    }
  });

  await verify('only the confirmed manager identity is linked', async () => {
    await db.exec(link);
    assert.deepEqual((await db.query('SELECT id, username, status, must_change_password FROM public.app_users')).rows, [
      { id: manager, username: 'itadmin', status: 'ACTIVE', must_change_password: true },
    ]);
    await db.query('INSERT INTO public.app_users (id, username) VALUES ($1, $2)', [other, 'other']);
  });

  await verify('authenticated callers can read only their own active account', async () => {
    assert.deepEqual((await asRole('authenticated', manager, 'SELECT username FROM public.app_users')).rows, [{ username: 'itadmin' }]);
    assert.deepEqual((await asRole('authenticated', other, 'SELECT username FROM public.app_users')).rows, [{ username: 'other' }]);
    assert.deepEqual((await asRole('authenticated', null, 'SELECT username FROM public.app_users')).rows, []);
    assert.deepEqual((await asRole('authenticated', manager, 'SELECT username FROM public.app_users WHERE id = $1', [other])).rows, []);
    assert.equal((await asRole('service_role', null, 'SELECT count(*)::int AS n FROM public.app_users')).rows[0].n, 2);
  });

  await verify('anon cannot read and client roles cannot insert/update/delete', async () => {
    await denied(asRole('anon', null, 'SELECT * FROM public.app_users'));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await denied(asRole(role, manager, "INSERT INTO public.app_users (id, username) VALUES (gen_random_uuid(), 'intruder')"));
      await denied(asRole(role, manager, "UPDATE public.app_users SET status = 'ACTIVE', must_change_password = false"));
      await denied(asRole(role, manager, 'DELETE FROM public.app_users'));
    }
  });

  await verify('inactive and locked accounts are immediately hidden from their own session', async () => {
    for (const status of ['INACTIVE', 'LOCKED']) {
      await db.query('UPDATE public.app_users SET status = $1 WHERE id = $2', [status, manager]);
      assert.deepEqual((await asRole('authenticated', manager, 'SELECT * FROM public.app_users')).rows, []);
    }
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [manager]);
  });

  await verify('repeating migration/link preserves existing status and password obligation', async () => {
    await db.query("UPDATE public.app_users SET status = 'INACTIVE', must_change_password = false WHERE id = $1", [manager]);
    await db.exec(migration);
    await db.exec(link);
    assert.deepEqual((await db.query('SELECT status, must_change_password FROM public.app_users WHERE id = $1', [manager])).rows, [
      { status: 'INACTIVE', must_change_password: false },
    ]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_users')).rows[0].n, 2);
  });

  await verify('username normalization, status, version and Auth foreign key are enforced', async () => {
    await denied(db.query("UPDATE public.app_users SET username = 'ITAdmin' WHERE id = $1", [manager]), '23514');
    await denied(db.query("UPDATE public.app_users SET username = ' itadmin' WHERE id = $1", [manager]), '23514');
    await denied(db.query("UPDATE public.app_users SET status = 'ADMIN' WHERE id = $1", [manager]), '23514');
    await denied(db.query('UPDATE public.app_users SET row_version = 0 WHERE id = $1', [manager]), '23514');
    await denied(db.query("INSERT INTO public.app_users (id, username) VALUES (gen_random_uuid(), 'unknown')"), '23503');
    await denied(db.query('DELETE FROM auth.users WHERE id = $1', [manager]), ['23001', '23503']);
  });

  await verify('linking rejects unconfirmed or ambiguous manager identities', async () => {
    await db.query('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1', [manager]);
    await failedLink(/terkonfirmasi/);
    await db.query('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [manager]);
    await db.query("INSERT INTO auth.users VALUES ('10000000-0000-4000-8000-000000000003', 'BPFBESAKIH@gmail.com', now())");
    await failedLink(/Lebih dari satu/);
    await db.query("DELETE FROM auth.users WHERE id = '10000000-0000-4000-8000-000000000003'");
  });

  await verify('linking does not replace an existing identity or username owner', async () => {
    await db.query("UPDATE public.app_users SET username = 'existing' WHERE id = $1", [manager]);
    await failedLink(/username lain/);
    await db.query('DELETE FROM public.app_users WHERE id = $1', [manager]);
    await db.query("UPDATE public.app_users SET username = 'itadmin' WHERE id = $1", [other]);
    await failedLink(/akun lain/);
    assert.deepEqual((await db.query('SELECT id FROM public.app_users WHERE username = $1', ['itadmin'])).rows, [{ id: other }]);
  });

  await verify('all 157 staging fixtures and their RLS configuration remain intact', async () => {
    assert.equal((await db.query('SELECT count(*)::int AS n FROM import_staging.employee_candidates')).rows[0].n, 157);
    assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'import_staging.employee_candidates'::regclass")).rows[0].relrowsecurity, true);
    await denied(asRole('authenticated', manager, 'SELECT * FROM import_staging.employee_candidates'));
  });

  console.log(`${checks} PostgreSQL checks passed in memory. No real data was accessed.`);
} finally {
  await db.close();
}
