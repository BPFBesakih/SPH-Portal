export const binaryUploadType='application/octet-stream';
export class UploadBodyError extends Error{constructor(status,message){super(message);this.status=status;}}
const types=new Set(['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
const invalid=(condition,status=400,message='Metadata unggahan tidak valid.')=>{if(!condition)throw new UploadBodyError(status,message);};
export async function readBinaryUpload({headers,body},maximum=10*1024*1024){
 invalid(headers.get('content-type')?.toLowerCase()===binaryUploadType,415,'Jenis pengiriman unggahan tidak valid.');
 let name;try{name=decodeURIComponent(headers.get('x-upload-name')||'').trim();}catch{throw new UploadBodyError(400,'Nama berkas tidak valid.');}
 invalid(name.length>0&&name.length<=180&&!/[\\/\u0000-\u001f\u007f]/.test(name));
 const mime_type=headers.get('x-upload-type');invalid(types.has(mime_type),415,'Jenis berkas yang diizinkan: PDF, PNG, JPEG, DOCX, XLSX.');
 const reader=body?.getReader();invalid(reader,400,'Pilih berkas terlebih dahulu.');
 let size=0,carry=new Uint8Array();const parts=[];
 const encode=bytes=>{for(let i=0;i<bytes.length;i+=24576)parts.push(btoa(String.fromCharCode(...bytes.subarray(i,i+24576))));};
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw new UploadBodyError(413,'Ukuran maksimum berkas 10 MB.');}
   let bytes=value;if(carry.length){bytes=new Uint8Array(carry.length+value.length);bytes.set(carry);bytes.set(value,carry.length);}const end=bytes.length-bytes.length%3;encode(bytes.subarray(0,end));carry=bytes.slice(end);
  }
 }finally{reader.releaseLock();}
 invalid(size>0,400,'Pilih berkas terlebih dahulu.');if(carry.length)encode(carry);
 return {name,mime_type,data:parts.join('')};
}
