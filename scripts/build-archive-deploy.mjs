// Tambal HANYA rute E-Arsip ke snapshot portal-api yang aktif.
// Seperti build-attendance-deploy.mjs: modul lama tidak dibangkitkan ulang, sehingga
// tambalan produksi (Superadmin/IT-admin, Wakil Sekban, Drive per modul, Kunjungan,
// Cuti khusus, Absensi) tetap utuh.
//
//   node scripts/build-archive-deploy.mjs <snapshot-aktif.ts> <sha256-snapshot>
//
// Snapshot aktif = portal-api yang sedang tayang (bandingkan dulu dengan versi di
// dashboard Supabase). Hasil ditulis ke supabase/deploy/portal-api/index.ts.
//
// Lima tambalan:
//  1. folder Drive `arsip` (SPH-Portal-Arsip) dikenali penyimpanan snapshot;
//  2. rute `archives/*` memakai folder itu saat berkas diikat ke arsip;
//  3. petugas arsip yang ditunjuk boleh mengunggah lewat `uploads` (pemeriksaan isi,
//     ukuran, dan checksum milik snapshot tetap berlaku);
//  4. modul E-Arsip (lib/archive*.mjs) dibundel dalam satu lingkup (__archives);
//  5. rute `archives/*` di routeOperation. Modul memeriksa izin sendiri langsung dari
//     tabel role (bukan `has/can` snapshot), karena Super Admin tidak otomatis Humas.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const [sourcePath,expectedHash]=process.argv.slice(2);
if(!sourcePath||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new Error('Pass active gateway snapshot and its verified SHA-256.');
const source=readFileSync(resolve(sourcePath),'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!==expectedHash)throw new Error('Active gateway snapshot hash mismatch.');
if(source.includes('__archives')||source.includes('p[0] === "archives"'))throw new Error('Snapshot already contains the archive module.');
const once=(text,needle,label)=>{const at=text.indexOf(needle);if(at<0||text.indexOf(needle,at+1)>=0)throw new Error(`Gateway boundary not found exactly once: ${label}`);return at;};
const swap=(text,needle,replacement,label)=>{const at=once(text,needle,label);return text.slice(0,at)+replacement+text.slice(at+needle.length);};

// 1. Folder Drive E-Arsip: entri terakhir peta folder, apa pun modul sebelumnya.
const mapStart=once(source,'var driveModuleFolders = Object.freeze({','drive module folder map'),mapEnd=source.indexOf('\n});',mapStart);
if(mapEnd<0||mapEnd-mapStart>1200)throw new Error('Drive folder map changed.');
let patched=source.slice(0,mapEnd)+',\n  arsip: "SPH-Portal-Arsip"'+source.slice(mapEnd);

// 2. Rute archives/* memakai folder modul `arsip`.
patched=swap(patched,'coaching: "coaching" }[resource];','coaching: "coaching", archives: "arsip" }[resource];','drive module for operation');

// 3. Unggahan petugas arsip.
patched=swap(patched,'  if (path === "uploads" && method === "POST") return upload(db, user, body);',
 '  if (path === "uploads" && method === "POST") return await __archives.archiveUploadAllowed(db, user) ? storeUpload(db, user, body) : upload(db, user, body);','uploads route');
once(patched,'async function storeUpload(db, user, b, dataDir) {','storeUpload');
once(patched,'async function claimFile(db, user, id) {','claimFile');

// 5. Rute di routeOperation, sebelum rute dashboard.
const dashboardRoute='  if (path === "dashboard" && method === "GET") return dashboard(';
const routeAt=once(patched,dashboardRoute,'dashboard route');
if(routeAt<once(patched,'async function routeOperation(','routeOperation'))throw new Error('Dashboard route is outside routeOperation.');
patched=swap(patched,dashboardRoute,'  if (p[0] === "archives") return __archives.archiveRoutes({ db, user, p, method, body, url }, { claimFile, readFile: (key) => db.storage.get(key, "arsip"), claimStorage: (key) => db.storage.claim(key) }).then(archiveFound, adoptArchiveError);\n'+dashboardRoute,'dashboard route');

// 4. Modul E-Arsip dibundel terpisah lalu dibungkus satu lingkup, supaya nama di
// snapshot (assert, audit, AppError, …) tidak diganti esbuild.
const shared=resolve('supabase/functions/_shared/portal');
const bundled=await build({stdin:{contents:`export {archiveRoutes,archiveUploadAllowed} from './archives.mjs';\n`,resolveDir:shared,sourcefile:'archives-entry.mjs',loader:'js'},
 write:false,bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',external:['node:*','npm:*'],legalComments:'none'});
let moduleText=bundled.outputFiles[0].text;
const imports=[],aliases=[];
moduleText=moduleText.replace(/^import \{([^}]+)\} from "(node:[a-z_]+)";\n/gm,(_,names,from)=>{
 const parts=names.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const [orig,local=orig]=x.split(/\s+as\s+/);return {orig,local};});
 imports.push(`import { ${parts.map(x=>`${x.orig} as __archives_${x.local}`).join(', ')} } from "${from}";`);
 for(const x of parts)aliases.push(`  const ${x.local} = __archives_${x.local};`);
 return '';
});
if(/^import /m.test(moduleText))throw new Error('Unexpected non-node import in archive bundle.');
const exportMatch=moduleText.match(/\nexport \{\n([\s\S]*?)\n\};\n?$/);
if(!exportMatch)throw new Error('Archive bundle export block not found.');
const exported=exportMatch[1].split(',').map(x=>x.trim()).filter(Boolean);
for(const name of ['archiveRoutes','archiveUploadAllowed'])if(!exported.some(e=>e===name||e.endsWith(` as ${name}`)))throw new Error(`Archive export missing: ${name}`);
const body=moduleText.slice(0,exportMatch.index);
const namespace=`// --- Modul E-Arsip, dibangkitkan dari lib/archive*.mjs (build-archive-deploy.mjs) ---
const __archives = (() => {
${aliases.join('\n')}
${body}
  return { ${exported.map(e=>{const [orig,as=orig]=e.split(/\s+as\s+/);return `${as}: ${orig}`;}).join(', ')} };
})();
// Rute arsip yang tidak dikenal dijawab 404, sama seperti alamat API lain.
function archiveFound(result) {
  if (result === void 0) throw new AppError(404, "Alamat API tidak ditemukan.");
  return result;
}
// Galat dari modul E-Arsip memakai kelas AppError salinannya sendiri; diubah ke
// AppError snapshot supaya status 403/404/409/413/422 tidak berubah menjadi 503.
function adoptArchiveError(error) {
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
console.log(JSON.stringify({source_sha256:sha,output:out,output_sha256:createHash('sha256').update(readFileSync(out)).digest('hex'),
 patches:['arsip Drive folder','archives Drive module','archive officer uploads','archive module imports','archive routes in routeOperation']}));
