import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply a local path to @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const sqlFile = (name) => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const migration = sqlFile('migrations/20261016000500_account_access_functions.sql');
const manager = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const unassigned = '10000000-0000-4000-8000-000000000003';
const unmapped = '10000000-0000-4000-8000-000000000004';
const unknown = '10000000-0000-4000-8000-000000000005';
const adminPermissions = [
  'admin.audit.read', 'admin.roles.manage', 'admin.roles.read',
  'admin.users.manage', 'admin.users.read', 'admin.users.reset',
];
let checks = 0;

async function verify(name, run) {
  await run(); checks++;
  console.log(`PASS ${name}`);
}

async function asRole(role, subject, statement, params = []) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [subject ?? '']);
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      sub: subject, role: 'service_role', user_metadata: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
    })]);
    return await db.query(statement, params);
  } finally { await db.exec('ROLLBACK'); }
}

async function denied(promise, code = '42501') {
  await assert.rejects(promise, (error) => error.code === code);
}

const resolveLogin = async (username) => (await asRole('service_role', null,
  'SELECT * FROM public.portal_resolve_login($1)', [username])).rows;
const account = async (subject) => (await asRole('authenticated', subject,
  'SELECT public.portal_current_account() AS account')).rows[0].account;

const tableState = async () => {
  const result = {};
  for (const table of ['app_users', 'app_roles', 'app_user_roles', 'app_permissions', 'app_role_permissions']) {
    result[table] = (await db.query(`SELECT to_jsonb(t) AS value FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
};

try {
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz,
      encrypted_password text DEFAULT 'never-return-this-fixture-hash',
      raw_user_meta_data jsonb DEFAULT '{"role":"SUPER_ADMIN"}'::jsonb
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
      ('${manager}', 'bpfbesakih@gmail.com', now()),
      ('${other}', 'other@example.invalid', now()),
      ('${unassigned}', 'unassigned@example.invalid', now()),
      ('${unmapped}', 'unmapped@example.invalid', now());
  `);
  for (const name of [
    'migrations/20261016000100_import_staging.sql',
    'migrations/20261016000200_app_user_links.sql', 'setup/link-itadmin.sql',
    'migrations/20261016000300_app_role_foundation.sql', 'setup/grant-itadmin-super-admin.sql',
    'migrations/20261016000400_app_permissions.sql', 'setup/grant-super-admin-permissions.sql',
  ]) await db.exec(sqlFile(name));
  await db.query('INSERT INTO public.app_users (id, username) VALUES ($1, $2), ($3, $4)', [other, 'other', unassigned, 'unassigned']);
  await db.exec(`
    INSERT INTO import_staging.employee_candidates (full_name, positions, source_name, source_cells)
    SELECT 'Fiktif ' || g, '[]'::jsonb, 'test-fixture', '[]'::jsonb
    FROM generate_series(1, 157) AS g;
  `);

  await verify('function privileges and execution identities are restricted despite default grants', async () => {
    await db.exec(migration);
    const definitions = (await db.query(`
      SELECT p.proname, p.prosecdef, p.provolatile, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('portal_current_account', 'portal_resolve_login')
      ORDER BY p.proname
    `)).rows;
    assert.equal(definitions.length, 2);
    for (const definition of definitions) {
      assert.equal(definition.prosecdef, definition.proname === 'portal_resolve_login');
      assert.equal(definition.provolatile, 's');
      assert.deepEqual(definition.proconfig, ['search_path=""']);
      const signature = definition.proname === 'portal_resolve_login' ? 'public.portal_resolve_login(text)' : 'public.portal_current_account()';
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const expected = definition.proname === 'portal_resolve_login' ? role === 'service_role' : role === 'authenticated';
        assert.equal((await db.query('SELECT has_function_privilege($1, $2, $3) AS allowed', [role, signature, 'EXECUTE'])).rows[0].allowed, expected);
      }
    }
  });

  await verify('only the backend can resolve normalized usernames to a confirmed Auth identity', async () => {
    for (const username of ['itadmin', 'ITAdmin', '  itadmin  ']) {
      assert.deepEqual(await resolveLogin(username), [{ auth_user_id: manager, login_email: 'bpfbesakih@gmail.com' }]);
    }
    for (const username of [null, '', '   ', 'missing', 'x'.repeat(65), "itadmin' OR 1=1 --", 'bpfbesakih@gmail.com']) {
      assert.deepEqual(await resolveLogin(username), []);
    }
    assert.deepEqual(await resolveLogin('other'), [{ auth_user_id: other, login_email: 'other@example.invalid' }]);
    assert.deepEqual(await resolveLogin('unmapped'), []);
  });

  await verify('inactive, locked, unconfirmed, or email-less identities cannot be resolved', async () => {
    for (const status of ['INACTIVE', 'LOCKED']) {
      await db.query('UPDATE public.app_users SET status = $1 WHERE id = $2', [status, manager]);
      assert.deepEqual(await resolveLogin('itadmin'), []);
    }
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [manager]);
    await db.query('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1', [manager]);
    assert.deepEqual(await resolveLogin('itadmin'), []);
    await db.query('UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1', [manager]);
    for (const email of [null, '', '   ']) {
      await db.query('UPDATE auth.users SET email = $1 WHERE id = $2', [email, manager]);
      assert.deepEqual(await resolveLogin('itadmin'), []);
    }
    await db.query("UPDATE auth.users SET email = 'bpfbesakih@gmail.com' WHERE id = $1", [manager]);
  });

  await verify('anonymous callers and signed-in administrators cannot resolve or enumerate login identities', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const subject of [manager, other, unassigned, null]) {
        await denied(asRole(role, subject, 'SELECT * FROM public.portal_resolve_login($1)', ['itadmin']));
      }
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await denied(asRole(role, manager, 'SELECT email, encrypted_password FROM auth.users'));
    }
  });

  await verify('the current-account response contains safe own-account fields and exact scoped permissions', async () => {
    const context = await account(manager);
    assert.deepEqual(context.user, { id: manager, username: 'itadmin', status: 'ACTIVE', must_change_password: true, row_version: 1 });
    assert.equal(context.role_assignments.length, 1);
    const assignment = context.role_assignments[0];
    assert.equal(assignment.role, 'SUPER_ADMIN');
    assert.equal(assignment.scope_kind, 'ALL');
    assert.deepEqual(assignment.permissions, adminPermissions);
    assert.deepEqual(Object.keys(assignment).sort(), ['assignment_id', 'permissions', 'role', 'role_id', 'scope_kind']);
    assert.ok(!JSON.stringify(context).includes('bpfbesakih@gmail.com'));
    assert.ok(!JSON.stringify(context).includes('never-return-this-fixture-hash'));
    assert.ok(!JSON.stringify(context).includes('raw_user_meta_data'));
  });

  await verify('metadata cannot give unassigned accounts a role and missing identities receive no account', async () => {
    for (const subject of [other, unassigned]) {
      const context = await account(subject);
      assert.equal(context.user.id, subject);
      assert.deepEqual(context.role_assignments, []);
    }
    for (const subject of [unmapped, unknown, null]) assert.equal(await account(subject), null);
    await denied(asRole('anon', manager, 'SELECT public.portal_current_account()'));
    await denied(asRole('service_role', manager, 'SELECT public.portal_current_account()'));
    await denied(asRole('authenticated', other, 'SELECT public.portal_current_account($1::uuid)', [manager]), '42883');
  });

  await verify('multiple role assignments retain independent scopes and do not promote a SELF permission to ALL', async () => {
    await db.exec(`
      INSERT INTO public.app_roles (code, name) VALUES ('EMPLOYEE', 'Pegawai');
      INSERT INTO public.app_role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
      WHERE r.code = 'EMPLOYEE' AND p.code = 'hr.employees.read';
      INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
      SELECT '${manager}', id, 'SELF' FROM public.app_roles WHERE code = 'EMPLOYEE';
      INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
      SELECT '${other}', id, 'ASSIGNED_UNITS' FROM public.app_roles WHERE code = 'EMPLOYEE';
    `);
    const assignments = (await account(manager)).role_assignments;
    assert.deepEqual(assignments.map(({ role, scope_kind, permissions }) => ({ role, scope_kind, permissions })), [
      { role: 'EMPLOYEE', scope_kind: 'SELF', permissions: ['hr.employees.read'] },
      { role: 'SUPER_ADMIN', scope_kind: 'ALL', permissions: adminPermissions },
    ]);
    const otherAssignments = (await account(other)).role_assignments;
    assert.equal(otherAssignments.length, 1);
    assert.equal(otherAssignments[0].scope_kind, 'ASSIGNED_UNITS');
    assert.deepEqual(otherAssignments[0].permissions, ['hr.employees.read']);
  });

  await verify('account status and password-change flags are read fresh without granting permission to alter them', async () => {
    for (const status of ['INACTIVE', 'LOCKED']) {
      await db.query('UPDATE public.app_users SET status = $1 WHERE id = $2', [status, manager]);
      assert.equal(await account(manager), null);
    }
    await db.query("UPDATE public.app_users SET status = 'ACTIVE', must_change_password = false WHERE id = $1", [manager]);
    assert.equal((await account(manager)).user.must_change_password, false);
    await denied(asRole('authenticated', manager, 'UPDATE public.app_users SET must_change_password = false'));
    await db.query('UPDATE public.app_users SET must_change_password = true WHERE id = $1', [manager]);
    assert.equal((await account(manager)).user.must_change_password, true);
  });

  await verify('role deactivation and revoked assignments or permissions are reflected on the next read', async () => {
    await db.exec("UPDATE public.app_roles SET is_active = false WHERE code = 'SUPER_ADMIN'");
    assert.deepEqual((await account(manager)).role_assignments.map((assignment) => assignment.role), ['EMPLOYEE']);
    await db.exec("UPDATE public.app_roles SET is_active = true WHERE code = 'SUPER_ADMIN'");
    await db.exec(`DELETE FROM public.app_role_permissions
      WHERE role_id = (SELECT id FROM public.app_roles WHERE code = 'EMPLOYEE')`);
    assert.deepEqual((await account(other)).role_assignments[0].permissions, []);
    await db.exec(`DELETE FROM public.app_user_roles WHERE user_id = '${manager}'
      AND role_id = (SELECT id FROM public.app_roles WHERE code = 'EMPLOYEE')`);
    assert.equal((await account(manager)).role_assignments.length, 1);
    assert.deepEqual((await account(manager)).role_assignments[0].permissions, adminPermissions);
  });

  await verify('schema-qualified queries resist caller search-path and temporary-table shadowing', async () => {
    await db.exec(`
      CREATE TEMP TABLE app_users (id uuid, username text, status text);
      INSERT INTO app_users VALUES ('${unknown}', 'itadmin', 'ACTIVE');
      CREATE TEMP TABLE app_roles (code text);
      INSERT INTO app_roles VALUES ('FAKE_ADMIN');
      SET search_path = pg_temp, public;
    `);
    assert.deepEqual(await resolveLogin('itadmin'), [{ auth_user_id: manager, login_email: 'bpfbesakih@gmail.com' }]);
    assert.equal((await account(manager)).user.id, manager);
    assert.equal((await account(manager)).role_assignments[0].role, 'SUPER_ADMIN');
    await db.exec('RESET search_path; DROP TABLE pg_temp.app_users; DROP TABLE pg_temp.app_roles;');
  });

  await verify('reapplying the migration repairs function grants while preserving account and permission data', async () => {
    const before = await tableState();
    await db.exec(`
      GRANT EXECUTE ON FUNCTION public.portal_resolve_login(text) TO PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.portal_current_account() TO PUBLIC, anon, service_role;
    `);
    await db.exec(migration);
    assert.deepEqual(await tableState(), before);
    await denied(asRole('authenticated', manager, 'SELECT * FROM public.portal_resolve_login($1)', ['itadmin']));
    await denied(asRole('anon', manager, 'SELECT public.portal_current_account()'));
    await denied(asRole('service_role', manager, 'SELECT public.portal_current_account()'));
    assert.deepEqual((await account(manager)).role_assignments[0].permissions, adminPermissions);
  });

  await verify('calls remain read-only and preserve all 157 staging candidates and initial-password obligations', async () => {
    const before = await tableState();
    await resolveLogin('itadmin');
    await account(manager);
    await account(other);
    assert.deepEqual(await tableState(), before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM import_staging.employee_candidates')).rows[0].n, 157);
    assert.equal((await account(manager)).user.must_change_password, true);
    await denied(asRole('authenticated', manager, 'SELECT * FROM import_staging.employee_candidates'));
  });

  console.log(`${checks} PostgreSQL account-access checks passed in memory. No real data was accessed.`);
} finally { await db.close(); }
