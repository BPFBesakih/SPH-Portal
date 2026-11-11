import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {loadMerchandiseSalesArtwork,readMerchandiseTemplateZip} from '../public/merchandise-sales-artwork.js';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZWQAAAAASUVORK5CYII=','base64');
const crc=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
function fixture({external=false,date=true,method=8,duplicate=false}={}){
  const parts=[
    ['xl/workbook.xml','<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="MASTER" r:id="rId0"/><sheet name="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet2.xml"/></Relationships>'],
    ['xl/worksheets/sheet2.xml','<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><c><v>1234567</v></c></sheetData><drawing r:id="rId2"/></worksheet>'],
    ['xl/worksheets/_rels/sheet2.xml.rels','<Relationships><Relationship Id="rId2" Target="../drawings/drawing2.xml"/></Relationships>'],
    ['xl/drawings/drawing2.xml','<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>'+(date?'Besakih, 1 November 2026':'Petugas Contoh')+'</a:t></a:r></a:p></xdr:wsDr>'],
    ['xl/drawings/_rels/drawing2.xml.rels','<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="'+(external?'https://example.invalid/private.png':'../media/image1.png')+'"'+(external?' TargetMode="External"':'')+'/></Relationships>'],
    ['xl/media/image1.png',PNG]
  ];
  if(duplicate)parts.push(parts[0]);
  const local=[],central=[];let offset=0;
  for(const [path,content] of parts){
    const name=Buffer.from(path),data=Buffer.isBuffer(content)?content:Buffer.from(content),packed=method===8?deflateRawSync(data):data;
    const a=Buffer.alloc(30);a.writeUInt32LE(0x04034b50);a.writeUInt16LE(20,4);a.writeUInt16LE(method,8);a.writeUInt32LE(crc(data),14);a.writeUInt32LE(packed.length,18);a.writeUInt32LE(data.length,22);a.writeUInt16LE(name.length,26);local.push(a,name,packed);
    const b=Buffer.alloc(46);b.writeUInt32LE(0x02014b50);b.writeUInt16LE(20,4);b.writeUInt16LE(20,6);b.writeUInt16LE(method,10);b.writeUInt32LE(crc(data),16);b.writeUInt32LE(packed.length,20);b.writeUInt32LE(data.length,24);b.writeUInt16LE(name.length,28);b.writeUInt32LE(offset,42);central.push(b,name);offset+=a.length+name.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(parts.length,8);end.writeUInt16LE(parts.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return new Blob([...local,directory,end]);
}
test('compressed local XLSX supplies only embedded artwork and a dynamic signature date',async()=>{
  const art=await loadMerchandiseSalesArtwork(fixture());
  assert.match(art.drawing,/Besakih, \{\{REPORT_DATE\}\}/);
  assert.deepEqual(art.images['xl/media/sales-template-1.png'],new Uint8Array(PNG));
  assert.match(art.drawingRels,/Target="\.\.\/media\/sales-template-1.png"/);
  assert(!JSON.stringify(art).includes('1234567'));
});
test('stored ZIP entries also work without decompression',async()=>{
  const zip=await readMerchandiseTemplateZip(fixture({method:0}));
  assert.match(new TextDecoder().decode(await zip.read('xl/workbook.xml')),/sheet name="1"/);
});
test('external artwork links and a missing signature date fail without any network operation',async()=>{
  await assert.rejects(()=>loadMerchandiseSalesArtwork(fixture({external:true})),/eksternal/);
  await assert.rejects(()=>loadMerchandiseSalesArtwork(fixture({date:false})),/tanggal tanda tangan/);
});
test('invalid, duplicate, oversized and corrupted templates fail clearly',async()=>{
  await assert.rejects(()=>readMerchandiseTemplateZip(new Blob(['not xlsx'])),/tidak valid/);
  await assert.rejects(()=>readMerchandiseTemplateZip(fixture({duplicate:true})),/tidak aman/);
  await assert.rejects(()=>readMerchandiseTemplateZip({size:21*1024*1024}),/20 MB/);
  const corrupt=new Uint8Array(await fixture({method:0}).arrayBuffer());corrupt[60]^=1;
  await assert.rejects(async()=>{const zip=await readMerchandiseTemplateZip(new Blob([corrupt]));await zip.read('xl/workbook.xml');},/rusak|terpotong/);
});
