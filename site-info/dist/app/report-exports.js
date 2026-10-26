import {createXlsx} from './xlsx-export.js';
import {state} from './api.js';
import {formDialog,toast} from './ui.js';

const witaDay=value=>{
  if(!value)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return String(value);
  const milliseconds=Date.parse(value);
  return Number.isFinite(milliseconds)?new Date(milliseconds+8*3600000).toISOString().slice(0,10):'';
};
const within=(value,from,to)=>{const day=witaDay(value);return Boolean(day)&&(!from||day>=from)&&(!to||day<=to);};
const validDate=value=>!value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value);
const text=(header,key,width=24)=>({header,key,width});
const notes=(header,key,width=60)=>({header,key,width,kind:'notes'});
const date=(header,key)=>({header,key,width:20,kind:'date'});
const datetime=(header,key)=>({header,key,width:24,kind:'datetime'});
const number=(header,key)=>({header,key,width:18,kind:'number'});

export function reportWorkbook(type,items,{from='',to=''}={}){
  if(from&&to&&from>to)throw new Error('Tanggal awal tidak boleh melewati tanggal akhir.');
  if(!validDate(from)||!validDate(to))throw new Error('Format tanggal tidak valid.');
  let name,columns,rows;
  if(type==='patroli'){
    name='Patroli';
    columns=[datetime('Waktu kegiatan (WITA)','occurred_at'),text('Petugas','employee_name',30),text('Jenis kegiatan','activity_type'),text('Pos','post_name'),text('Lokasi patroli','location_name',35),notes('Uraian kegiatan','activity_notes'),notes('Temuan','findings'),number('Latitude','latitude'),number('Longitude','longitude'),number('Akurasi GPS (meter)','location_accuracy'),text('Sumber laporan','source'),datetime('Waktu dicatat (WITA)','created_at'),text('ID laporan','id',38)];
    rows=items.filter(r=>r.activity_type==='PATROLI'&&within(r.occurred_at,from,to)).map(r=>({...r,source:r.report_source==='PUBLIC_LINK'?'Formulir laporan cepat':'Portal'}));
  }else if(type==='coaching'){
    name='Coaching';
    columns=[datetime('Tanggal sesi (WITA)','held_at'),text('Pegawai','employee_name',32),text('Pembimbing','coach_name',32),text('Topik','topic',36),notes('Permasalahan / kendala','constraints_notes'),notes('Arahan / solusi','guidance_notes'),notes('Kesepakatan / komitmen','agreement_notes'),number('Tindak lanjut terbuka','open_actions'),datetime('Waktu dicatat (WITA)','created_at'),text('ID sesi','id',38)];
    rows=items.filter(r=>within(r.held_at,from,to));
  }else if(type==='briefings'){
    name='Wewarah Pagi';
    columns=[date('Tanggal wewarah','held_on'),text('Pemberi briefing','employee_name',32),text('Jabatan','position_name',32),text('Bidang / unit','department',32),text('Bagian / urusan','section',32),notes('Pegawai tidak hadir','absent_notes'),notes('Materi wewarah dan kendala','briefing_notes',75),datetime('Waktu dikirim (WITA)','submitted_at'),text('Status','status'),text('ID briefing','id',38)];
    rows=items.filter(r=>within(r.held_on,from,to)).map(r=>({...r,status:r.deleted_at?'Diarsipkan':'Aktif'}));
  }else throw new Error('Jenis laporan tidak dikenal.');
  const stamp=witaDay(new Date().toISOString()),period=from||to?`-${from||'awal'}_sd_${to||'akhir'}`:`-${stamp}`;
  return {count:rows.length,filename:`${type==='briefings'?'wewarah-pagi':type}${period}.xlsx`,blob:createXlsx([{name,columns,rows}])};
}

function saveWorkbook({filename,blob,count}){
  if(!count)throw new Error('Tidak ada data dalam rentang tanggal yang dipilih.');
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;link.style.display='none';document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  toast(`${count} catatan berhasil disiapkan untuk unduhan Excel.`);
}
export function exportBriefings(items){saveWorkbook(reportWorkbook('briefings',items));}

export function openReportExport(type){
  if(!['patroli','coaching'].includes(type))throw new Error('Jenis laporan tidak dikenal.');
  const items=[...state.items];
  const title=type==='patroli'?'Ekspor Data Patroli':'Ekspor Data Coaching';
  const fields=`<label class="field"><span>Dari tanggal (WITA)</span><input type="date" name="from"></label><label class="field"><span>Sampai tanggal (WITA)</span><input type="date" name="to"></label>`;
  formDialog(title,fields,async values=>saveWorkbook(reportWorkbook(type,items,values)),{
    submit:'Unduh Excel',
    note:type==='patroli'?'Kosongkan tanggal untuk seluruh laporan berjenis Patroli dalam cakupan akses Anda.':'Kosongkan tanggal untuk seluruh sesi coaching dalam cakupan akses Anda. Foto dan berkas privat tetap tersedia melalui portal.'
  });
}
