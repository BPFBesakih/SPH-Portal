import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderRolePermissionGroups} from '../public/role-permissions.js';

const actions={
  'merchandise.catalog':['read','manage','costs'],
  'merchandise.stock':['read','record','adjust'],
  'merchandise.sales':['read','create','void'],
  'merchandise.reports':['read','export']
};
const businessPermissions=Object.entries(actions).flatMap(([resource,verbs])=>verbs.map(action=>({
  resource,action,code:`${resource}.${action}`
})));

test('semua sebelas izin bisnis tampil dan izin yang sudah ditugaskan tetap dicentang',()=>{
  const selected=['merchandise.catalog.read','merchandise.stock.record','merchandise.sales.create','merchandise.sales.read','merchandise.stock.read'];
  const html=renderRolePermissionGroups([{resource:'hr.employees',action:'read',code:'hr.employees.read'},...businessPermissions],selected,true,'merchandise');
  assert.equal((html.match(/name="permissions\[\]"/g)||[]).length,12);
  for(const permission of businessPermissions)assert(html.includes(`value="${permission.code}"`));
  for(const code of selected)assert.match(html,new RegExp(`value="${code.replaceAll('.','\\.')}" checked`));
  assert(html.indexOf('Bisnis: katalog')<html.indexOf('Data pegawai'));
  assert(html.includes('Lihat harga modal'));
  assert(html.includes('Koreksi stok'));
  assert(html.includes('Batalkan transaksi'));
});

test('izin resource baru tidak tersembunyi atau terhapus ketika formulir role diedit',()=>{
  const html=renderRolePermissionGroups([{resource:'future.feature',action:'approve',code:'future.feature.approve'}],['future.feature.approve'],false);
  assert(html.includes('future.feature'));
  assert(html.includes('approve'));
  assert(html.includes('value="future.feature.approve" checked disabled'));
});
test('izin cuti tampil dengan label Kontrol Cuti yang seragam',()=>{
 const html=renderRolePermissionGroups(['read','export','manage'].map(action=>({resource:'hr.leaves',action,code:'hr.leaves.'+action})),['hr.leaves.read']);
 assert(html.includes('<h3>Kontrol Cuti</h3>'));assert(!html.includes('<h3>hr.leaves</h3>'));assert(html.includes('value="hr.leaves.read" checked'));
});

test('nama kode dan label dari katalog izin di-escape',()=>{
  const html=renderRolePermissionGroups([{resource:'another.feature',action:'<img>',code:'another.feature.<img>'}]);
  assert(!html.includes('<img>'));
  assert(html.includes('&lt;img&gt;'));
});

test('entrypoint Cloudflare memakai bundle terbaru yang memuat seluruh kelompok izin Bisnis',()=>{
  const root=new URL('../site-info/dist/',import.meta.url);
  const html=readFileSync(new URL('app/index.html',root),'utf8');
  const manifest=JSON.parse(readFileSync(new URL('portal-static/manifest.json',root),'utf8'));
  assert.match(manifest.javascript,/^\/portal-static\/portal-[a-f0-9]{12}\.js$/);
  assert(html.includes(`src="${manifest.javascript}"`),'HTML masih menunjuk ke bundle lama');
  const bundle=readFileSync(new URL(`.${manifest.javascript}`,root),'utf8');
  for(const resource of Object.keys(actions))assert(bundle.includes(resource),`${resource} tidak ada di bundle`);
  assert(bundle.includes('Bisnis: katalog dan harga merchandise'),'Form izin Bisnis belum masuk bundle');
  assert(bundle.includes('Daftar izin di server tidak lengkap'),'Perlindungan izin tersembunyi belum masuk bundle');
});
