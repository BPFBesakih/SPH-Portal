import {readFileSync,writeFileSync} from 'node:fs';
const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
const stamp=`to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const shared={users:'app_users',roles:'app_roles',permissions:'app_permissions',user_roles:'app_user_roles',role_permissions:'app_role_permissions'};
const excluded=new Set([...Object.keys(shared),'schema_migrations','auth_sessions']);
const foreignKeys=[],caseIndexes=[],tables=[];
let output=`-- Generated from schema.sql by scripts/generate-cloud-schema.mjs.\n-- Does not read or publish the local SQLite database. Apply after migrations 001–008.\nBEGIN;\nCREATE SCHEMA IF NOT EXISTS portal;\nREVOKE ALL ON SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;\nSET LOCAL search_path=portal,pg_catalog;\n`;
for(const match of schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\);/g)){
 const [,table,body]=match;if(excluded.has(table))continue;tables.push(table);
 let ddl=body.replace(/\bREAL\b/g,'DOUBLE PRECISION').replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/g,stamp);
 ddl=ddl.replace(/(\b([a-z_]\w*)\s+TEXT)([^,\n]*?)\s+REFERENCES (\w+)\(id\)( ON DELETE (?:CASCADE|RESTRICT|SET NULL))?/g,(_,type,column,middle,target,policy='')=>{
  foreignKeys.push({table,column,target,policy});return `${column} ${shared[target]?'UUID':'TEXT'}${middle}`;
 });
 ddl=ddl.replace(/(\b([a-z_]\w*)\s+TEXT[^,\n]*?) COLLATE NOCASE/g,(_,before,column)=>{caseIndexes.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_${column}_folded ON portal.${table}(lower(${column}));`);return before;});
 output+=`CREATE TABLE IF NOT EXISTS portal.${table} (${ddl});\n`;
}
output+=`\nALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS employee_id TEXT UNIQUE;\nALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS last_login_at TEXT;\nALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS password_changed_at TEXT;\nALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.app_users(id);\nALTER TABLE public.app_roles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.app_users(id);\n`;
foreignKeys.push({table:'app_users',column:'employee_id',target:'employees',policy:'',public:true});
for(const f of foreignKeys){
 const table=f.public?`public.${f.table}`:`portal.${f.table}`,target=shared[f.target]?`public.${shared[f.target]}`:`portal.${f.target}`;
 output+=`DO $fk$ BEGIN ALTER TABLE ${table} ADD CONSTRAINT ${f.table}_${f.column}_fk FOREIGN KEY (${f.column}) REFERENCES ${target}(id)${f.policy}; EXCEPTION WHEN duplicate_object THEN NULL; END $fk$;\n`;
}
for(const match of schema.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS [^;]+;/g))output+=match[0].replace(/ ON (\w+)\(/,' ON portal.$1(')+'\n';
output+=caseIndexes.join('\n')+'\n';
const iso=column=>`to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const common=`${iso('created_at')} created_at,${iso('updated_at')} updated_at,row_version::integer row_version`;
output+=`CREATE OR REPLACE VIEW portal.users AS SELECT id,username,employee_id,status,must_change_password::integer must_change_password,last_login_at,password_changed_at,${common},created_by FROM public.app_users;\n`;
output+=`CREATE OR REPLACE VIEW portal.roles AS SELECT id,code,name,description,is_system::integer is_system,is_active::integer is_active,${common},created_by FROM public.app_roles;\n`;
output+=`CREATE OR REPLACE VIEW portal.permissions AS SELECT id,code,module_code,resource,action,description,${common} FROM public.app_permissions;\n`;
output+=`CREATE OR REPLACE VIEW portal.user_roles AS SELECT id,user_id,role_id,scope_kind,${common} FROM public.app_user_roles;\n`;
output+=`CREATE OR REPLACE VIEW portal.role_permissions AS SELECT role_id,permission_id,${iso('created_at')} created_at FROM public.app_role_permissions;\n`;
// PostgreSQL cannot automatically update cast columns in a view. These private
// adapters preserve the public account/role tables as the single authority.
output+=`CREATE OR REPLACE FUNCTION portal.write_identity_view() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $view$\nDECLARE target text; data jsonb; cols text; assignments text; predicate text;\nBEGIN\n IF TG_TABLE_SCHEMA<>'portal' THEN RAISE EXCEPTION 'Invalid view'; END IF;\n target:=CASE TG_TABLE_NAME WHEN 'users' THEN 'app_users' WHEN 'roles' THEN 'app_roles' WHEN 'permissions' THEN 'app_permissions' WHEN 'user_roles' THEN 'app_user_roles' WHEN 'role_permissions' THEN 'app_role_permissions' END;\n IF target IS NULL THEN RAISE EXCEPTION 'Invalid view'; END IF;\n data:=to_jsonb(CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END);\n IF TG_TABLE_NAME='users' THEN data:=jsonb_set(data,'{must_change_password}',to_jsonb((data->>'must_change_password')::integer<>0)); END IF;\n IF TG_TABLE_NAME='roles' THEN data:=jsonb_set(jsonb_set(data,'{is_active}',to_jsonb((data->>'is_active')::integer<>0)),'{is_system}',to_jsonb((data->>'is_system')::integer<>0)); END IF;\n predicate:=CASE WHEN TG_TABLE_NAME='role_permissions' THEN 't.role_id=r.role_id AND t.permission_id=r.permission_id' ELSE 't.id=r.id' END;\n IF TG_OP='INSERT' THEN\n  SELECT string_agg(format('%I',key),',') INTO cols FROM jsonb_each(data) WHERE value<>'null'::jsonb;\n  EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1)',target,cols,cols,target) USING data;\n ELSIF TG_OP='UPDATE' THEN\n  SELECT string_agg(format('%I=r.%I',key,key),',') INTO assignments FROM jsonb_each(data) WHERE key<>'id';\n  EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE %s',target,assignments,target,predicate) USING data;\n ELSE\n  EXECUTE format('DELETE FROM public.%I t USING jsonb_populate_record(NULL::public.%I,$1) r WHERE %s',target,target,predicate) USING data;\n  RETURN OLD;\n END IF;\n RETURN NEW;\nEND $view$;\n`;
for(const view of Object.keys(shared))output+=`DROP TRIGGER IF EXISTS write_identity ON portal.${view};\nCREATE TRIGGER write_identity INSTEAD OF INSERT OR UPDATE OR DELETE ON portal.${view} FOR EACH ROW EXECUTE FUNCTION portal.write_identity_view();\n`;
output+=`CREATE OR REPLACE FUNCTION portal.reject_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $history$ BEGIN RAISE EXCEPTION 'History append-only' USING ERRCODE='23514'; END $history$;\n`;
for(const table of ['audit_events','incident_updates'])output+=`DROP TRIGGER IF EXISTS append_only ON portal.${table};\nCREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON portal.${table} FOR EACH ROW EXECUTE FUNCTION portal.reject_history_change();\n`;
for(const table of tables)output+=`ALTER TABLE portal.${table} ENABLE ROW LEVEL SECURITY;\n`;
output+=`REVOKE ALL ON ALL TABLES IN SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal FROM PUBLIC,anon,authenticated,service_role;\nALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated,service_role;\nALTER DEFAULT PRIVILEGES IN SCHEMA portal REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;\nINSERT INTO portal.app_settings VALUES('allow_gap_publication','false'),('demo_mode','false') ON CONFLICT DO NOTHING;\n`;
// Seed role templates without granting any new assignment to any user. Existing
// SUPER_ADMIN keeps the six explicit administration permissions already given.
const resources={ 'hr.employees':['read','create','update','export'],'hr.organization':['read','manage'],'hr.employee_files':['read','manage'],'hr.documents':['read','manage','publish','download'],'hr.training':['read','manage','participants','download'],'hr.coaching':['read','create','update','manage'],'security.config':['read','manage'],'security.roster':['read','generate','edit','publish','acknowledge','export'],'security.logbook':['read','create','update','download'],'security.incidents':['read','create','update','reopen','download'],'admin.users':['read','manage','reset'],'admin.roles':['read','manage'],'admin.audit':['read']};
for(const [resource,actions] of Object.entries(resources))for(const action of actions)output+=`INSERT INTO public.app_permissions(code,module_code,resource,action) VALUES('${resource}.${action}','${resource.split('.')[0]}','${resource}','${action}') ON CONFLICT(code) DO NOTHING;\n`;
for(const [code,name,predicate] of [['SDM','Pengelola SDM',"code LIKE 'hr.%'"],['COORDINATOR','Koordinator Keamanan',"code LIKE 'security.%' OR code IN ('hr.documents.read','hr.documents.download')"],['OFFICER','Petugas Keamanan',"code IN ('security.roster.read','security.logbook.read','security.logbook.create','security.logbook.download','security.incidents.read','security.incidents.create','security.incidents.download','hr.documents.read','hr.documents.download')"],['EMPLOYEE','Pegawai',"code IN ('hr.employees.read','hr.training.read','hr.training.download','hr.coaching.read','hr.coaching.update','hr.documents.read','hr.documents.download')"]]){
 output+=`WITH added AS (INSERT INTO public.app_roles(code,name) VALUES('${code}','${name}') ON CONFLICT(code) DO NOTHING RETURNING id) INSERT INTO public.app_role_permissions(role_id,permission_id) SELECT a.id,p.id FROM added a CROSS JOIN public.app_permissions p WHERE ${predicate} ON CONFLICT DO NOTHING;\n`;
}
output+=`INSERT INTO portal.import_candidates(id,full_name,position_name,org_path,source_cell,source_name,status,notes,created_at,updated_at,row_version)
 SELECT i.id::text,i.full_name,coalesce((SELECT string_agg(p->>'name','; ' ORDER BY p->>'name') FROM jsonb_array_elements(i.positions) p),'Belum ditetapkan'),
 coalesce((SELECT string_agg(p->>'org_path','; ' ORDER BY p->>'org_path') FROM jsonb_array_elements(i.positions) p),'Belum ditetapkan'),
 (SELECT string_agg(c,'; ' ORDER BY c) FROM jsonb_array_elements_text(i.source_cells) c),i.source_name,'PENDING',i.notes,
 to_char(i.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),${stamp},1
 FROM import_staging.employee_candidates i WHERE i.status='PENDING' ON CONFLICT DO NOTHING;\n`;
output+=`NOTIFY pgrst,'reload schema';\nCOMMIT;\nSELECT count(*) AS operational_tables FROM pg_catalog.pg_tables WHERE schemaname='portal';\n`;
writeFileSync(new URL('../supabase/migrations/20261016000900_operational_modules.sql',import.meta.url),output);
console.log(`Generated ${tables.length} private operational tables, five identity views and ${foreignKeys.length} foreign keys.`);
