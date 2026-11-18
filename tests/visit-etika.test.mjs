// Etika −10..+10 menggantikan teguran perilaku (keputusan pemilik 17 November 2026).
// Basis data lokal (SQLite) yang dibuat dengan batas lama −5..+5 dilonggarkan saat dibuka.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {openDb,insert,one} from '../lib/db.mjs';
import {visitScoreOf} from '../lib/visit-data.mjs';
import {ruleFinder,defaultScoreRule} from '../lib/visit-scoring.mjs';

const row=(id,etika,extra={})=>({id,pos:1,guide_id:'G-001',guide_name:'Guide Fiktif',uniform:1,id_card:1,review:0,etika,catatan:'',
 evaluated_at:'2026-11-17T01:00:00.000Z',wita_date:'2026-11-17',received_at:'2026-11-17T01:00:05.000Z',status:'aktif',...extra});
const put=(db,r)=>db.prepare(`INSERT INTO visit_evaluations(${Object.keys(r).join(',')}) VALUES(${Object.keys(r).map(()=>'?').join(',')})`).run(...Object.values(r));
const evaluationsSql=db=>one(db,"SELECT sql FROM sqlite_schema WHERE type='table' AND name='visit_evaluations'").sql;

test('basis data lokal lama: batas Etika −5..+5 dilonggarkan menjadi −10..+10 tanpa mengubah data',t=>{
  const dir=mkdtempSync(resolve(tmpdir(),'sph-etika-')),path=resolve(dir,'portal.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  let db=openDb(path);
  assert.match(evaluationsSql(db),/etika BETWEEN -10 AND 10/,'instalasi baru langsung memakai batas baru');
  // Kembalikan teks skema ke batas lama, seperti basis data yang dibuat sebelum rilis ini.
  const version=Number(db.prepare('PRAGMA schema_version').get().schema_version);
  db.exec('BEGIN');db.exec('PRAGMA writable_schema=ON');
  db.prepare("UPDATE sqlite_schema SET sql=replace(sql,'etika BETWEEN -10 AND 10','etika BETWEEN -5 AND 5') WHERE type='table' AND name='visit_evaluations'").run();
  db.exec(`PRAGMA schema_version=${version+1}`);db.exec('PRAGMA writable_schema=OFF');db.exec('COMMIT');
  insert(db,'visit_guides',{id:'G-001',seq:1,name:'Guide Fiktif',kategori:'Asing',regu:'A1',is_active:1});
  const lama=crypto.randomUUID();put(db,row(lama,-5));
  assert.throws(()=>put(db,row(crypto.randomUUID(),9)),/CHECK constraint failed/,'batas lama masih berlaku sebelum dibuka ulang');
  db.close();
  db=openDb(path);t.after(()=>db.close());
  assert.match(evaluationsSql(db),/etika BETWEEN -10 AND 10/);assert.doesNotMatch(evaluationsSql(db),/etika BETWEEN -5 AND 5/);
  for(const etika of [-10,10])put(db,row(crypto.randomUUID(),etika));
  for(const etika of [-11,11])assert.throws(()=>put(db,row(crypto.randomUUID(),etika)),/CHECK constraint failed/,`Etika ${etika}`);
  assert.equal(one(db,'SELECT etika FROM visit_evaluations WHERE id=?',lama).etika,-5,'baris lama utuh');
  assert.equal(Object.values(one(db,'PRAGMA integrity_check'))[0],'ok');
  // Dibuka sekali lagi: tidak diubah lagi.
  const before=evaluationsSql(db);db.close();db=openDb(path);assert.equal(evaluationsSql(db),before);
});

test('nilai pengantaran = 100 − potongan + Etika; Etika plus boleh di atas 100',()=>{
  const ruleOf=ruleFinder([defaultScoreRule]),v2=(seragam,idCard,etika)=>({versi:2,seragam,uniform:seragam==='lengkap'?1:-1,id_card:idCard,etika,wita_date:'2026-11-17'});
  assert.equal(visitScoreOf(v2('lengkap',1,0),ruleOf),100);
  assert.equal(visitScoreOf(v2('lengkap',1,10),ruleOf),110);
  assert.equal(visitScoreOf(v2('kurang',0,-3),ruleOf),100-20-10-3);
  assert.equal(visitScoreOf(v2('tidak',0,-10),ruleOf),50,'nilai terendah dengan aturan bawaan');
  // Formulir 2.2 menyimpan −jumlah teguran di kolom etika: dihitung Etika −1 per teguran.
  assert.equal(visitScoreOf({...v2('lengkap',1,-2),teguran:'antrean,merokok-hp',teguran_n:2},ruleOf),98);
  // Cara lama: Uniform −1 = tidak berseragam, Etika apa adanya.
  assert.equal(visitScoreOf({versi:1,uniform:-1,id_card:1,etika:-1,wita_date:'2026-11-17'},ruleOf),79);
});
