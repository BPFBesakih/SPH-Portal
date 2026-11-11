// Tambal HANYA rute Absensi ke snapshot portal-api yang aktif.
// Seperti build-visits-deploy.mjs: modul lama tidak dibangkitkan ulang, sehingga
// tambalan produksi (Superadmin/IT-admin, Wakil Sekban, Drive per modul, Kunjungan,
// Cuti khusus) tetap utuh.
//
//   node scripts/build-attendance-deploy.mjs <snapshot-aktif.ts> <sha256-snapshot>
//
// Snapshot aktif = portal-api yang sedang tayang (bandingkan dulu dengan versi di
// dashboard Supabase). Hasil ditulis ke supabase/deploy/portal-api/index.ts.
//
// Tiga tambalan:
//  1. folder Drive `absensi` (SPH-Portal-Absensi) dikenali penyimpanan snapshot, supaya
//     selfie yang diunggah Edge attendance-form bisa dibaca portal;
//  2. modul Absensi (lib/attendance*.mjs) dibundel dalam satu lingkup (__attendance);
//  3. rute `attendance/*` di routeOperation, memakai has/can/audit milik snapshot dan
//     db.storage untuk membaca selfie. Semua rute berjalan di transaksi permintaan biasa
//     (GET tanpa kunci global; tulis dengan kunci global seperti rute portal lain).
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const [sourcePath,expectedHash]=process.argv.slice(2);
if(!sourcePath||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new Error('Pass active gateway snapshot and its verified SHA-256.');
const source=readFileSync(resolve(sourcePath),'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!==expectedHash)throw new Error('Active gateway snapshot hash mismatch.');
if(source.includes('__attendance')||source.includes('p[0] === "attendance"'))throw new Error('Snapshot already contains the attendance module.');
const once=(text,needle,label)=>{const at=text.indexOf(needle);if(at<0||text.indexOf(needle,at+1)>=0)throw new Error(`Gateway boundary not found exactly once: ${label}`);return at;};

// 1. Folder Drive Absensi.
const folders='  briefing: "SPH-Portal-Briefing"\n});';
const foldersAt=once(source,folders,'drive module folders');
if(foldersAt<once(source,'var driveModuleFolders = Object.freeze({','drive module folder map'))throw new Error('Drive folder map changed.');
let patched=source.slice(0,foldersAt)+'  briefing: "SPH-Portal-Briefing",\n  absensi: "SPH-Portal-Absensi"\n});'+source.slice(foldersAt+folders.length);

// 3. Rute di routeOperation, sesudah rute Kunjungan.
const visitRoute='  if (p[0] === "visits") return __visits.visitRoutes({ db, user, p, method, body, url }, { has, audit }).catch(adoptVisitError);';
const routeAt=once(patched,visitRoute,'visits route');
if(routeAt<once(patched,'async function routeOperation(','routeOperation'))throw new Error('Visits route is outside routeOperation.');
patched=patched.replace(visitRoute,()=>visitRoute+'\n  if (p[0] === "attendance") return __attendance.attendanceRoutes({ db, user, p, method, body, url }, { has, can, audit, readPhoto: (key) => db.storage.get(key) }).catch(adoptAttendanceError);');

// 2. Modul Absensi dibundel terpisah lalu dibungkus satu lingkup, supaya nama di
// snapshot (assert, has, can, audit, AppError, …) tidak diganti esbuild.
const shared=resolve('supabase/functions/_shared/portal');
const bundled=await build({stdin:{contents:`export {attendanceRoutes} from './attendance.mjs';\n`,resolveDir:shared,sourcefile:'attendance-entry.mjs',loader:'js'},
 write:false,bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',external:['node:*','npm:*'],legalComments:'none'});
let moduleText=bundled.outputFiles[0].text;
const imports=[],aliases=[];
moduleText=moduleText.replace(/^import \{([^}]+)\} from "(node:[a-z_]+)";\n/gm,(_,names,from)=>{
 const parts=names.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const [orig,local=orig]=x.split(/\s+as\s+/);return {orig,local};});
 imports.push(`import { ${parts.map(x=>`${x.orig} as __attendance_${x.local}`).join(', ')} } from "${from}";`);
 for(const x of parts)aliases.push(`  const ${x.local} = __attendance_${x.local};`);
 return '';
});
if(/^import /m.test(moduleText))throw new Error('Unexpected non-node import in attendance bundle.');
const exportMatch=moduleText.match(/\nexport \{\n([\s\S]*?)\n\};\n?$/);
if(!exportMatch)throw new Error('Attendance bundle export block not found.');
const exported=exportMatch[1].split(',').map(x=>x.trim()).filter(Boolean);
if(!exported.some(e=>e==='attendanceRoutes'||e.endsWith(' as attendanceRoutes')))throw new Error('Attendance export missing: attendanceRoutes');
const body=moduleText.slice(0,exportMatch.index);
const namespace=`// --- Modul Absensi, dibangkitkan dari lib/attendance*.mjs (build-attendance-deploy.mjs) ---
const __attendance = (() => {
${aliases.join('\n')}
${body}
  return { ${exported.map(e=>{const [orig,as=orig]=e.split(/\s+as\s+/);return `${as}: ${orig}`;}).join(', ')} };
})();
// Galat dari modul Absensi memakai kelas AppError salinannya sendiri; diubah ke
// AppError snapshot supaya status 403/404/409/422 tidak berubah menjadi 503.
function adoptAttendanceError(error) {
  if (!(error instanceof AppError) && error instanceof Error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) throw new AppError(error.status, error.message, error.details);
  throw error;
}
`;
const anchor='async function routeOperation(';
once(patched,anchor,'routeOperation anchor');
patched=patched.replace(anchor,()=>namespace+anchor);
patched=imports.join('\n')+'\n'+patched;
const {parse}=await import('./cloud-tools/node_modules/acorn/dist/acorn.mjs');
parse(patched,{ecmaVersion:'latest',sourceType:'module'});
const out=resolve('supabase/deploy/portal-api/index.ts');mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,patched);
console.log(JSON.stringify({source_sha256:sha,output:out,output_sha256:createHash('sha256').update(readFileSync(out)).digest('hex'),patches:['absensi Drive folder','attendance module imports','attendance routes in routeOperation']}));
