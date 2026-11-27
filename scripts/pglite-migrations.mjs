// Menyiapkan migrasi produksi agar bisa dijalankan di PGlite untuk verifikasi lokal/CI.
// PGlite tidak menyediakan ekstensi pg_cron, padahal migrasi pergantian tahun cuti
// (20261030020230) mendaftarkan job lewat cron.schedule(). Berkas migrasi produksi tidak
// diubah: di PGlite saja, CREATE/COMMENT EXTENSION pg_cron diganti schema `cron` tiruan
// yang mencatat job ke tabel cron.job, sehingga pendaftaran job tetap bisa diperiksa.
import {readFileSync,readdirSync} from 'node:fs';

const cronShim=`CREATE SCHEMA IF NOT EXISTS cron;
CREATE TABLE IF NOT EXISTS cron.job(jobid bigserial PRIMARY KEY,jobname text UNIQUE,schedule text NOT NULL,command text NOT NULL);
CREATE OR REPLACE FUNCTION cron.schedule(job_name text,schedule text,command text) RETURNS bigint LANGUAGE sql AS $shim$
 INSERT INTO cron.job(jobname,schedule,command) VALUES(job_name,schedule,command)
 ON CONFLICT(jobname) DO UPDATE SET schedule=EXCLUDED.schedule,command=EXCLUDED.command RETURNING jobid
$shim$;
`;
const createCron=/^\s*CREATE EXTENSION IF NOT EXISTS pg_cron\b[^;]*;\s*$/im;
const commentCron=/^\s*COMMENT ON EXTENSION pg_cron\b[^;]*;\s*$/im;

export function pgliteSql(sql){
 if(!createCron.test(sql))return sql;
 return sql.replace(createCron,cronShim).replace(commentCron,'-- COMMENT ON EXTENSION pg_cron dilewati di PGlite.');
}

export function migrationSql(directory,name){
 return pgliteSql(readFileSync(new URL(name,directory),'utf8'));
}

export function migrationNames(directory,filter=()=>true){
 return readdirSync(directory).filter(n=>n.endsWith('.sql')&&filter(n)).sort();
}
