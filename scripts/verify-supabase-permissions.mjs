import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw new Error('Supply a local path to @electric-sql/pglite/dist/index.js.');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const sqlFile = (name) => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const permissionSql = sqlFile('migrations/20261016000400_app_permissions.sql');
const grantSql = sqlFile('setup/grant-super-admin-permissions.sql');
const manager = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const unassigned = '10000000-0000-4000-8000-000000000003';
const tables = ['app_permissions', 'app_role_permissions'];
const adminPermissions = [
  'admin.audit.read', 'admin.roles.manage', 'admin.roles.read',
  'admin.users.manage', 'admin.users.read', 'admin.users.reset',
];
// Read the established catalog without importing the SQLite application.
const authSource = readFileSync(new URL('../lib/auth.mjs', import.meta.url), 'utf8');
const resourcesBlock = authSource.match(/export const resourceActions = \{([\s\S]*?)\r?\n\};/)?.[1];
assert.ok(resourcesBlock, 'Established resourceActions catalog must be available');
const expectedCatalog = [...resourcesBlock.matchAll(/'([^']+)'\s*:\s*\[([^\]]*)\]/g)]
  .flatMap(([, resource, actions]) => [...actions.matchAll(/'([^']+)'/g)].map(([, action]) => `${resource}.${action}`))
  .filter((code) => !code.startsWith('purchasing.')) // Modul Pengadaan ditambahkan migrasi 20261017210000.
  .sort();
assert.equal(expectedCatalog.length, 43);
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
    await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ user_metadata: { role: 'SUPER_ADMIN' } })]);
    return await db.query(statement, params);
  } finally { await db.exec('ROLLBACK'); }
}

async function denied(promise, code = '42501') {
  await assert.rejects(promise, (error) => error.code === code);
}

async function rejectedGrant(pattern) {
  try { await assert.rejects(db.exec(grantSql), pattern); }
  finally { await db.exec('ROLLBACK'); }
}

const visiblePermissions = async (subject) => (await asRole('authenticated', subject,
  'SELECT code FROM public.app_permissions ORDER BY code')).rows.map((row) => row.code);

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
  await db.exec(sqlFile('migrations/20261016000100_import_staging.sql'));
  await db.exec(`
    INSERT INTO import_staging.employee_candidates
      (full_name, positions, source_name, source_cells)
    SELECT 'Fiktif ' || g, '[]'::jsonb, 'test-fixture', '[]'::jsonb
    FROM generate_series(1, 157) AS g;
  `);
  await db.exec(sqlFile('migrations/20261016000200_app_user_links.sql'));
  await db.exec(sqlFile('setup/link-itadmin.sql'));
  await db.query('INSERT INTO public.app_users (id, username) VALUES ($1, $2), ($3, $4)', [other, 'other', unassigned, 'unassigned']);
  await db.exec(sqlFile('migrations/20261016000300_app_role_foundation.sql'));
  await db.exec(sqlFile('setup/grant-itadmin-super-admin.sql'));

  await verify('the SQL catalog matches all 43 existing application permission codes', async () => {
    await db.exec(permissionSql);
    assert.deepEqual((await db.query('SELECT code FROM public.app_permissions ORDER BY code')).rows.map((row) => row.code), expectedCatalog);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_role_permissions')).rows[0].n, 0);
  });

  await verify('new tables have RLS and only explicit read grants', async () => {
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

  await verify('role names and spoofed metadata do not imply any permission', async () => {
    for (const subject of [manager, other, unassigned, null]) assert.deepEqual(await visiblePermissions(subject), []);
  });

  await verify('bootstrap grants exactly six administrative permissions, without sensitive or future permissions', async () => {
    await db.exec(`INSERT INTO public.app_permissions (code, module_code, resource, action)
      VALUES ('admin.future.read', 'admin', 'admin.future', 'read')`);
    await db.exec(grantSql);
    assert.deepEqual(await visiblePermissions(manager), adminPermissions);
    assert.equal((await asRole('authenticated', manager, 'SELECT count(*)::int AS n FROM public.app_role_permissions')).rows[0].n, 6);
    assert.ok(!(await visiblePermissions(manager)).some((code) => code.startsWith('hr.') || code.startsWith('security.') || code === 'admin.future.read'));
  });

  await verify('each user sees only permissions attached to their assigned active roles', async () => {
    await db.exec(`
      INSERT INTO public.app_roles (code, name) VALUES ('EMPLOYEE', 'Pegawai');
      INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
      SELECT '${other}', id, 'SELF' FROM public.app_roles WHERE code = 'EMPLOYEE';
      INSERT INTO public.app_role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
      WHERE r.code = 'EMPLOYEE' AND p.code = 'hr.employees.read';
    `);
    assert.deepEqual(await visiblePermissions(other), ['hr.employees.read']);
    assert.deepEqual(await visiblePermissions(manager), adminPermissions);
    assert.deepEqual(await visiblePermissions(unassigned), []);
    assert.equal((await asRole('authenticated', other, 'SELECT count(*)::int AS n FROM public.app_role_permissions')).rows[0].n, 1);
  });

  await verify('multiple roles combine only explicit permissions and retain their separate scopes', async () => {
    await db.exec(`INSERT INTO public.app_user_roles (user_id, role_id, scope_kind)
      SELECT '${manager}', id, 'SELF' FROM public.app_roles WHERE code = 'EMPLOYEE'`);
    assert.deepEqual(await visiblePermissions(manager), [...adminPermissions, 'hr.employees.read'].sort());
    const scopes = (await asRole('authenticated', manager, `
      SELECT r.code, ur.scope_kind FROM public.app_user_roles ur
      JOIN public.app_roles r ON r.id = ur.role_id ORDER BY r.code
    `)).rows;
    assert.deepEqual(scopes, [{ code: 'EMPLOYEE', scope_kind: 'SELF' }, { code: 'SUPER_ADMIN', scope_kind: 'ALL' }]);
    await db.exec(`DELETE FROM public.app_user_roles WHERE user_id = '${manager}'
      AND role_id = (SELECT id FROM public.app_roles WHERE code = 'EMPLOYEE')`);
  });

  await verify('anonymous callers cannot read and no API role can mutate the permission tables', async () => {
    for (const table of tables) await denied(asRole('anon', null, `SELECT * FROM public.${table}`));
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await denied(asRole(role, manager, `INSERT INTO public.app_permissions (code, module_code, resource, action)
        VALUES ('admin.intruder.read', 'admin', 'admin.intruder', 'read')`));
      await denied(asRole(role, manager, `INSERT INTO public.app_role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM public.app_roles r CROSS JOIN public.app_permissions p
        WHERE r.code = 'EMPLOYEE' AND p.code = 'admin.users.manage'`));
      await denied(asRole(role, manager, "UPDATE public.app_permissions SET action = 'manage'"));
      await denied(asRole(role, manager, 'UPDATE public.app_role_permissions SET created_at = now()'));
      for (const table of tables) await denied(asRole(role, manager, `DELETE FROM public.${table}`));
    }
  });

  await verify('inactive and locked accounts immediately lose permission visibility', async () => {
    for (const status of ['INACTIVE', 'LOCKED']) {
      await db.query('UPDATE public.app_users SET status = $1 WHERE id = $2', [status, manager]);
      assert.deepEqual(await visiblePermissions(manager), []);
      assert.deepEqual((await asRole('authenticated', manager, 'SELECT * FROM public.app_role_permissions')).rows, []);
    }
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [manager]);
  });

  await verify('inactive roles and revoked assignments remove effective permissions without relying on token metadata', async () => {
    await db.exec("UPDATE public.app_roles SET is_active = false WHERE code = 'SUPER_ADMIN'");
    assert.deepEqual(await visiblePermissions(manager), []);
    await db.exec("UPDATE public.app_roles SET is_active = true WHERE code = 'SUPER_ADMIN'");
    await db.exec(`DELETE FROM public.app_user_roles WHERE user_id = '${manager}'
      AND role_id = (SELECT id FROM public.app_roles WHERE code = 'SUPER_ADMIN')`);
    assert.deepEqual(await visiblePermissions(manager), []);
    await db.exec(sqlFile('setup/grant-itadmin-super-admin.sql'));
  });

  await verify('repeating migration and bootstrap neither duplicates grants nor expands them to new catalog entries', async () => {
    const before = (await db.query('SELECT role_id, permission_id, created_at FROM public.app_role_permissions ORDER BY role_id, permission_id')).rows;
    await db.exec(permissionSql);
    await db.exec(grantSql);
    assert.deepEqual((await db.query('SELECT role_id, permission_id, created_at FROM public.app_role_permissions ORDER BY role_id, permission_id')).rows, before);
    assert.deepEqual(await visiblePermissions(manager), adminPermissions);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_permissions')).rows[0].n, 44);
  });

  await verify('permission identity, module, unique-pair, and FK constraints are enforced', async () => {
    await denied(db.query("UPDATE public.app_permissions SET module_code = 'hr' WHERE code = 'admin.audit.read'"), '23514');
    await denied(db.query("UPDATE public.app_permissions SET code = 'admin.audit.manage' WHERE code = 'admin.audit.read'"), '23514');
    await denied(db.query('INSERT INTO public.app_role_permissions SELECT role_id, permission_id, created_at FROM public.app_role_permissions LIMIT 1'), '23505');
    await denied(db.query('INSERT INTO public.app_role_permissions (role_id, permission_id) VALUES (gen_random_uuid(), gen_random_uuid())'), '23503');
  });

  await verify('an incomplete catalog fails atomically rather than granting a partial set', async () => {
    await db.exec(`DELETE FROM public.app_role_permissions
      WHERE permission_id = (SELECT id FROM public.app_permissions WHERE code = 'admin.audit.read');
      DELETE FROM public.app_permissions WHERE code = 'admin.audit.read';`);
    const before = (await db.query('SELECT count(*)::int AS n FROM public.app_role_permissions')).rows[0].n;
    await rejectedGrant(/belum lengkap/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.app_role_permissions')).rows[0].n, before);
    await db.exec(permissionSql);
    await db.exec(grantSql);
  });

  await verify('bootstrap requires the intended confirmed active identity and an active system role with ALL scope', async () => {
    await db.query("UPDATE public.app_users SET status = 'INACTIVE' WHERE id = $1", [manager]);
    await rejectedGrant(/itadmin aktif/);
    await db.query("UPDATE public.app_users SET status = 'ACTIVE' WHERE id = $1", [manager]);
    await db.query('UPDATE auth.users SET email_confirmed_at = NULL WHERE id = $1', [manager]);
    await rejectedGrant(/itadmin aktif/);
    await db.query("UPDATE auth.users SET email_confirmed_at = now(), email = 'wrong@example.invalid' WHERE id = $1", [manager]);
    await rejectedGrant(/itadmin aktif/);
    await db.query("UPDATE auth.users SET email = 'bpfbesakih@gmail.com' WHERE id = $1", [manager]);
    await db.exec("UPDATE public.app_roles SET is_active = false WHERE code = 'SUPER_ADMIN'");
    await rejectedGrant(/itadmin aktif/);
    await db.exec("UPDATE public.app_roles SET is_active = true WHERE code = 'SUPER_ADMIN'");
    await db.exec(`UPDATE public.app_user_roles SET scope_kind = 'SELF' WHERE user_id = '${manager}'
      AND role_id = (SELECT id FROM public.app_roles WHERE code = 'SUPER_ADMIN')`);
    await rejectedGrant(/itadmin aktif/);
    await db.exec(`UPDATE public.app_user_roles SET scope_kind = 'ALL' WHERE user_id = '${manager}'
      AND role_id = (SELECT id FROM public.app_roles WHERE code = 'SUPER_ADMIN')`);
  });

  await verify('the backend can read the catalog while account flags and all 157 staging rows remain intact', async () => {
    assert.equal((await asRole('service_role', null, 'SELECT count(*)::int AS n FROM public.app_permissions')).rows[0].n, 44);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM import_staging.employee_candidates')).rows[0].n, 157);
    await denied(asRole('authenticated', manager, 'SELECT * FROM import_staging.employee_candidates'));
    assert.deepEqual((await db.query('SELECT status, must_change_password FROM public.app_users WHERE id = $1', [manager])).rows, [
      { status: 'ACTIVE', must_change_password: true },
    ]);
    assert.deepEqual(await visiblePermissions(manager), adminPermissions);
  });

  await verify('dashboard read-only checks show six manager permissions and none without an identity', async () => {
    const managerResults = await db.exec(sqlFile('checks/check-itadmin-permissions.sql'));
    const managerPermissions = managerResults.find((result) => result.fields.some((field) => field.name === 'izin'));
    assert.ok(managerPermissions, 'Manager check must return the permission result');
    assert.deepEqual(managerPermissions.rows.map((row) => row.izin), adminPermissions);

    const missingIdentityResults = await db.exec(sqlFile('checks/check-permissions-without-user.sql'));
    const missingIdentityCount = missingIdentityResults.find((result) => result.fields.some((field) => field.name === 'izin_tanpa_identitas'));
    assert.ok(missingIdentityCount, 'Missing-identity check must return the count result');
    assert.deepEqual(missingIdentityCount.rows, [{ izin_tanpa_identitas: 0 }]);
  });

  console.log(`${checks} PostgreSQL permission checks passed in memory. No real data was accessed.`);
} finally { await db.close(); }
