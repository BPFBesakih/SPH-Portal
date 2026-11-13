// Perbarui HANYA modul Pengelolaan Kunjungan di snapshot portal-api yang SUDAH memuatnya.
//
//   node scripts/build-visits-update.mjs <snapshot-aktif.ts> <sha256-snapshot>
//
// Dipakai setelah modul lain ikut menambal portal-api sesudah Kunjungan (Cuti khusus,
// Absensi, …). build-visits-deploy.mjs hanya menerima snapshot SEBELUM Kunjungan, jadi
// menjalankannya ulang akan membuang tambalan modul lain. Skrip ini mengganti dua hal saja:
//   1. baris impor node:* milik modul kunjungan (alias __visits_*);
//   2. isi lingkup `const __visits = (() => { … })();` dengan bundel terbaru dari
//      supabase/functions/_shared/portal/{visits,visit-sheets}.mjs.
// Rute `visits/*`, pencegat penyalinan di luar transaksi, adoptVisitError, dan semua
// tambalan modul lain tidak disentuh. Hasil ditulis ke supabase/deploy/portal-api/index.ts.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const [sourcePath,expectedHash]=process.argv.slice(2);
if(!sourcePath||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new Error('Pass active gateway snapshot and its verified SHA-256.');
const source=readFileSync(resolve(sourcePath),'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!==expectedHash)throw new Error('Active gateway snapshot hash mismatch.');
const once=(text,needle,label)=>{const at=text.indexOf(needle);if(at<0||text.indexOf(needle,at+1)>=0)throw new Error(`Gateway boundary not found exactly once: ${label}`);return at;};

// Lingkup modul lama: dari penanda bundel sampai tepat sebelum penanda pembantu rute.
const startMarker='// --- Modul Pengelolaan Kunjungan, dibangkitkan dari lib/visit*.mjs dan lib/guide-form.mjs ---\nconst __visits = (() => {\n';
const helpersMarker='// --- Pengelolaan Kunjungan (build-visits-deploy.mjs) ---\n';
const start=once(source,startMarker,'visits module start'),helpersAt=once(source,helpersMarker,'visits helpers');
if(helpersAt<start||!source.slice(start,helpersAt).endsWith('\n})();\n'))throw new Error('Visits module block is not directly followed by its route helpers.');
// Rute dan pencegat harus tetap ada; namanya dicocokkan dengan ekspor bundel baru.
const used=['visitRoutes','isVisitSheetAction','authorizeVisitSheetAction','runVisitSheetSync','checkVisitSheetConnection'];
for(const name of used)if(!source.includes(`__visits.${name}(`))throw new Error(`Snapshot does not call __visits.${name}.`);
once(source,'  if (p[0] === "visits") return __visits.visitRoutes({ db, user, p, method, body, url }, { has, audit }).catch(adoptVisitError);','visits route');

const importLine=/^import \{[^}\n]*\bas __visits_[A-Za-z0-9_$]+[^}\n]*\} from "node:[a-z_]+";\n/gm;
const oldImports=source.match(importLine)||[];
if(!oldImports.length)throw new Error('Visits node imports not found.');
let patched=source.slice(0,start)+source.slice(helpersAt);
patched=patched.replace(importLine,'');
if(patched.includes('__visits_'))throw new Error('Old visits aliases remain outside the module block.');

// Bundel baru, dibungkus satu lingkup persis seperti build-visits-deploy.mjs.
const shared=resolve('supabase/functions/_shared/portal');
const bundled=await build({stdin:{contents:`export {visitRoutes,isVisitSheetAction,authorizeVisitSheetAction} from './visits.mjs';\nexport {runVisitSheetSync,checkVisitSheetConnection} from './visit-sheets.mjs';\n`,resolveDir:shared,sourcefile:'visits-entry.mjs',loader:'js'},
 write:false,bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',external:['node:*','npm:*'],legalComments:'none'});
let moduleText=bundled.outputFiles[0].text;
const imports=[],aliases=[];
moduleText=moduleText.replace(/^import \{([^}]+)\} from "(node:[a-z_]+)";\n/gm,(_,names,from)=>{
 const parts=names.split(',').map(x=>x.trim()).filter(Boolean).map(x=>{const [orig,local=orig]=x.split(/\s+as\s+/);return {orig,local};});
 imports.push(`import { ${parts.map(x=>`${x.orig} as __visits_${x.local}`).join(', ')} } from "${from}";`);
 for(const x of parts)aliases.push(`  const ${x.local} = __visits_${x.local};`);
 return '';
});
if(/^import /m.test(moduleText))throw new Error('Unexpected non-node import in visits bundle.');
const exportMatch=moduleText.match(/\nexport \{\n([\s\S]*?)\n\};\n?$/);
if(!exportMatch)throw new Error('Visits bundle export block not found.');
const exported=exportMatch[1].split(',').map(x=>x.trim()).filter(Boolean);
for(const name of used)if(!exported.some(e=>e===name||e.endsWith(` as ${name}`)))throw new Error(`Visits export missing: ${name}`);
const body=moduleText.slice(0,exportMatch.index);
const namespace=`${startMarker}${aliases.join('\n')}
${body}
  return { ${exported.map(e=>{const [orig,as=orig]=e.split(/\s+as\s+/);return `${as}: ${orig}`;}).join(', ')} };
})();
`;
const at=patched.indexOf(helpersMarker);
patched=patched.slice(0,at)+namespace+patched.slice(at);
patched=imports.join('\n')+'\n'+patched;
const {parse}=await import('./cloud-tools/node_modules/acorn/dist/acorn.mjs');
parse(patched,{ecmaVersion:'latest',sourceType:'module'});
const out=resolve('supabase/deploy/portal-api/index.ts');mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,patched);
console.log(JSON.stringify({source_sha256:sha,output:out,output_sha256:createHash('sha256').update(readFileSync(out)).digest('hex'),replaced:{imports:oldImports.length,module_bytes:helpersAt-start},patches:['visits node imports','visits module scope']}));
