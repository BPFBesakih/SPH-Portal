import test from 'node:test';
import assert from 'node:assert/strict';
import {state} from '../public/api.js';
import {loadPage,patrolCounts} from '../public/pages.js';

test('patroli dihitung menurut batas tanggal WITA dan seluruh riwayat',()=>{
  const items=[
    {activity_type:'PATROLI',occurred_at:'2026-10-27T15:59:59Z'},
    {activity_type:'PATROLI',occurred_at:'2026-10-27T16:00:00Z'},
    {activity_type:'PATROLI',occurred_at:'2026-10-28T15:59:59Z'},
    {activity_type:'PATROLI',occurred_at:'2026-10-28T16:00:00Z'},
    {activity_type:'LAINNYA',occurred_at:'2026-10-28T01:00:00Z'}
  ];
  assert.deepEqual(patrolCounts(items,'2026-10-28'),{today:2,total:4});
  assert.deepEqual(patrolCounts([],'2026-10-28'),{today:0,total:0});
});

test('dashboard mengambil seluruh logbook sesuai izin, terlepas dari tanggal ringkasan',async t=>{
  const previousFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=previousFetch;});
  const calls=[];
  globalThis.fetch=async url=>{
    calls.push(url);
    const data=url.includes('/dashboard?')?{scheduled:0,gap_count:0,open_incidents:0,assignments:[],incidents:[],logs:[]}:
      {items:[{activity_type:'PATROLI',occurred_at:new Date().toISOString()},{activity_type:'PATROLI',occurred_at:'2020-01-01T00:00:00Z'},{activity_type:'LAINNYA',occurred_at:new Date().toISOString()}]};
    return {ok:true,json:async()=>data};
  };
  state.me={name:'Petugas',user:{username:'petugas'}};
  state.permissions=['security.logbook.read'];
  state.date='2020-01-01';
  const html=await loadPage('security');
  assert(calls.includes('/api/logbook'));
  assert.deepEqual(state.patrolCounts,{today:1,total:2});
  assert.match(html,/Patroli hari ini/);
  assert.match(html,/Total patroli/);
  assert.match(html,/Seluruh riwayat sesuai akses/);
  calls.length=0;
  state.permissions=[];
  const restricted=await loadPage('security');
  assert(!calls.includes('/api/logbook'));
  assert.equal(state.patrolCounts,null);
  assert.match(restricted,/Tidak ada akses logbook/);
});
