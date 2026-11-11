// Membaca bagian tampilan dari XLSX lokal. Tidak ada permintaan jaringan,
// penyimpanan ke server, atau penyimpanan rincian transaksi dari file acuan.
const decode=new TextDecoder('utf-8',{fatal:true});
const xml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const unxml=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,key)=>{
  if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key];
});
const tags=(text,name)=>[...text.matchAll(new RegExp('<(?:[\\w]+:)?'+name+'\\b((?:[^>"\']|"[^"]*"|\'[^\']*\')*)/?>','g'))].map(match=>Object.fromEntries([...match[1].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(a=>[a[1],unxml(a[2]??a[3])])));
const rid=node=>node?.['r:id']||Object.entries(node||{}).find(([key])=>key.endsWith(':id'))?.[1];
const relFile=part=>part.replace(/([^/]+)$/,'_rels/$1.rels');
const resolvePart=(part,target)=>{
  if(!target||target.includes('\\'))throw new Error('Referensi template tidak valid.');
  const value=new URL(target,'https://template.invalid/'+part);
  if(value.origin!=='https://template.invalid'||value.search||value.hash)throw new Error('Referensi eksternal pada template tidak didukung.');
  return value.pathname.slice(1);
};
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};

export async function readMerchandiseTemplateZip(file){
  if(file.size>20*1024*1024)throw new Error('Ukuran template maksimal 20 MB.');
  const buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer),v=new DataView(buffer),entries=new Map();
  if(bytes.length<22||bytes.length>20*1024*1024)throw new Error('File template XLSX tidak valid.');
  let end=bytes.length-22;
  for(;end>=Math.max(0,bytes.length-65557);end--)if(v.getUint32(end,true)===0x06054b50&&end+22+v.getUint16(end+20,true)===bytes.length)break;
  if(end<0||end<bytes.length-65557)throw new Error('File template bukan XLSX yang didukung.');
  const count=v.getUint16(end+10,true),offset=v.getUint32(end+16,true);
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||count>5000||offset>end)throw new Error('Struktur template tidak didukung.');
  let pos=offset,totalSize=0;
  for(let i=0;i<count;i++){
    if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)throw new Error('Daftar bagian template rusak.');
    const flags=v.getUint16(pos+8,true),method=v.getUint16(pos+10,true),crc=v.getUint32(pos+16,true),packed=v.getUint32(pos+20,true),size=v.getUint32(pos+24,true),length=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true),at=v.getUint32(pos+42,true);
    if(pos+46+length+extra+comment>end)throw new Error('Daftar bagian template terpotong.');
    const name=decode.decode(bytes.slice(pos+46,pos+46+length));
    if(flags&1||![0,8].includes(method)||name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||entries.has(name)||size>8*1024*1024)throw new Error('Bagian template tidak aman atau tidak didukung.');
    totalSize+=size;if(totalSize>50*1024*1024)throw new Error('Isi template terlalu besar.');
    entries.set(name,{flags,method,crc,packed,size,at});pos+=46+length+extra+comment;
  }
  const read=async name=>{
    const e=entries.get(name);if(!e)throw new Error('Bagian template tidak ditemukan: '+name);
    if(e.at+30>offset||v.getUint32(e.at,true)!==0x04034b50)throw new Error('Bagian template rusak.');
    const n=v.getUint16(e.at+26,true),x=v.getUint16(e.at+28,true),start=e.at+30+n+x;
    if(start+e.packed>offset||decode.decode(bytes.slice(e.at+30,e.at+30+n))!==name)throw new Error('Bagian template terpotong.');
    let output=bytes.slice(start,start+e.packed);
    if(e.method===8){
      if(typeof DecompressionStream==='undefined')throw new Error('Browser belum mendukung pembacaan template. Perbarui browser lalu coba lagi.');
      const reader=new Blob([output]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),chunks=[];let length=0;
      while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>e.size){await reader.cancel();throw new Error('Ukuran bagian template tidak sesuai.');}chunks.push(value);}
      output=new Uint8Array(length);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length;}
    }
    if(output.length!==e.size||crc32(output)!==e.crc)throw new Error('Isi template rusak atau tidak lengkap.');
    return output;
  };
  return {read};
}

export async function loadMerchandiseSalesArtwork(file){
  const zip=await readMerchandiseTemplateZip(file);
  const readXml=async part=>{
    const content=decode.decode(await zip.read(part));
    if(/<!DOCTYPE|<!ENTITY/i.test(content))throw new Error('Deklarasi eksternal pada template tidak didukung.');
    return content;
  };
  const relationships=async part=>{
    const values=tags(await readXml(relFile(part)),'Relationship');
    if(values.some(r=>r.TargetMode==='External'))throw new Error('Template memiliki tautan eksternal yang tidak didukung.');
    return values;
  };
  const workbook='xl/workbook.xml',sheets=tags(await readXml(workbook),'sheet');
  const sheet=sheets.find(s=>s.name==='1')||sheets.find(s=>/^\d+$/.test(s.name));
  if(!sheet)throw new Error('Pilih Excel laporan penjualan yang mempunyai sheet per tanggal.');
  const target=(await relationships(workbook)).find(r=>r.Id===rid(sheet));
  const sheetPart=resolvePart(workbook,target?.Target),sheetXml=await readXml(sheetPart),drawing=tags(sheetXml,'drawing')[0];
  const drawingRel=(await relationships(sheetPart)).find(r=>r.Id===rid(drawing));
  const drawingPart=resolvePart(sheetPart,drawingRel?.Target);let drawingXml=await readXml(drawingPart);
  const sourceRels=await relationships(drawingPart),imageRels=sourceRels.filter(r=>r.Type?.endsWith('/image'));
  if(!imageRels.length||sourceRels.length!==imageRels.length)throw new Error('Template harus memakai kop/logo berupa gambar tertanam.');
  const images={},rels=[];
  for(let i=0;i<imageRels.length;i++){
    const r=imageRels[i],data=await zip.read(resolvePart(drawingPart,r.Target));
    if(data.length<8||![137,80,78,71,13,10,26,10].every((b,j)=>data[j]===b))throw new Error('Gambar template harus berformat PNG.');
    const name='sales-template-'+(i+1)+'.png';images['xl/media/'+name]=data;
    rels.push('<Relationship Id="'+xml(r.Id)+'" Type="'+xml(r.Type)+'" Target="../media/'+name+'"/>');
  }
  let dateFound=false;
  drawingXml=drawingXml.replace(/<(?:[\w]+:)?p\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?p>/g,paragraph=>{
    const plain=[...paragraph.matchAll(/<(?:[\w]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w]+:)?t>/g)].map(m=>unxml(m[1])).join('');
    if(!plain.startsWith('Besakih,'))return paragraph;
    dateFound=true;let first=true;
    return paragraph.replace(/(<(?:[\w]+:)?t\b[^>]*>)[\s\S]*?(<\/(?:[\w]+:)?t>)/g,(_,open,close)=>{const value=first?'Besakih, {{REPORT_DATE}}':'';first=false;return open+value+close;});
  });
  if(!dateFound)throw new Error('Area tanggal tanda tangan pada template tidak ditemukan. Gunakan Excel acuan laporan penjualan.');
  return {drawing:drawingXml,drawingRels:'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>',images};
}
