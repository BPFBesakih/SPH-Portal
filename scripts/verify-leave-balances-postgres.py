"""Integration checks against the dedicated loopback-only leave test cluster.
Uses a private approved import directory; no employee data is embedded in source.
"""
import argparse
import json
import os
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--import-dir", required=True)
parser.add_argument("--port", default="55439")
parser.add_argument("--database", default="postgres", help="Fresh database in the dedicated local test cluster")
args = parser.parse_args()
base = pathlib.Path(args.import_dir).resolve()
root = pathlib.Path(__file__).resolve().parents[1]
psql = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
command = [psql,"-h","127.0.0.1","-p",args.port,"-U","leave_test","-d",args.database,"-X","-v","ON_ERROR_STOP=1","-At"]
env = dict(os.environ,PGCLIENTENCODING="UTF8")
checks = []

def run(sql=None, file=None, fail=False):
    result = subprocess.run(command + (["-f",str(file)] if file else ["-c",sql]),
                            text=True,capture_output=True,encoding="utf-8",env=env)
    if fail:
        assert result.returncode != 0, "Expected rejection"
    elif result.returncode:
        raise RuntimeError(result.stderr[-2500:])
    return result.stdout.strip()

def check(name, condition):
    assert condition, name
    checks.append(name)
    print("PASS " + name)

def scalar(sql):
    return run(sql).splitlines()[-1]

actual = pathlib.Path(scalar("SHOW data_directory")).resolve()
expected = root.parent / "tmp" / "leave-postgres"
assert actual == expected.resolve(), "Refusing a database outside the dedicated local test cluster"
backup = json.loads((base/"production-before.json").read_text(encoding="utf-8"))
approved = json.loads((base/"approved-batch.json").read_text(encoding="utf-8"))
payload = approved["payload"]
literal = lambda value: "'" + value.replace("'","''") + "'"
fixture = """
SET client_encoding='UTF8';
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END$$;
CREATE SCHEMA portal;
CREATE TABLE portal.employees (
 id text PRIMARY KEY,employee_no text NOT NULL UNIQUE,full_name text NOT NULL,employment_status text NOT NULL,
 is_active integer NOT NULL,joined_on text NOT NULL,ended_on text,phone text,email text,
 created_at text NOT NULL,updated_at text NOT NULL,row_version integer NOT NULL,created_by uuid
);
CREATE TABLE public.app_users(id uuid PRIMARY KEY,status text);
INSERT INTO public.app_users VALUES(gen_random_uuid(),'ACTIVE');
CREATE TABLE portal.employee_placements(id text PRIMARY KEY,employee_id text);
INSERT INTO portal.employee_placements VALUES('fixture-placement','fixture-employee');
CREATE TABLE portal.audit_events(
 id text PRIMARY KEY,actor_user_id uuid,action text NOT NULL,object_type text NOT NULL,object_key text NOT NULL,
 occurred_at text NOT NULL,outcome text NOT NULL,request_id text NOT NULL,reason text,change_summary text,ip_address text,
 created_at text NOT NULL,updated_at text NOT NULL,row_version integer NOT NULL
);
CREATE TABLE public.leave_fixture_control(key text PRIMARY KEY,value text);
"""
fixture += "\nINSERT INTO portal.employees SELECT * FROM jsonb_populate_recordset(NULL::portal.employees,"+literal(json.dumps(backup["employee_rows"],ensure_ascii=False))+"::jsonb);\n"
(base/"test-fixture.sql").write_text(fixture,encoding="utf-8")
run(file=base/"test-fixture.sql")
check("seeded master matches exact production employee fingerprint",
      scalar("SELECT md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) FROM portal.employees e")==backup["employee_fingerprint"])
for key, table in [("accounts","public.app_users"),("placements","portal.employee_placements")]:
    run("INSERT INTO public.leave_fixture_control SELECT "+literal(key)+",md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) FROM "+table+" e")

migration = next((root/"supabase/migrations").glob("*_leave_balances_and_annual_maintenance.sql"))
run(file=migration)
tables = ["leave_import_batches","leave_import_rows","leave_year_balances","leave_balance_events"]
for table in tables:
    check(table+" is private with RLS and no client grants",
        scalar("SELECT relrowsecurity AND NOT has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE')"
          " AND NOT has_table_privilege('authenticated',oid,'SELECT,INSERT,UPDATE,DELETE')"
          " AND NOT has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')"
          " FROM pg_class WHERE oid='portal."+table+"'::regclass")=="t")
check("maintenance is invoker-only and not callable by API roles",
      scalar("SELECT NOT prosecdef AND NOT has_function_privilege('anon',oid,'EXECUTE')"
             " AND NOT has_function_privilege('authenticated',oid,'EXECUTE')"
             " AND NOT has_function_privilege('service_role',oid,'EXECUTE')"
             " FROM pg_proc WHERE oid='portal.run_leave_year_maintenance()'::regprocedure")=="t")

import_sql = (base/"approved-import.sql").read_text(encoding="utf-8")
for key in ["accounts","placements"]:
    import_sql = import_sql.replace(literal(backup[key+"_fingerprint"]),
         "(SELECT value FROM public.leave_fixture_control WHERE key="+literal(key)+")")
test_import = base/"test-import.sql"
test_import.write_text(import_sql,encoding="utf-8")
run("ALTER TABLE portal.leave_balance_events ADD CONSTRAINT fixture_fail CHECK(false)")
run(file=test_import,fail=True)
check("failed ledger write rolls back batch, all balances, audit and both names",
      scalar("SELECT (SELECT count(*) FROM portal.leave_import_batches)=0 AND (SELECT count(*) FROM portal.leave_year_balances)=0"
             " AND (SELECT count(*) FROM portal.audit_events)=0 AND "
             "(SELECT md5(string_agg(to_jsonb(e)::text,'' ORDER BY id)) FROM portal.employees e)="+literal(backup["employee_fingerprint"]))=="t")
run("ALTER TABLE portal.leave_balance_events DROP CONSTRAINT fixture_fail")
correction_employee = payload["master_corrections"][0]["employee_no"]
run("UPDATE portal.employees SET row_version=row_version+1 WHERE employee_no="+literal(correction_employee))
run(file=test_import,fail=True)
check("stale master rejects the entire batch",scalar("SELECT count(*)=0 FROM portal.leave_import_batches")=="t")
run("UPDATE portal.employees SET row_version=row_version-1 WHERE employee_no="+literal(correction_employee))
run(file=test_import)
check("approved import creates 152 balances totaling 781 with 156 source decisions",
      scalar("SELECT (SELECT count(*) FROM portal.leave_year_balances)=152 AND"
             " (SELECT sum(remaining_days) FROM portal.leave_year_balances)=781 AND"
             " (SELECT count(*) FROM portal.leave_import_rows)=156 AND"
             " (SELECT count(*) FROM portal.leave_import_rows WHERE disposition='EXCLUDED_INACTIVE')=4"
             " AND (SELECT count(*) FROM portal.audit_events)=3")=="t")
run(file=test_import)
check("repeated import preserves balances, events and exactly three audit records",
      scalar("SELECT (SELECT count(*) FROM portal.leave_balance_events)=152 AND"
             " (SELECT sum(remaining_days) FROM portal.leave_year_balances)=781 AND"
             " (SELECT count(*) FROM portal.audit_events)=3")=="t")
conflict = base/"test-conflicting-import.sql"
conflict.write_text(import_sql.replace(approved["payload_sha256"],"0"*64),encoding="utf-8")
run(file=conflict,fail=True)
check("same batch with different payload is rejected",scalar("SELECT count(*)=1 FROM portal.leave_import_batches")=="t")
names_correct = all(scalar("SELECT EXISTS(SELECT 1 FROM portal.employees WHERE id="+literal(c["employee_id"])+
                          " AND full_name="+literal(c["proposed_name"])+")")=="t"
                    for c in payload["master_corrections"])
check("THL excluded, non-THL zero retained and confirmed name corrections applied",
      scalar("SELECT NOT EXISTS(SELECT 1 FROM portal.leave_year_balances b JOIN portal.employees e ON e.id=b.employee_id"
             " WHERE e.employment_status='Tenaga Harian Lepas' OR e.is_active<>1)"
             " AND (SELECT count(*) FROM portal.leave_year_balances WHERE remaining_days=0)=24")=="t" and names_correct)

future = r"""
BEGIN;
CREATE OR REPLACE FUNCTION portal.leave_business_date() RETURNS date LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog AS $$SELECT DATE '2026-10-30'$$;
DO $$BEGIN
 IF (portal.run_leave_year_maintenance()->>'credited_employees')::int<>0
    OR (SELECT count(*) FROM portal.leave_year_balances)<>152 THEN RAISE EXCEPTION 'Unexpected 2026 grant'; END IF;
END$$;
CREATE OR REPLACE FUNCTION portal.leave_business_date() RETURNS date LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog AS $$SELECT DATE '2027-01-01'$$;
DO $$BEGIN
 IF (portal.run_leave_year_maintenance()->>'credited_employees')::int<>152 THEN RAISE EXCEPTION 'January grant count'; END IF;
 IF (portal.run_leave_year_maintenance()->>'credited_employees')::int<>0 THEN RAISE EXCEPTION 'Duplicate January credit'; END IF;
 IF (SELECT sum(available_days) FROM portal.leave_effective_balances)<>2605 THEN RAISE EXCEPTION 'January carry and new balance'; END IF;
 IF EXISTS(SELECT 1 FROM portal.leave_year_balances b JOIN portal.employees e ON e.id=b.employee_id
    WHERE b.balance_year=2027 AND (e.is_active<>1 OR e.employment_status='Tenaga Harian Lepas')) THEN RAISE EXCEPTION 'Ineligible grant'; END IF;
END$$;
-- Simulate consumption to prove expiry removes only unspent days.
UPDATE portal.leave_year_balances SET remaining_days=remaining_days-2,consumed_days=consumed_days+2
 WHERE (employee_id,balance_year)=(SELECT employee_id,balance_year FROM portal.leave_year_balances WHERE balance_year=2026 AND remaining_days>=2 ORDER BY employee_id LIMIT 1);
UPDATE portal.leave_year_balances SET remaining_days=remaining_days-3,consumed_days=consumed_days+3
 WHERE (employee_id,balance_year)=(SELECT employee_id,balance_year FROM portal.leave_year_balances WHERE balance_year=2027 ORDER BY employee_id LIMIT 1);
CREATE OR REPLACE FUNCTION portal.leave_business_date() RETURNS date LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog AS $$SELECT DATE '2027-03-31'$$;
DO $$BEGIN
 IF (SELECT sum(available_days) FROM portal.leave_effective_balances WHERE balance_year=2026)<>779 THEN RAISE EXCEPTION 'March balance expired too early'; END IF;
END$$;
CREATE OR REPLACE FUNCTION portal.leave_business_date() RETURNS date LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER SET search_path=pg_catalog AS $$SELECT DATE '2027-04-01'$$;
DO $$DECLARE result jsonb; BEGIN
 IF (SELECT sum(available_days) FROM portal.leave_effective_balances WHERE balance_year=2026)<>0 THEN RAISE EXCEPTION 'Read expiry depends on scheduler'; END IF;
 result:=portal.run_leave_year_maintenance();
 IF (result->>'expired_buckets')::int<>152 OR (result->>'expired_days')::int<>779 THEN RAISE EXCEPTION 'Expired wrong remainder'; END IF;
 IF (SELECT sum(available_days) FROM portal.leave_effective_balances WHERE balance_year=2027)<>1821 THEN RAISE EXCEPTION 'Current-year balance affected by expiry'; END IF;
 IF (portal.run_leave_year_maintenance()->>'expired_buckets')::int<>0 THEN RAISE EXCEPTION 'Duplicate expiry'; END IF;
END$$;
DO $$DECLARE target text; BEGIN
 SELECT employee_id INTO target FROM portal.leave_year_balances WHERE balance_year=2027 ORDER BY employee_id LIMIT 1;
 UPDATE portal.employees SET employment_status='Tenaga Harian Lepas' WHERE id=target;
 IF EXISTS(SELECT 1 FROM portal.leave_effective_balances WHERE employee_id=target AND available_days<>0) THEN RAISE EXCEPTION 'THL effective balance'; END IF;
 UPDATE portal.employees SET employment_status='Pegawai Kontrak (PKWT)',is_active=0 WHERE id=target;
 IF EXISTS(SELECT 1 FROM portal.leave_effective_balances WHERE employee_id=target AND available_days<>0) THEN RAISE EXCEPTION 'Inactive effective balance'; END IF;
END$$;
DO $$BEGIN
 IF ('2027-03-31T15:59:59Z'::timestamptz AT TIME ZONE 'Asia/Makassar')::date<>DATE '2027-03-31'
 OR ('2027-03-31T16:00:00Z'::timestamptz AT TIME ZONE 'Asia/Makassar')::date<>DATE '2027-04-01' THEN RAISE EXCEPTION 'WITA boundary'; END IF;
END$$;
ROLLBACK;
"""
(base/"test-future.sql").write_text(future,encoding="utf-8")
run(file=base/"test-future.sql")
check("future dates: no 2026 credit, January exactly once, March carry, April remainder-only expiry, WITA boundary and status revocation",True)
check("future-date tests rolled back, restoring 2026 opening only",
      scalar("SELECT count(*)=152 AND sum(remaining_days)=781 FROM portal.leave_year_balances")=="t")
(base/"postgres-test-results.json").write_text(json.dumps({"checks":checks,"passed":len(checks),
    "database":"isolated local PostgreSQL 18.6","production_writes":False},indent=2)+"\n",encoding="utf-8")
print(str(len(checks))+" PostgreSQL integration checks passed.")
