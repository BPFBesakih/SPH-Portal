import test from 'node:test';
import assert from 'node:assert/strict';
import {readBinaryUpload} from '../site-info/lib/upload-body.mjs';
const headers=extra=>new Headers({'content-type':'application/octet-stream','x-upload-name':encodeURIComponent('Bukti kegiatan.pdf'),'x-upload-type':'application/pdf',...extra});
test('binary upload preserves all bytes and metadata across arbitrary stream boundaries',async()=>{
 const bytes=Uint8Array.from({length:90001},(_,i)=>i%256);
 for(const chunk of [1,2,3,31,24577,65536]){let offset=0;const body=new ReadableStream({pull(c){if(offset===bytes.length){c.close();return;}c.enqueue(bytes.subarray(offset,Math.min(bytes.length,offset+chunk)));offset=Math.min(bytes.length,offset+chunk);}});const result=await readBinaryUpload({headers:headers(),body});assert.equal(result.name,'Bukti kegiatan.pdf');assert.equal(result.mime_type,'application/pdf');assert.deepEqual(Buffer.from(result.data,'base64'),Buffer.from(bytes));}
 assert(bytes.length<Buffer.from(bytes).toString('base64').length*.751);
});
test('binary upload rejects unsupported metadata, empty files and over-limit streams',async()=>{
 for(const extra of [{'x-upload-name':'bad%name'},{'x-upload-name':'../bad.pdf'},{'x-upload-name':'a'.repeat(181)},{'x-upload-type':'text/html'},{'content-type':'text/plain'}])await assert.rejects(readBinaryUpload({headers:headers(extra),body:new Blob(['content']).stream()}),e=>[400,415].includes(e.status));
 await assert.rejects(readBinaryUpload({headers:headers(),body:new Blob([]).stream()}),e=>e.status===400);
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(11));},cancel(){cancelled=true;}});await assert.rejects(readBinaryUpload({headers:headers(),body},10),e=>e.status===413);assert(cancelled);
});
