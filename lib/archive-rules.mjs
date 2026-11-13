import {createHash} from 'node:crypto';

// Aturan murni E-Arsip Humas (Tahap 1). Tidak menyentuh basis data, sehingga dipakai sama
// persis oleh portal lokal (SQLite) dan Edge Function produksi (PostgreSQL).
// Angka di sini adalah parameter RT pada PRD (rekomendasi yang dipakai sebagai bawaan):
//   RT01 zona WITA dan ringkasan 07.00; RT02 perihal 1–500; RT03 10.000.000 byte per berkas;
//   RT04 aturan dugaan duplikat; RT18 unduh sampai dicabut.
export const archiveRules=Object.freeze({
 maxFileBytes:10_000_000,
 mimes:Object.freeze(['application/pdf','image/jpeg','image/png']),
 extensions:Object.freeze({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png'}),
 subjectMax:500,numberMax:120,reasonMax:300,longReasonMax:500,
 // Batas teknis per permintaan (bukan batas bisnis): lampiran berikutnya ditambahkan dari detail arsip.
 maxAttachmentsPerRequest:30,
 pageSize:50,maxPageSize:100,reportMaxRows:5000,
 duplicateRuleVersion:'RT04-v1',
 timezone:'Asia/Makassar',digestHour:7,summaryBackfillDays:7
});
export const archiveDirections=Object.freeze(['MASUK','KELUAR','INTERNAL']);
export const archiveClassifications=Object.freeze(['BIASA','RAHASIA']);
export const archiveGrantPurposes=Object.freeze(['BIASA_SHARE','RAHASIA_READ','DOWNLOAD']);
export const archiveReportTypes=Object.freeze(['recap_period','recap_unit','recap_type','agenda_in','agenda_out']);
// Riwayat yang boleh dilihat petugas pembaca (RT07): perubahan isi dan metadata saja.
export const archiveContentActions=Object.freeze(['ARCHIVE_CREATED','METADATA_EDITED','ATTACHMENT_ADDED','ATTACHMENT_REMOVED','VERSION_ADDED']);

const WITA_OFFSET=8*3600000;
export const archiveWitaDate=ms=>new Date(ms+WITA_OFFSET).toISOString().slice(0,10);
export const archiveWitaYear=ms=>new Date(ms+WITA_OFFSET).getUTCFullYear();
export const archiveWitaHour=ms=>new Date(ms+WITA_OFFSET).getUTCHours();
export const archiveShiftDay=(day,days)=>new Date(Date.parse(`${day}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
// Satu hari WITA sebagai rentang UTC [awal, akhir).
export const archiveDayStart=day=>new Date(Date.parse(`${day}T00:00:00+08:00`)).toISOString();
export const archiveDayEnd=day=>archiveDayStart(archiveShiftDay(day,1));

export const archiveValidDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export const archiveAgendaCode=value=>typeof value==='string'&&/^[A-Z0-9]{2,12}$/.test(value);
// KODEBAGIAN/TAHUN/URUTAN, minimal empat digit; 10000 tetap ditulis utuh.
export const archiveAgendaNumber=(code,year,sequence)=>`${code}/${year}/${String(sequence).padStart(4,'0')}`;
// Saran kode agenda dari kode unit organisasi (hanya saran; administrator yang menetapkan).
export const archiveSuggestCode=code=>String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,12);

// Nomor surat disimpan apa adanya; bentuk ternormalisasi hanya untuk pencarian dan duplikasi.
export const archiveNormalNumber=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
export const archiveNormalSubject=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const archiveNormalName=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
export const archiveLike=value=>`%${String(value).replace(/[\\%_]/g,'\\$&')}%`;

export const archiveFingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Masa berlaku izin: awal inklusif, akhir eksklusif; expires_at kosong berarti sampai dicabut.
export function archiveGrantActive(grant,nowIso,epoch){
 if(!grant||grant.revoked_at)return false;
 if(grant.valid_from>nowIso)return false;
 if(grant.expires_at&&grant.expires_at<=nowIso)return false;
 if(grant.purpose!=='BIASA_SHARE'&&Number(grant.security_epoch)!==Number(epoch))return false;
 return true;
}

// Predikat kanonis PRD 5.3. H=Humas, S=lingkup daftar, R=izin baca Rahasia, D=izin unduh,
// O=penunjukan petugas bagian pemilik. Arsip yang dihapus logis tertutup untuk semua jalur normal.
export function archiveDecide({deleted,classification,superAdmin=false,humas,scope,rahasia,download,officer}){
 const active=!deleted;
 const list=active&&Boolean(superAdmin||humas||scope||rahasia);
 const read=active&&Boolean(superAdmin||humas||(classification==='BIASA'&&scope)||(classification==='RAHASIA'&&rahasia));
 return {list,read,edit:read&&Boolean(superAdmin||officer),download:read&&Boolean(superAdmin||download)};
}

// RT04: dugaan duplikat deterministik. Hasilnya peringatan, tidak pernah penolakan.
export function archiveDuplicateReasons(candidate,incoming){
 const reasons=[];
 if(candidate.checksum_match)reasons.push('BERKAS_SAMA');
 if(incoming.official_number_normalized&&candidate.official_number_normalized===incoming.official_number_normalized&&candidate.letter_date===incoming.letter_date)reasons.push('NOMOR_DAN_TANGGAL');
 if(candidate.subject_normalized===incoming.subject_normalized&&candidate.letter_date===incoming.letter_date)reasons.push('PERIHAL_DAN_TANGGAL');
 return reasons;
}
