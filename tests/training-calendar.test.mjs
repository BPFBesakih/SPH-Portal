import test from 'node:test';
import assert from 'node:assert/strict';
import {witaDay,calendarDayEvents,calendarCells,trainingCalendarView} from '../public/training-calendar.js';

const events=[
  {id:'a',title:'Pelatihan lintas tahun',starts_at:'2026-12-31T15:00:00Z',ends_at:'2026-12-31T18:00:00Z',status:'PLANNED',location:'Besakih'},
  {id:'b',title:'Kegiatan selesai',starts_at:'2027-01-01T01:00:00Z',ends_at:'2027-01-01T02:00:00Z',status:'COMPLETED'},
  {id:'c',title:'Batal',starts_at:'2027-01-01T00:00:00Z',ends_at:'2027-01-01T01:00:00Z',status:'CANCELLED'}
];

test('pengelompokan hari kalender menggunakan WITA dan batas akhir eksklusif',()=>{
  assert.equal(witaDay('2026-12-31T16:00:00Z'),'2027-01-01');
  assert.deepEqual(calendarDayEvents(events,'2026-12-31').map(e=>e.id),['a']);
  assert.deepEqual(calendarDayEvents(events,'2027-01-01').map(e=>e.id),['a','b','c']);
  const midnight={id:'midnight',starts_at:'2026-12-31T14:00:00Z',ends_at:'2026-12-31T16:00:00Z'};
  assert.equal(calendarDayEvents([midnight],'2026-12-31').length,1);
  assert.equal(calendarDayEvents([midnight],'2027-01-01').length,0);
});
test('kalender tahunan memiliki 12 bulan dan Februari kabisat benar',()=>{
  assert.equal(calendarCells(2028,1).filter(Boolean).length,29);
  assert.equal(calendarCells(2027,1).filter(Boolean).length,28);
  const html=trainingCalendarView({items:events,view:'year',year:2027,month:0});
  assert.equal((html.match(/training-mini-month/g)||[]).length,12);
  assert(html.includes('cancelled'));assert(html.includes('planned'));assert(html.includes('completed'));
});
test('judul kegiatan ditampilkan aman dan tidak menyisipkan HTML',()=>{
  const html=trainingCalendarView({items:[{...events[0],title:'<script>bad()</script>'}],view:'month',year:2027,month:0,selectedDay:'2027-01-01'});
  assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
});
