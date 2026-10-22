import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const now = () => new Date().toISOString();
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
export const uid = () => randomUUID();
export class AppError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
export const assert = (condition, message, status = 422) => { if (!condition) throw new AppError(status, message); };
export function openDb(path = resolve(process.env.DATA_DIR || 'data', 'portal.sqlite')) {
  if (path !== ':memory:') mkdirSync(resolve(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const schema=readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  db.exec(schema);
  // Version 2 preserves relationship creation times on installations initialized with v1.
  const relationshipParents={role_permissions:['roles','role_id'],user_role_units:['user_roles','user_role_id'],user_role_posts:['user_roles','user_role_id'],document_target_units:['documents','document_id'],scheduling_period_posts:['scheduling_periods','scheduling_period_id']};
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const [table,[parent,key]] of Object.entries(relationshipParents)) {
      if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='created_at')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN created_at TEXT`);
        db.exec(`UPDATE ${table} SET created_at=coalesce((SELECT created_at FROM ${parent} WHERE id=${table}.${key}),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
        db.exec(`CREATE TRIGGER ${table}_creation_time AFTER INSERT ON ${table} WHEN NEW.created_at IS NULL BEGIN UPDATE ${table} SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE rowid=NEW.rowid; END`);
      }
    }
    db.exec("INSERT OR IGNORE INTO schema_migrations VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now')); COMMIT");
  }catch(error){db.exec('ROLLBACK');db.close();throw error;}
  // Rebuild only the two report tables to relax legacy post/initial-action constraints.
  // Keep original table names throughout so existing child foreign keys remain valid.
  if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=3').get()) {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      for(const table of ['logbook_entries','incidents']) {
        const oldColumns=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
        const ddl=schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?;`))[0];
        db.exec(ddl.replace(`IF NOT EXISTS ${table}`,`${table}_mvp3`));
        db.exec(`INSERT INTO ${table}_mvp3 (${oldColumns.join(',')}) SELECT ${oldColumns.join(',')} FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_mvp3 RENAME TO ${table}`);
      }
      for(const table of ['logbook_files','incident_files'])for(const column of ['captured_at','capture_source']) {
        if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
      db.exec("INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r JOIN permissions p ON p.code IN ('security.logbook.download','security.incidents.download') WHERE r.code='OFFICER'");
      const violations=db.prepare('PRAGMA foreign_key_check').all();
      if(violations.length)throw new Error('Migrasi laporan gagal: relasi data tidak konsisten.');
      db.exec("INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now')); COMMIT");
    }catch(error){db.exec('ROLLBACK');db.close();throw error;}
    db.exec('PRAGMA foreign_keys=ON');
  }
  // Preserve existing agendas and materials when adding deletion and photo documentation.
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const [table,column,definition] of [
      ['training_events','deleted_at','TEXT'],
      ['training_events','deleted_by','TEXT REFERENCES users(id)'],
      ['training_materials','usage_kind',"TEXT NOT NULL DEFAULT 'MATERIAL' CHECK(usage_kind IN('MATERIAL','DOCUMENTATION') AND (usage_kind='MATERIAL' OR file_id IS NOT NULL))"]
    ])if(!db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    db.exec("INSERT OR IGNORE INTO schema_migrations VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now')); COMMIT");
  }catch(error){db.exec('ROLLBACK');db.close();throw error;}
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const [column,definition] of [['report_source',"TEXT NOT NULL DEFAULT 'PORTAL' CHECK(report_source IN('PORTAL','PUBLIC_LINK'))"],['report_link_id','TEXT REFERENCES quick_report_links(id)']]){
      if(!db.prepare('PRAGMA table_info(logbook_entries)').all().some(c=>c.name===column))db.exec(`ALTER TABLE logbook_entries ADD COLUMN ${column} ${definition}`);
    }
    db.exec("INSERT OR IGNORE INTO schema_migrations VALUES(5,strftime('%Y-%m-%dT%H:%M:%fZ','now')); COMMIT");
  }catch(error){db.exec('ROLLBACK');db.close();throw error;}
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!db.prepare('PRAGMA table_info(logbook_entries)').all().some(c=>c.name==='location_name'))db.exec('ALTER TABLE logbook_entries ADD COLUMN location_name TEXT');
    db.exec("INSERT OR IGNORE INTO schema_migrations VALUES(6,strftime('%Y-%m-%dT%H:%M:%fZ','now')); COMMIT");
  }catch(error){db.exec('ROLLBACK');db.close();throw error;}
  return db;
}
export const all = (db, sql, ...args) => db.prepare(sql).all(...args);
export const one = (db, sql, ...args) => db.prepare(sql).get(...args);
export const run = (db, sql, ...args) => db.prepare(sql).run(...args);
const sqlName = n => { if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error('Invalid SQL identifier'); return n; };
export function insert(db, table, values) {
  const row = { id: uid(), created_at: now(), updated_at: now(), row_version: 1, ...values };
  const columns = Object.keys(row).map(sqlName);
  run(db, `INSERT INTO ${sqlName(table)} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`, ...Object.values(row).map(v => typeof v === 'boolean' ? Number(v) : v ?? null));
  return one(db, `SELECT * FROM ${table} WHERE id=?`, row.id);
}
export function update(db, table, id, version, values) {
  assert(Number.isInteger(version), 'Versi data wajib dikirim. Muat ulang data.', 409);
  const row = { ...values, updated_at: now() };
  const changed = run(db, `UPDATE ${sqlName(table)} SET ${Object.keys(row).map(k => `${sqlName(k)}=?`).join(',')},row_version=row_version+1 WHERE id=? AND row_version=?`, ...Object.values(row).map(v => typeof v === 'boolean' ? Number(v) : v ?? null), id, version);
  assert(changed.changes === 1, 'Data sudah berubah. Muat ulang sebelum menyimpan.', 409);
  return one(db, `SELECT * FROM ${table} WHERE id=?`, id);
}
export function tx(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function audit(db, actor, action, type, key, summary = {}, reason = '') {
  insert(db, 'audit_events', { actor_user_id: actor?.id || null, action, object_type: type, object_key: String(key), occurred_at: now(), outcome: 'SUCCESS', request_id: actor?.request_id || uid(), reason, change_summary: JSON.stringify(summary) });
}
export function get(db, table, id) {
  const row = one(db, `SELECT * FROM ${sqlName(table)} WHERE id=?`, id);
  assert(row, 'Data tidak ditemukan.', 404);
  return row;
}
export function text(v, label = 'Isian', max = 500) {
  assert(typeof v === 'string' && v.trim().length > 0 && v.length <= max, `${label} wajib diisi (maksimal ${max} karakter).`);
  return v.trim();
}
export function date(v, label = 'Tanggal') {
  assert(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, `${label} tidak valid.`); return v;
}
export function instant(v) { assert(typeof v === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(v) && !isNaN(Date.parse(v)), 'Waktu harus menyertakan zona waktu.'); return new Date(v).toISOString(); }
export function integer(v, label, min = 0, max = 100000) { const n = Number(v); assert(v !== '' && v != null && Number.isInteger(n) && n >= min && n <= max, `${label} harus bilangan bulat ${min}–${max}.`); return n; }
export function enumValue(v, choices, label = 'Status') { assert(choices.includes(v), `${label} tidak valid.`); return v; }
