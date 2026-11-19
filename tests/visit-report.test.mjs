// Laporan harian, mingguan (Senin–Minggu WITA), dan bulanan Kunjungan: rekap periode,
// pembanding periode sebelumnya (sampai jam yang sama bila periode masih berjalan), dan tren per
// jam/hari/minggu/bulan. Setiap angka harus sama persis dengan rekap rentang yang sama
// (visitOverview), termasuk setelah rincian dilipat ke rekap harian.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb,insert,one,all,run,now,today} from '../lib/db.mjs';
import {seedPermissions,hashPasswordSync} from '../lib/auth.mjs';
import {visitRoutes} from '../lib/visits.mjs';
import {visitOverview,visitReport,visitTrend,weekStart,shiftDate,monthLastDay,visitFindingSums,reportRules} from '../lib/visit-data.mjs';

const password=hashPasswordSync('fixture123');
const guides=[['G-001','Guide Fiktif Satu','Asing','A1'],['G-002','Guide Fiktif Dua','Asing','A2',0],['G-003','Guide Fiktif Tiga','Domestik','D1'],['G-004','Guide Fiktif Empat','Domestik','D1, D2'],['G-005','Guide Fiktif Lima','Asing','A2']];
const monday=day=>shiftDate(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
const days=(from,to)=>Math.round((Date.parse(to)-Date.parse(from))/86400000);
const monthOf=(day,n)=>{const d=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7))-1+n,1));return d.toISOString().slice(0,7);};
// Bilangan acak tetap (LCG) supaya data uji sama setiap kali dijalankan.
function random(seed){let s=seed>>>0;return n=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s%n;};}
// Angka yang dibandingkan antara ember tren dan rekap rentang yang sama.
const figureKeys=['pengantaran','nilai','persenId','persenSeragam','tanpaId','kurangLengkap','tidakBerseragam','etika','etikaRata','potongan','guideDinilai','hariDinilai'];
const figures=x=>Object.fromEntries(figureKeys.map(k=>[k,x[k]]));
const overviewFigures=(db,from,to)=>figures(visitOverview(db,from,to).ringkasan);
const stable=x=>JSON.parse(JSON.stringify({...x,diperbarui:null,periode:null,perPetugas:null}));
// Tanpa pembanding (bergantung pada jam pemanggilan), untuk membandingkan rute dengan visitReport.
const withoutComparison=x=>stable({...x,sebelumnya:null,laporan:{...x.laporan,sebelumnya:null}});
// Pukul 10.00 WITA hari ini: rincian uji ada pukul 09.00–11.20, jadi pemotongan jam teruji.
const tenOClock=day=>Date.parse(`${day}T10:00:00+08:00`);
const sameTime=(day,nowMs)=>new Date(Date.parse(`${day}T00:00:00+08:00`)+nowMs-Date.parse(`${new Date(nowMs+8*3600000).toISOString().slice(0,10)}T00:00:00+08:00`)).toISOString();
// Pembanding yang diharapkan: rekap [from,to] setelah rincian hari terakhir sesudah `until`
// disingkirkan sementara (SAVEPOINT, lalu dikembalikan).
function cutFigures(db,from,to,until){
  run(db,'SAVEPOINT pembanding');
  try{run(db,'DELETE FROM visit_evaluations WHERE wita_date=? AND evaluated_at>?',to,until);return overviewFigures(db,from,to);}
  finally{run(db,'ROLLBACK TO pembanding');run(db,'RELEASE pembanding');}
}

function fixture(t){
  const db=openDb(':memory:');t.after(()=>db.close());seedPermissions(db);
  const account=(username,role)=>{const u=insert(db,'users',{username,password_hash:password,status:'ACTIVE',must_change_password:0,failed_login_count:0,password_changed_at:now()});if(role)insert(db,'user_roles',{user_id:u.id,role_id:one(db,'SELECT id FROM roles WHERE code=?',role).id,scope_kind:'ALL'});return u;};
  const itRole=insert(db,'roles',{code:'IT_ADMIN_FIXTURE',name:'IT admin',is_system:0,is_active:1});
  for(const p of all(db,"SELECT id FROM permissions WHERE module_code='admin'"))run(db,'INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)',itRole.id,p.id);
  const users={manager:account('kunjungan','KUNJUNGAN_PENGELOLA'),leader:account('pimpinan','KUNJUNGAN_PIMPINAN'),it:account('itadmin','IT_ADMIN_FIXTURE'),hr:account('sdm','SDM')};
  for(const [id,name,kategori,regu,active=1] of guides)insert(db,'visit_guides',{id,seq:Number(id.slice(2)),name,kategori,regu,is_active:active});
  const route=(user,query)=>visitRoutes({db,user,p:['visits','report'],method:'GET',body:{},url:new URL('https://portal.test/?'+query)});
  return {db,users,route};
}

// Rincian 35 hari terakhir (cara baru dan lama, sebagian dikoreksi), rekap harian portal
// (hasil pelipatan) sebelum itu, dan riwayat NilaiGuide hasil migrasi awal lebih lama lagi.
// Satu bulan memakai aturan potongan berbeda supaya potongan per bulan ikut teruji.
function seed(db,seedValue=7){
  const r=random(seedValue),T=today(),stamp=now();
  for(let back=34;back>=0;back--){
    const day=shiftDate(T,-back);
    for(const g of guides)for(const pos of [1,3]){
      const n=r(3);
      for(let i=0;i<n;i++){
        const v2=r(10)<7,seragam=['lengkap','lengkap','lengkap','kurang','tidak'][r(5)],idCard=r(5)?1:0;
        const evaluatedAt=new Date(Date.parse(`${day}T08:00:00+08:00`)+(pos*60+i*20)*60000).toISOString();
        const row={id:crypto.randomUUID(),pos,guide_id:g[0],guide_name:g[1],id_card:idCard,review:0,catatan:'',evaluated_at:evaluatedAt,wita_date:day,received_at:evaluatedAt,status:'aktif',
          ...(v2?{versi:2,seragam,uniform:seragam==='lengkap'?1:-1,etika:r(7)-3}:{versi:1,uniform:[-1,1,2][r(3)],etika:r(11)-5})};
        // Sebagian sudah dikoreksi: tidak boleh ikut dihitung di mana pun.
        if(!r(8))Object.assign(row,{status:'diganti',replaced_by:crypto.randomUUID()});
        run(db,`INSERT INTO visit_evaluations(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`,...Object.values(row));
      }
    }
  }
  const total=(day,guide,pos,sumber)=>{
    const antar=1+r(4),nId=r(antar+1),nTidak=r(antar+1),nKurang=sumber==='portal'?r(antar-nTidak+1):0;
    run(db,`INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?,?,0)`,
      day,guide,pos,sumber,antar,antar-2*nTidak,antar-nTidak,antar-nId,r(9)-4,stamp,nId,nKurang,nTidak);
  };
  for(let back=120;back>=35;back--)for(const g of guides)for(const pos of [1,3])if(r(3))total(shiftDate(T,-back),g[0],pos,'portal');
  for(let back=420;back>=121;back-=2)for(const g of guides)if(r(2))total(shiftDate(T,-back),g[0],1+2*r(2),'nilaiguide');
  run(db,"INSERT INTO visit_history_import(id,status,terbuka,file_name,file_sha256,rows_total,parts_total,parts_done,ringkasan,created_at,finished_at) VALUES(?,'aktif',1,'NilaiGuide.xlsx',?,10,1,'[0]','{}',?,?)",
    crypto.randomUUID(),'a'.repeat(64),stamp,stamp);
  run(db,'INSERT INTO visit_score_rules(berlaku_mulai,pot_id,pot_kurang,pot_tidak,pot_teguran,ambang,minimal,created_at) VALUES(?,10,10,20,0,98,4,?)',monthOf(shiftDate(T,-90),0),stamp);
  run(db,'INSERT INTO visit_score_rules(berlaku_mulai,pot_id,pot_kurang,pot_tidak,pot_teguran,ambang,minimal,created_at) VALUES(?,20,10,20,0,95,10,?)',monthOf(shiftDate(T,-90),1),stamp);
  return T;
}
// Setiap ember: bersambung tanpa celah, dan angkanya sama dengan rekap rentang ember itu.
function assertBuckets(db,buckets,from,to,label){
  assert.equal(buckets[0].mulai,from,`${label}: ember pertama`);assert.equal(buckets.at(-1).sampai,to,`${label}: ember terakhir`);
  buckets.forEach((b,i)=>{
    if(i)assert.equal(b.mulai,shiftDate(buckets[i-1].sampai,1),`${label}: ember ${i} bersambung`);
    assert.deepEqual(figures(b),overviewFigures(db,b.mulai,b.sampai),`${label}: ${b.mulai}–${b.sampai}`);
  });
}

test('minggu laporan = Senin–Minggu WITA, termasuk lintas bulan, lintas tahun, dan tahun kabisat',()=>{
  assert.equal(weekStart('2026-11-19'),'2026-11-16');assert.equal(weekStart('2026-11-16'),'2026-11-16');assert.equal(weekStart('2026-11-22'),'2026-11-16');
  assert.equal(weekStart('2026-11-01'),'2026-10-26');assert.equal(weekStart('2026-01-01'),'2025-12-29');assert.equal(weekStart('2028-02-29'),'2028-02-28');
  // Ember dipotong ke rentang; minggu dan bulan mengikuti kalender, bukan 7/30 hari sejak awal rentang.
  const rows=[['2026-10-30',2],['2026-11-01',1],['2026-11-02',3],['2026-11-30',4]].map(([day,antar])=>({guide_id:'G-001',pos:1,day,n:{antar,uniform:antar,idCard:antar,review:0,etika:0,uniformPatuh:antar,nId:0,nKurang:0,nTidak:0,nTeguran:0,potongan:0}}));
  assert.deepEqual(visitTrend(rows,'2026-10-29','2026-11-30','minggu').map(b=>[b.mulai,b.sampai,b.pengantaran]),
    [['2026-10-29','2026-11-01',3],['2026-11-02','2026-11-08',3],['2026-11-09','2026-11-15',0],['2026-11-16','2026-11-22',0],['2026-11-23','2026-11-29',0],['2026-11-30','2026-11-30',4]]);
  assert.deepEqual(visitTrend(rows,'2026-10-29','2026-11-30','bulan').map(b=>[b.mulai,b.sampai,b.pengantaran,b.hariDinilai]),[['2026-10-29','2026-10-31',2,1],['2026-11-01','2026-11-30',8,3]]);
  const empty=visitTrend(rows,'2026-11-03','2026-11-04','hari');
  assert.deepEqual(empty.map(b=>[b.mulai,b.pengantaran,b.nilai,b.persenId,b.guideDinilai]),[['2026-11-03',0,null,null,0],['2026-11-04',0,null,null,0]],'hari tanpa penilaian tetap ada, angkanya kosong');
});

test('laporan mingguan: minggu berjalan, pembanding minggu lalu sampai jam yang sama, tren 12 minggu sama dengan rekap rentangnya',t=>{
  const f=fixture(t),T=seed(f.db),from=monday(T),to=shiftDate(from,6),nowMs=tenOClock(T);
  const r=visitReport(f.db,'minggu',T,nowMs);
  assert.deepEqual(r.laporan,{jenis:'minggu',from,to,sampai:T,berjalan:true,sebelumnya:{from:shiftDate(from,-7),to:shiftDate(T,-7),utuh:false,sampaiJam:'10:00'},
    tren:{unit:'minggu',from:shiftDate(from,-7*(reportRules.trenMinggu-1)),to:T}});
  assert.deepEqual(withoutComparison(f.route(f.users.leader,`jenis=minggu&tanggal=${T}`)),withoutComparison(r),'rute = visitReport');
  // Rekap minggu ini = Dashboard untuk rentang yang sama; status reward tidak untuk mingguan.
  assert.deepEqual([r.from,r.to],[from,T]);
  assert.deepEqual(figures(r.ringkasan),overviewFigures(f.db,from,T));
  assert(r.ringkasan.pengantaran>0,'data uji minggu ini tidak kosong');
  assert.equal(r.ringkasan.layak,null);assert.equal(r.aturan.satu_bulan,false);assert(r.perGuide.length&&r.perGuide.every(g=>g.status===undefined));
  assert.deepEqual(r.perRegu,visitOverview(f.db,from,T).perRegu);
  const cut=cutFigures(f.db,shiftDate(from,-7),shiftDate(T,-7),sameTime(shiftDate(T,-7),nowMs));
  assert.deepEqual(figures(r.sebelumnya),cut,'pembanding: minggu lalu sampai pukul 10.00 di hari yang sama');
  assert(cut.pengantaran<overviewFigures(f.db,shiftDate(from,-7),shiftDate(T,-7)).pengantaran,'penilaian sesudah pukul 10.00 tidak ikut dibandingkan');
  assert.equal(r.perHari.length,days(from,T)+1);assertBuckets(f.db,r.perHari,from,T,'per hari');
  assert(r.perHari.every(b=>b.mulai===b.sampai));
  assert.equal(r.perHari.reduce((n,b)=>n+b.pengantaran,0),r.ringkasan.pengantaran);
  assert.equal(r.perMinggu,null);
  assert.equal(r.tren.length,reportRules.trenMinggu);assertBuckets(f.db,r.tren,r.laporan.tren.from,T,'tren 12 minggu');
  assert(r.tren.every(b=>weekStart(b.mulai)===b.mulai),'setiap minggu tren mulai hari Senin');
  assert.deepEqual(figures(r.tren.at(-1)),figures(r.ringkasan),'minggu terakhir tren = minggu laporan');
  assert.deepEqual(figures(r.tren.at(-2)),overviewFigures(f.db,shiftDate(from,-7),shiftDate(from,-1)),'minggu lalu di tren: minggu utuh');
  // Tanggal mana pun di minggu yang sama menghasilkan laporan yang sama.
  assert.deepEqual(stable(visitReport(f.db,'minggu',from,nowMs)),stable(r));
  // Minggu lalu sudah lewat: utuh Senin–Minggu dan dibandingkan dengan minggu utuh sebelumnya.
  const last=f.route(f.users.manager,`jenis=minggu&tanggal=${shiftDate(from,-3)}`);
  assert.deepEqual([last.laporan.from,last.laporan.sampai,last.laporan.berjalan,last.laporan.sebelumnya.to,last.laporan.sebelumnya.utuh,last.laporan.sebelumnya.sampaiJam],[shiftDate(from,-7),shiftDate(from,-1),false,shiftDate(from,-8),true,null]);
  assert.deepEqual(figures(last.sebelumnya),overviewFigures(f.db,shiftDate(from,-14),shiftDate(from,-8)),'minggu lalu dibanding minggu utuh sebelumnya');
  assert.equal(last.perHari.length,7);assertBuckets(f.db,last.perHari,shiftDate(from,-7),shiftDate(from,-1),'minggu lalu per hari');
});

test('laporan bulanan: rekap identik dengan Dashboard termasuk status reward; per minggu dipotong ke bulan; tren 12 bulan dengan aturan bulannya',t=>{
  const f=fixture(t),T=seed(f.db,11),month=T.slice(0,7),from=`${month}-01`,nowMs=tenOClock(T);
  const r=visitReport(f.db,'bulan',month,nowMs),o=visitOverview(f.db,from,T);
  assert.deepEqual(withoutComparison(f.route(f.users.leader,`jenis=bulan&bulan=${month}`)),withoutComparison(r),'rute = visitReport');
  for(const key of Object.keys(o))if(!['diperbarui'].includes(key))assert.deepEqual(r[key],o[key],`rekap bulanan: ${key}`);
  assert.equal(r.aturan.satu_bulan,true);assert.notEqual(r.ringkasan.layak,null);
  const prev=monthOf(T,-1),prevTo=[shiftDate(`${prev}-01`,days(from,T)),monthLastDay(prev)].sort()[0];
  assert.deepEqual(r.laporan,{jenis:'bulan',from,to:monthLastDay(month),sampai:T,berjalan:true,sebelumnya:{from:`${prev}-01`,to:prevTo,utuh:false,sampaiJam:'10:00'},
    tren:{unit:'bulan',from:`${monthOf(T,1-reportRules.trenBulan)}-01`,to:T}});
  assert.deepEqual(figures(r.sebelumnya),cutFigures(f.db,`${prev}-01`,prevTo,sameTime(prevTo,nowMs)),'pembanding: bulan lalu sampai pukul 10.00 di tanggal yang sama');
  assert.deepEqual([r.perJam,r.perMinggu.length>0],[null,true]);
  assertBuckets(f.db,r.perHari,from,T,'per hari');
  assertBuckets(f.db,r.perMinggu,from,T,'per minggu');
  assert(r.perMinggu.slice(1).every(b=>weekStart(b.mulai)===b.mulai),'minggu kedua dan seterusnya mulai hari Senin');
  assert.equal(r.perMinggu.reduce((n,b)=>n+b.pengantaran,0),r.ringkasan.pengantaran);
  assert.equal(r.tren.length,reportRules.trenBulan);assertBuckets(f.db,r.tren,r.laporan.tren.from,T,'tren 12 bulan');
  assert(r.tren.every(b=>b.mulai.endsWith('-01')),'tren per bulan kalender');
  // Bulan dengan aturan berbeda: potongan ember = potongan rekap bulan itu dengan aturan bulannya.
  const special=r.tren.find(b=>b.mulai.slice(0,7)===monthOf(shiftDate(T,-90),0));
  assert(special&&special.pengantaran>0,'bulan beraturan khusus ada di tren dan berisi');
  assert.equal(special.potongan,visitOverview(f.db,special.mulai,special.sampai).ringkasan.potongan);
  // Riwayat NilaiGuide hanya dihitung selama migrasi awal berlaku.
  const before=r.tren.reduce((n,b)=>n+b.pengantaran,0);
  const imported=Number(one(f.db,"SELECT coalesce(sum(antar),0) n FROM visit_daily_totals WHERE sumber='nilaiguide' AND day>=? AND day<=?",r.laporan.tren.from,T).n);
  assert(imported>0,'riwayat NilaiGuide ada di jendela tren');
  run(f.db,"UPDATE visit_history_import SET status='dibatalkan',terbuka=NULL,cancelled_at=?",now());
  assert.equal(f.route(f.users.leader,`jenis=bulan&bulan=${month}`).tren.reduce((n,b)=>n+b.pengantaran,0),before-imported);
});

test('laporan bulan lampau: 31 hari dibanding bulan pendek, dan minggu lintas tahun',t=>{
  const f=fixture(t);
  const march=f.route(f.users.leader,'jenis=bulan&bulan=2026-03');
  assert.deepEqual(march.laporan,{jenis:'bulan',from:'2026-03-01',to:'2026-03-31',sampai:'2026-03-31',berjalan:false,sebelumnya:{from:'2026-02-01',to:'2026-02-28',utuh:true,sampaiJam:null},tren:{unit:'bulan',from:'2025-04-01',to:'2026-03-31'}});
  assert.deepEqual([march.perHari.length,march.perMinggu.length,march.tren.length],[31,6,12]);
  assert.deepEqual(march.perMinggu.map(b=>[b.mulai,b.sampai]),[['2026-03-01','2026-03-01'],['2026-03-02','2026-03-08'],['2026-03-09','2026-03-15'],['2026-03-16','2026-03-22'],['2026-03-23','2026-03-29'],['2026-03-30','2026-03-31']]);
  assert(march.perHari.every(b=>b.pengantaran===0&&b.nilai===null),'bulan tanpa data: angka kosong, bukan nol palsu');
  const april=f.route(f.users.leader,'jenis=bulan&bulan=2026-04');
  assert.deepEqual(april.laporan.sebelumnya,{from:'2026-03-01',to:'2026-03-30',utuh:false,sampaiJam:null},'30 hari April dibanding 1–30 Maret');
  const newYear=f.route(f.users.leader,'jenis=minggu&tanggal=2026-01-01');
  assert.deepEqual(newYear.laporan,{jenis:'minggu',from:'2025-12-29',to:'2026-01-04',sampai:'2026-01-04',berjalan:false,sebelumnya:{from:'2025-12-22',to:'2025-12-28',utuh:true,sampaiJam:null},tren:{unit:'minggu',from:'2025-10-13',to:'2026-01-04'}});
  const marchFirst=f.route(f.users.leader,'jenis=hari&tanggal=2026-03-01');
  assert.deepEqual(marchFirst.laporan,{jenis:'hari',from:'2026-03-01',to:'2026-03-01',sampai:'2026-03-01',berjalan:false,sebelumnya:{from:'2026-02-28',to:'2026-02-28',utuh:true,sampaiJam:null},tren:{unit:'hari',from:'2026-01-31',to:'2026-03-01'}});
  assert.deepEqual([marchFirst.tren.length,marchFirst.perJam.length,marchFirst.perJam.every(h=>h.pengantaran===0)],[reportRules.trenHari,24,true]);
});

test('laporan: periode yang belum dimulai, parameter salah, dan izin',t=>{
  const f=fixture(t),T=today(),q=query=>f.route(f.users.leader,query);
  assert.throws(()=>q(`jenis=minggu&tanggal=${shiftDate(monday(T),7)}`),e=>e.status===422&&/belum dimulai/.test(e.message));
  assert.throws(()=>q(`jenis=bulan&bulan=${monthOf(T,1)}`),e=>e.status===422&&/belum dimulai/.test(e.message));
  assert.throws(()=>q(`jenis=hari&tanggal=${shiftDate(T,1)}`),e=>e.status===422&&/belum dimulai/.test(e.message));
  for(const bad of ['','jenis=tahun','jenis=bulan&bulan=2026-13','jenis=bulan&bulan=2026-1','jenis=minggu&tanggal=2026-02-30','jenis=minggu&tanggal=19-11-2026','jenis=hari&tanggal=2026-11-31'])
    assert.throws(()=>q(bad),e=>e.status===422,bad);
  // Tanpa tanggal/bulan: minggu atau bulan berjalan.
  assert.equal(q('jenis=minggu').laporan.from,monday(T));assert.equal(q('jenis=bulan').laporan.from,`${T.slice(0,7)}-01`);assert.equal(q('jenis=hari').laporan.from,T);
  for(const user of [f.users.it,f.users.hr])for(const jenis of ['hari','minggu','bulan'])assert.throws(()=>f.route(user,`jenis=${jenis}`),e=>e.status===403);
});

test('laporan sama persis sebelum dan sesudah rincian dilipat ke rekap harian',t=>{
  const f=fixture(t),T=seed(f.db,23),db=f.db,nowMs=tenOClock(T);
  const reports=[['minggu',T],['minggu',shiftDate(T,-14)],['bulan',monthOf(T,-1)],['hari',shiftDate(T,-12)],['hari',shiftDate(T,-9)],['hari',T]];
  const report=([jenis,anchor])=>stable(visitReport(db,jenis,anchor,nowMs));
  const before=reports.map(report);
  const hoursBefore=visitReport(db,'hari',shiftDate(T,-12),nowMs).perJam;assert(hoursBefore.some(h=>h.pengantaran),'ada rincian per jam sebelum dilipat');
  // Pelipatan seperti retensi (visit-sheets.mjs foldVerifiedDays): rincian aktif ≤ batas
  // diringkas per hari × guide × pos, lalu seluruh rinciannya dihapus.
  const through=shiftDate(T,-10);
  for(const g of all(db,`SELECT wita_date AS day,guide_id,pos,count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika,${visitFindingSums} FROM visit_evaluations WHERE status='aktif' AND wita_date<=? GROUP BY wita_date,guide_id,pos`,through))
    run(db,`INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES(?,?,?,'portal',?,?,?,?,?,?,?,?,?,?,?)`,
      g.day,g.guide_id,g.pos,g.antar,g.uniform,g.uniform_patuh,g.id_card,g.review,g.etika,now(),g.n_id,g.n_kurang,g.n_tidak,g.n_teguran);
  assert(run(db,'DELETE FROM visit_evaluations WHERE wita_date<=?',through).changes>0);
  // Hari yang sudah dilipat kehilangan jamnya; angka lainnya tetap sama persis.
  reports.forEach((q,i)=>{const after=report(q);if(q[0]==='hari'&&q[1]<=through){assert.equal(after.perJam,null,`${q} tanpa per jam`);after.perJam=before[i].perJam;}assert.deepEqual(after,before[i],q.join(' '));});
  // Pembanding hari berjalan: kemarin yang sudah dilipat (tanpa jam) dihitung sehari penuh.
  run(db,'SAVEPOINT lipat_kemarin');
  for(const g of all(db,`SELECT wita_date AS day,guide_id,pos,count(*) AS antar,sum(uniform) AS uniform,sum(CASE WHEN uniform>=1 THEN 1 ELSE 0 END) AS uniform_patuh,sum(id_card) AS id_card,sum(review) AS review,sum(etika) AS etika,${visitFindingSums} FROM visit_evaluations WHERE status='aktif' AND wita_date=? GROUP BY wita_date,guide_id,pos`,shiftDate(T,-1)))
    run(db,`INSERT INTO visit_daily_totals(day,guide_id,pos,sumber,antar,uniform,uniform_patuh,id_card,review,etika,updated_at,n_id,n_kurang,n_tidak,n_teguran) VALUES(?,?,?,'portal',?,?,?,?,?,?,?,?,?,?,?)`,
      g.day,g.guide_id,g.pos,g.antar,g.uniform,g.uniform_patuh,g.id_card,g.review,g.etika,now(),g.n_id,g.n_kurang,g.n_tidak,g.n_teguran);
  run(db,'DELETE FROM visit_evaluations WHERE wita_date=?',shiftDate(T,-1));
  const today=visitReport(db,'hari',T,nowMs);
  assert.deepEqual(today.laporan.sebelumnya,{from:shiftDate(T,-1),to:shiftDate(T,-1),utuh:true,sampaiJam:null});
  assert.deepEqual(figures(today.sebelumnya),overviewFigures(db,shiftDate(T,-1),shiftDate(T,-1)));
  run(db,'ROLLBACK TO lipat_kemarin');run(db,'RELEASE lipat_kemarin');
});

test('laporan harian: per jam WITA dari rincian, pembanding kemarin sampai jam yang sama, tren 30 hari',t=>{
  const f=fixture(t),T=seed(f.db,31),db=f.db,nowMs=tenOClock(T),yesterday=shiftDate(T,-1);
  const r=visitReport(db,'hari',T,nowMs);
  assert.deepEqual(withoutComparison(f.route(f.users.leader,`jenis=hari&tanggal=${T}`)),withoutComparison(r),'rute = visitReport');
  assert.deepEqual(r.laporan,{jenis:'hari',from:T,to:T,sampai:T,berjalan:true,sebelumnya:{from:yesterday,to:yesterday,utuh:false,sampaiJam:'10:00'},tren:{unit:'hari',from:shiftDate(T,1-reportRules.trenHari),to:T}});
  assert.deepEqual(figures(r.ringkasan),overviewFigures(db,T,T));assert(r.ringkasan.pengantaran>0);
  assert.equal(r.ringkasan.layak,null);assert(r.perGuide.every(g=>g.status===undefined));assert.equal(r.perMinggu,null);
  // Pembanding: kemarin sampai pukul 10.00 saja.
  const cut=cutFigures(db,yesterday,yesterday,sameTime(yesterday,nowMs));
  assert.deepEqual(figures(r.sebelumnya),cut);assert(cut.pengantaran<overviewFigures(db,yesterday,yesterday).pengantaran);
  // Per jam WITA: 24 jam, jumlahnya sama dengan rekap hari itu, dan jamnya sama dengan waktu penilaian.
  assert.equal(r.perJam.length,24);assert.deepEqual(r.perJam.map(h=>h.jam),[...Array(24).keys()]);
  for(const key of ['pengantaran','tanpaId','kurangLengkap','tidakBerseragam','etika','potongan'])assert.equal(r.perJam.reduce((n,h)=>n+h[key],0),r.ringkasan[key],key);
  const counts=new Map(all(db,"SELECT evaluated_at FROM visit_evaluations WHERE status='aktif' AND wita_date=?",T).map(x=>(Number(x.evaluated_at.slice(11,13))+8)%24).map((h,i,list)=>[h,list.filter(y=>y===h).length]));
  for(const h of r.perJam)assert.equal(h.pengantaran,counts.get(h.jam)||0,`jam ${h.jam}`);
  assert(r.perJam.filter(h=>h.pengantaran).every(h=>h.nilai===100-(h.potongan-h.etika)/h.pengantaran));
  // Tren 30 hari: setiap hari sama dengan rekap hari itu.
  assert.equal(r.tren.length,reportRules.trenHari);assertBuckets(db,r.tren,shiftDate(T,1-reportRules.trenHari),T,'tren 30 hari');
  assert.deepEqual(figures(r.tren.at(-1)),figures(r.ringkasan));
  // Hari lampau: dibanding hari sebelumnya sehari penuh.
  const past=visitReport(db,'hari',shiftDate(T,-3),nowMs);
  assert.deepEqual([past.laporan.berjalan,past.laporan.sebelumnya],[false,{from:shiftDate(T,-4),to:shiftDate(T,-4),utuh:true,sampaiJam:null}]);
  assert.deepEqual(figures(past.sebelumnya),overviewFigures(db,shiftDate(T,-4),shiftDate(T,-4)));
  // Hari yang hanya punya rekap harian (dilipat) tidak punya per jam.
  const folded=visitReport(db,'hari',shiftDate(T,-60),nowMs);
  assert.equal(folded.perJam,null);assert(folded.ringkasan.pengantaran>0);
});
