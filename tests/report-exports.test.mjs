import test from 'node:test';
import assert from 'node:assert/strict';
import {reportWorkbook} from '../public/report-exports.js';
import {createXlsx} from '../public/xlsx-export.js';

async function zipEntries(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),decoder=new TextDecoder(),files=new Map();
  let cursor=0;
  while(cursor+30<=bytes.length&&view.getUint32(cursor,true)===0x04034b50){
    const size=view.getUint32(cursor+18,true),nameLength=view.getUint16(cursor+26,true),extra=view.getUint16(cursor+28,true);
    const name=decoder.decode(bytes.subarray(cursor+30,cursor+30+nameLength));
    const begin=cursor+30+nameLength+extra;files.set(name,decoder.decode(bytes.subarray(begin,begin+size)));
    cursor=begin+size;
  }
  assert(view.getUint32(cursor,true)===0x02014b50,'ZIP central directory is required');
  return files;
}

test('XLSX is a complete Office Open XML archive with filters and typed WITA dates',async()=>{
  const {blob,count,filename}=reportWorkbook('patroli',[{id:'L1',activity_type:'PATROLI',occurred_at:'2026-10-26T16:30:00Z',created_at:'2026-10-26T16:30:00Z',employee_name:'Made',activity_notes:'Rute parkir',latitude:-8.37,longitude:115.45}],{});
  assert.equal(count,1);assert.match(filename,/\.xlsx$/);assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const files=await zipEntries(blob);
  for(const name of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml'])assert(files.has(name),`Missing ${name}`);
  const sheet=files.get('xl/worksheets/sheet1.xml');
  assert.match(sheet,/<pane ySplit="1"/);assert.match(sheet,/<autoFilter ref="A1:M2"/);
  const excelSerial=(Date.UTC(2026,9,27,0,30)-Date.UTC(1899,11,30))/86400000;
  assert(sheet.includes(`<c r="A2" s="3"><v>${excelSerial}</v></c>`));
  assert.match(sheet,/<c r="H2"><v>-8\.37<\/v><\/c>/);
});

test('patroli export excludes non-patrol rows, applies inclusive WITA range, and preserves full notes',async()=>{
  const rows=[
    {id:'1',activity_type:'PATROLI',occurred_at:'2026-10-26T16:30:00Z',activity_notes:'Temuan '.repeat(200)},
    {id:'2',activity_type:'JAGA',occurred_at:'2026-10-27T00:00:00Z'},
    {id:'3',activity_type:'PATROLI',occurred_at:'2026-10-25T16:00:00Z'}
  ];
  const output=reportWorkbook('patroli',rows,{from:'2026-10-27',to:'2026-10-27'});
  assert.equal(output.count,1);
  const sheet=(await zipEntries(output.blob)).get('xl/worksheets/sheet1.xml');
  assert(sheet.includes('Temuan '.repeat(200)));assert(!sheet.includes('>2</t>'));assert(!sheet.includes('>3</t>'));
});

test('coaching exports complete notes as text, never as Excel formulas',async()=>{
  const output=reportWorkbook('coaching',[{id:'c1',employee_name:'Ayu',coach_name:'Made',held_at:'2026-10-25T09:00:00Z',topic:'K3',constraints_notes:'=HYPERLINK("https://evil.invalid")',guidance_notes:'Periksa & laporkan <temuan>',agreement_notes:'Tindak lanjut',open_actions:2}]);
  const sheet=(await zipEntries(output.blob)).get('xl/worksheets/sheet1.xml');
  assert.equal(output.count,1);assert(sheet.includes('=HYPERLINK(&quot;https://evil.invalid&quot;)'));
  assert(!sheet.includes('<f>'));assert(sheet.includes('Periksa &amp; laporkan &lt;temuan&gt;'));
  assert.match(sheet,/<c r="H2"><v>2<\/v><\/c>/);
});

test('wewarah export keeps notes, absent staff, archive state, and dates',async()=>{
  const output=reportWorkbook('briefings',[{id:'b1',held_on:'2026-10-26',employee_name:'Komang',department:'Sekretariat',section:'SDM',absent_notes:'Nihil',briefing_notes:'Pengarahan pagi',deleted_at:null,submitted_at:'2026-10-26T01:30:00Z'}]);
  assert.equal(output.count,1);
  const sheet=(await zipEntries(output.blob)).get('xl/worksheets/sheet1.xml');
  assert(sheet.includes('Nihil'));assert(sheet.includes('Pengarahan pagi'));assert(sheet.includes('Aktif'));
  assert.match(sheet,/<c r="A2" s="2"><v>\d+<\/v><\/c>/);
});

test('validation rejects invalid ranges, unsupported modules, and too many Excel columns',()=>{
  assert.throws(()=>reportWorkbook('coaching',[],{from:'2026-10-27',to:'2026-10-26'}),/Tanggal awal/);
  assert.throws(()=>reportWorkbook('coaching',[],{from:'2026-02-30'}),/Format tanggal/);
  assert.throws(()=>reportWorkbook('other',[]),/tidak dikenal/);
  assert.throws(()=>createXlsx([{name:'Invalid',columns:Array.from({length:16385},()=>({header:'Col',key:'x'})),rows:[]}]),/melebihi batas/);
});
