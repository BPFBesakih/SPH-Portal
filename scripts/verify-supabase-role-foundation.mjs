import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply a local path to @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const sqlFile = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const accountsSql = sqlFile('../supabase/migrations/20261016000200_app_user_links.sql');
const stagingSql = sqlFile('../supabase/migrations/20261016000100_import_staging.sql');
const linkSql = sqlFile('../supabase/setup/link-itadmin.sql');
const rolesSql = sqlFile('../supabase/migrations/20261016000300_app_role_foundation.sql');
const grantSql = sqlFile('../supabase/setup/grant-itadmin-super-admin.sql');
const manager = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const unassigned = '10000000-0000-4000-8000-000000000003';
const tables = ['app_roles', 'app_user_roles'];
let checks = 0;

async function verify(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

async function asRole(role, subject, statement, params = []) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [subject ?? '']);
    return await db.query(statement, params);
  } finally {
    await db.exec('ROLLBACK');
  }
}

async function denied(promise, code = '42501') {
  await assert.rejects(promise, (error) => error.code === code);
}

async function rejectedGrant(pattern) {
  try {
    await assert.rejects(db.exec(grantSql), pattern);
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
      ('${other}', 'other@example.invalid', now()),
      ('${unassigned}', 'unassigned@example.invalid', now());
  `);
  await db.exec(stagingSql);
  await db.exec(`
    INSERT INTO import_staging.employee_candidates
      (full_name, positions, source_name, source_cells)
    SELECT 'Fiktif ' || g, '[]'::jsonb, 'test-fixture', '[]'::jsonb
    FROM generate_series(1, 157) AS g;
  `);
  await db.exec(accountsSql);
  await db.exec(linkSql);
  await db.query('INSERT INTO public.app_users (id, username) VALUES ($1, $2), ($3, $4)', [other, 'other', unassigned, 'unassigned']);

  await verify('migration creates a system role without assigning it implicitly', async () => {
    await db.exec(rolesSql);
    assert.deepEqual((await db.query('SELECT code, is_system, is_active FROM public.app_roles')).rows, [
      { code: 'SUPER_ADMIN', is_system: true, is_active: true },
    ]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_user_roles')).rows[0].n, 0);
    assert.deepEqual((await asRole('authenticated', manager, 'SELECT code FROM public.app_roles')).rows, []);
  });

  await verify('RLS is enabled and default privileges are reduced to selected reads', async () => {
    for (const table of tables) {
      assert.equal((await db.query('SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass', [`public.${table}`])).rows[0].relrowsecurity, true);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const result = await db.query('SELECT has_table_privilege($1, $2, $3) AS allowed', [role, `public.${table}`, operation]);
          assert.equal(result.rows[0].allowed, role !== 'anon' && operation === 'SELECT', `${role} ${table} ${operation}`);
        }
      }
    }
  });

  await verify('the bootstrap grant assigns only the intended confirmed identity with ALL scope', async () => {
    await db.exec(grantSql);
    assert.deepEqual((await db.query(`
      SELECT ur.user_id, r.code, ur.scope_kind
      FROM public.app_user_roles ur JOIN public.app_roles r ON r.id = ur.role_id
    `)).rows, [{ user_id: manager, code: 'SUPER_ADMIN', scope_kind: 'ALL' }]);
    await db.exec(`
      INSERT INTO public.app_roles (code, name) VALUES ('EMPLOYEE', 'Pegawai');
      INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
      SELECT '${other}', id, 'SELF' FROM public.app_roles WHERE code = 'EMPLOYEE';
    `);
  });

  await verify('each caller can read only their own assignments and assigned active roles', async () => {
    assert.deepEqual((await asRole('authenticated', manager, 'SELECT code FROM public.app_roles')).rows, [{ code: 'SUPER_ADMIN' }]);
    assert.deepEqual((await asRole('authenticated', other, 'SELECT code FROM public.app_roles')).rows, [{ code: 'EMPLOYEE' }]);
    for (const id of [manager, other]) {
      assert.deepEqual((await asRole('authenticated', id, 'SELECT user_id FROM public.app_user_roles')).rows, [{ user_id: id }]);
    }
    for (const id of [unassigned, null]) {
      for (const table of tables) assert.deepEqual((await asRole('authenticated', id, `SELECT * FROM public.${table}`)).rows, []);
    }
  });

  await verify('anonymous callers cannot read either role table', async () => {
    for (const table of tables) await denied(asRole('anon', null, `SELECT * FROM public.${table}`));
  });

  await verify('even an assigned administrator cannot grant or modify roles from the client', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await denied(asRole(role, manager, "INSERT INTO public.app_roles (code, name) VALUES ('INTRUDER', 'Intruder')"));
      await denied(asRole(role, manager, `
        INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
        SELECT '${unassigned}', id, 'ALL' FROM public.app_roles WHERE code = 'SUPER_ADMIN'
      `));
      for (const table of tables) {
        await denied(asRole(role, manager, `UPDATE public.${table} SET row_version = row_version + 1`));
        await denied(asRole(role, manager, `DELETE FROM public.${table}`));
      }
    }
  });

  await verify('inactive or locked accounts lose read access to roles and assignments', async () => {
    for (const status of ['INACTIVE', 'LOCKED']) {
      await db.query('UPDATE public.app_users SET status = $1 WHERE id = $2', [status, manager]);
      for (const table of tables) assert.deepEqual((await asRole('authenticated', manager, `SELECT * FROM public.${table}`)).rows, []);
    }
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [manager]);
  });

  await verify('an inactive role is excluded from the effective role join', async () => {
    await db.exec("UPDATE public.app_roles SET is_active = false WHERE code = 'SUPER_ADMIN'");
    assert.deepEqual((await asRole('authenticated', manager, `
      SELECT r.code FROM public.app_user_roles ur JOIN public.app_roles r ON r.id = ur.role_id
    `)).rows, []);
    await rejectedGrant(/role SUPER_ADMIN/);
    await db.exec(rolesSql);
    assert.equal((await db.query("SELECT is_active FROM public.app_roles WHERE code = 'SUPER_ADMIN'")).rows[0].is_active, false);
    await db.exec("UPDATE public.app_roles SET is_active = true WHERE code = 'SUPER_ADMIN'");
  });

  await verify('repeating the grant preserves account flags and does not duplicate assignments', async () => {
    await db.query('UPDATE public.app_users SET must_change_password = false WHERE id = $1', [manager]);
    const before = (await db.query('SELECT id, created_at FROM public.app_user_roles WHERE user_id = $1', [manager])).rows;
    await db.exec(rolesSql);
    await db.exec(grantSql);
    assert.deepEqual((await db.query('SELECT id, created_at FROM public.app_user_roles WHERE user_id = $1', [manager])).rows, before);
    assert.equal((await db.query('SELECT must_change_password FROM public.app_users WHERE id = $1', [manager])).rows[0].must_change_password, false);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_user_roles')).rows[0].n, 2);
  });

  await verify('bootstrap rejects inactive, mismatched, and unconfirmed manager identities', async () => {
    await db.query("UPDATE public.app_users SET status = 'INACTIVE' WHERE id = $1", [manager]);
    await rejectedGrant(/identitas Auth/);
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [manager]);
    await db.query('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1', [manager]);
    await rejectedGrant(/identitas Auth/);
    await db.query("UPDATE auth.users SET email = 'wrong@example.invalid', email_confirmed_at = now() WHERE id = $1", [manager]);
    await rejectedGrant(/identitas Auth/);
    await db.query("UPDATE auth.users SET email = 'bpfbesakih@gmail.com' WHERE id = $1", [manager]);
  });

  await verify('duplicate assignments and invalid role codes or scopes are rejected', async () => {
    await denied(db.query("UPDATE public.app_roles SET code = 'super_admin' WHERE code = 'SUPER_ADMIN'"), '23514');
    await denied(db.query("UPDATE public.app_user_roles SET scope_kind = 'ANY'"), '23514');
    await denied(db.query(`
      INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
      SELECT user_id, role_id, scope_kind FROM public.app_user_roles WHERE user_id = $1
    `, [manager]), '23505');
    await denied(db.query('INSERT INTO public.app_user_roles (user_id, role_id, scope_kind) VALUES ($1, gen_random_uuid(), $2)', [manager, 'ALL']), '23503');
  });

  await verify('the backend can read role data while staging stays private and unchanged', async () => {
    assert.equal((await asRole('service_role', null, 'SELECT count(*)::int AS n FROM public.app_user_roles')).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM import_staging.employee_candidates')).rows[0].n, 157);
    await denied(asRole('authenticated', manager, 'SELECT * FROM import_staging.employee_candidates'));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_users')).rows[0].n, 3);
  });

  console.log(`${checks} PostgreSQL role checks passed in memory. No real data was accessed.`);
} finally {
  await db.close();
}
