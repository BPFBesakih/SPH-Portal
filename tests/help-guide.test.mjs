import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {helpGuideHtml,ROUTE_HELP} from '../public/help-guide.js';

const source=name=>readFile(new URL(`../public/${name}`,import.meta.url),'utf8');
// Rute menu diambil dari deklarasi navigasi, bukan disalin, agar menu baru tanpa panduan ketahuan.
function navRoutes(text,start,end){
  const from=text.indexOf(start);assert.ok(from>=0,`deklarasi ${start} tidak ditemukan`);
  const block=text.slice(from,text.indexOf(end,from));
  return [...block.matchAll(/\['([a-z-]+)','[^']+','[a-z]+','[^']*'\]/g)].map(m=>m[1]);
}

test('setiap menu sidebar punya penjelasan di panduan',async()=>{
  const app=await source('app.js');
  const routes=[
    ...navRoutes(app,'const navs=',';\n'),...navRoutes(app,'const commonNav=','];'),...navRoutes(app,'const adminNav=','];'),
    ...navRoutes(await source('purchasing.js'),'purchasingNav=[','];'),...navRoutes(await source('merchandise.js'),'merchandiseNav=[','];'),
    ...navRoutes(await source('visits.js'),'visitNav=[','];'),...navRoutes(await source('archives.js'),'archiveNav=[','];')
  ];
  assert.ok(routes.length>=40,`hanya ${routes.length} rute terbaca`);
  assert.deepEqual(routes.filter(route=>!ROUTE_HELP[route]),[]);
});

test('panduan hanya memuat menu yang tampil untuk akun',()=>{
  const html=helpGuideHtml({current:'hr',modules:[{key:'hr',label:'SDM',routes:['training']}],common:['announcements','briefings','leaves'],admin:[]});
  assert.match(html,/Kegiatan &amp; Pelatihan/);
  assert.match(html,/Ajukan cuti/);
  for(const hidden of ['Data Pegawai','Akun Pengguna','Absensi','Antrean Purchasing','Pengaturan akses','Modul kerja','Modul aktif'])assert.doesNotMatch(html,new RegExp(hidden));
});

test('panduan menjelaskan syarat tombol serta pemilihan tanggal cuti',()=>{
  assert.match(ROUTE_HELP.briefings,/satu penempatan utama aktif/);
  assert.match(ROUTE_HELP.leaves,/berhak cuti dan memiliki jalur persetujuan/);
  assert.match(ROUTE_HELP.leaves,/cuti tahunan dan cuti khusus singkat.*centang hari kerja/);
  assert.match(ROUTE_HELP.leaves,/melahirkan dan keguguran.*hari kalender.*hari libur/);
});

test('modul yang sedang dibuka tampil pertama dan terbuka',()=>{
  const html=helpGuideHtml({current:'visits',modules:[{key:'hr',label:'SDM',routes:['training']},{key:'visits',label:'Kunjungan',routes:['visits','visits-links']}],common:['leaves'],admin:['accounts']});
  const visits=html.indexOf('<span>Kunjungan</span>'),hr=html.indexOf('<span>SDM</span>');
  assert.ok(visits>0&&hr>visits,'Kunjungan harus sebelum SDM');
  const sections=html.split('<details').slice(1),find=label=>sections.find(s=>s.includes(`<span>${label}</span>`));
  assert.match(find('Kunjungan'),/^ class="help-section" open>/);
  assert.match(find('Kunjungan'),/<small>Modul aktif<\/small>/);
  assert.match(find('SDM'),/^ class="help-section">/);
  assert.match(html,/Modul kerja/);
  assert.match(html,/Akun Pengguna/);
});

test('panduan tidak lagi merujuk berkas pengembang dan tombol sidebar ringkas',async()=>{
  const html=helpGuideHtml({current:'hr',modules:[{key:'hr',label:'SDM',routes:['dashboard']}],common:[],admin:[]});
  assert.doesNotMatch(html,/README|Docker|DEPLOYMENT|kredensial pemulihan/i);
  assert.match(html,/administrator BP Besakih/);
  const app=await source('app.js');
  assert.match(app,/<button class="help-box" data-action="help">\$\{icon\('help'\)\}<span>Panduan penggunaan<\/span><\/button>/);
  assert.doesNotMatch(app,/Butuh bantuan\?|docs\/DEPLOYMENT\.md/);
});
