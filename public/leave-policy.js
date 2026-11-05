// Shared by both forms and the server. This module contains public policy only.
export const LEAVE_TYPES=Object.freeze([
 {code:'ANNUAL',name:'Cuti tahunan',max_days:366,calendar_days:false,deducts_balance:true,entitlement:'Sesuai saldo cuti tahunan',note:'Pilih hanya hari kerja Anda. Saldo dipotong setelah persetujuan terakhir.'},
 {code:'MARRIAGE',name:'Menikah',max_days:3,calendar_days:false,deducts_balance:false,entitlement:'3 hari',note:'Tenaga kerja yang bersangkutan menikah: maksimal 3 hari kerja.'},
 {code:'CHILD_MARRIAGE',name:'Menikahkan anak',max_days:2,calendar_days:false,deducts_balance:false,entitlement:'2 hari',note:'Menikahkan anak: maksimal 2 hari kerja.'},
 {code:'FAMILY_BEREAVEMENT',name:'Keluarga inti meninggal dunia',max_days:2,calendar_days:false,deducts_balance:false,entitlement:'2 hari',note:'Suami/istri, orang tua/mertua, atau anak/menantu meninggal dunia: maksimal 2 hari kerja. Sebutkan hubungan keluarga dalam alasan.'},
 {code:'HOUSEHOLD_BEREAVEMENT',name:'Keluarga serumah meninggal dunia',max_days:1,calendar_days:false,deducts_balance:false,entitlement:'1 hari',note:'Keluarga yang tinggal serumah meninggal dunia: maksimal 1 hari kerja.'},
 {code:'WIFE_CHILDBIRTH',name:'Istri melahirkan',max_days:2,calendar_days:false,deducts_balance:false,entitlement:'2 hari',note:'Suami mendapat cuti saat istri melahirkan: maksimal 2 hari kerja.'},
 {code:'MATERNITY',name:'Melahirkan',max_days:84,calendar_days:true,deducts_balance:false,entitlement:'3 bulan / 12 minggu',note:'Menggunakan acuan 12 minggu (84 hari kalender), dengan ketentuan 6 minggu sebelum dan 6 minggu setelah melahirkan. Atasan memverifikasi jadwalnya.'},
 {code:'MISCARRIAGE',name:'Keguguran',max_days:45,calendar_days:true,deducts_balance:false,entitlement:'1,5 bulan',note:'Untuk tenaga kerja perempuan, sesuai surat keterangan dokter kandungan. Batas sistem 45 hari kalender (acuan 30 hari per bulan); pilih tanggal sesuai surat dokter dan jelaskan dalam alasan.'}
].map(Object.freeze));
export const getLeaveType=code=>LEAVE_TYPES.find(t=>t.code===(code??'ANNUAL'));
export const leaveDayLabel=code=>getLeaveType(code)?.calendar_days?'hari kalender':'hari kerja';
export function leaveRange(from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))return [];
 const start=Date.parse(from),end=Date.parse(to),n=(end-start)/86400000+1;
 if(!Number.isInteger(n)||n<1||n>366||new Date(start).toISOString().slice(0,10)!==from||new Date(end).toISOString().slice(0,10)!==to)return [];
 return Array.from({length:n},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
}
