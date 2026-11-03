// Tambal HANYA rute Pengelolaan Kunjungan ke snapshot portal-api yang aktif.
// Seperti build-leave-deploy.mjs: modul lama tidak dibangkitkan ulang, sehingga
// tambalan produksi (Superadmin/IT-admin, Wakil Sekban, Drive per modul) tetap utuh.
//
//   node scripts/build-visits-deploy.mjs <snapshot-aktif.ts> <sha256-snapshot>
//
// Snapshot aktif = supabase/deploy/portal-api/index.ts yang sedang tayang
// (bandingkan dulu dengan versi di dashboard Supabase). Hasil ditulis ke
// supabase/deploy/portal-api/index.ts.
//
// Tiga tambalan:
//  1. impor modul visits dan jembatan;
//  2. rute basis data `visits/*` (tautan pos, aktivitas, audit ekspor) di
//     routeOperation, memakai has/audit/AppError milik snapshot;
//  3. rute jembatan (`visits/overview|guides|records|reviews|health`) DICEGAT
//     sebelum transaksi utama: otorisasi di transaksi baca tanpa kunci global,
//     panggilan Google Spreadsheet di luar transaksi, audit di transaksi pendek.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const [sourcePath,expectedHash]=process.argv.slice(2);
if(!sourcePath||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new Error('Pass active gateway snapshot and its verified SHA-256.');
const source=readFileSync(resolve(sourcePath),'utf8');
const sha=createHash('sha256').update(source).digest('hex');
if(sha!==expectedHash)throw new Error('Active gateway snapshot hash mismatch.');
if(source.includes('p[0] === "visits"')||source.includes('visitsBridgeRequest'))throw new Error('Snapshot already contains the visits module.');
const once=(text,needle,label)=>{const at=text.indexOf(needle);if(at<0||text.indexOf(needle,at+1)>=0)throw new Error(`Gateway boundary not found exactly once: ${label}`);return at;};

const leaveRoute='  if (p[0] === "leaves") return leaveRoutes({ db, user, p, method, body, url }, { assert, can, has, audit, today });';
const routeAt=once(source,leaveRoute,'leave route');
if(routeAt<once(source,'async function routeOperation(','routeOperation'))throw new Error('Leave route is outside routeOperation.');
const userLine='        const user = await one(db, "SELECT * FROM users WHERE id=? AND status=\'ACTIVE\'", verified.id);';
const mainTx='      const result = await transaction(client, identity, storage, async (db) => {\n'+userLine;
const mainAt=once(source,mainTx,'operation transaction');
const queryLine='        assert(typeof b.query === "string" && b.query.length <= 2048 && b.body && typeof b.body === "object" && !Array.isArray(b.body), "Permintaan tidak valid.", 400);';
const queryAt=once(source,queryLine,'operation shape check');
if(queryAt<mainAt)throw new Error('Operation checks are not inside the operation transaction.');
// Pemeriksaan pengguna & sesi disalin apa adanya dari snapshot, supaya rute jembatan
// memakai aturan sesi produksi yang sama persis.
const authorize=source.slice(mainAt+mainTx.length-userLine.length,queryAt+queryLine.length);
for(const piece of ['portal_auth_private.web_sessions','user.request_id = requestId','Profil pegawai tidak aktif.'])if(!authorize.includes(piece))throw new Error(`Session verification block changed: ${piece}`);
const helpersAnchor='async function routeOperation(';
const helpers=`// --- Pengelolaan Kunjungan (build-visits-deploy.mjs) ---
// Galat dari modul visits memakai kelas AppError salinannya sendiri; diubah ke
// AppError snapshot supaya status 403/404/409/422 tidak berubah menjadi 503.
function adoptVisitError(error) {
  if (!(error instanceof AppError) && error instanceof Error && Number.isInteger(error.status) && error.status >= 400 && error.status < 600) throw new AppError(error.status, error.message, error.details);
  throw error;
}
async function visitsBridgeRequest(client, identity, storage, b, env, authorize) {
  try {
    const planned = await transaction(client, identity, storage, async (db) => {
      const user = await authorize(db);
      const plan = await __visits.visitBridgePlan({ db, user, p: b.path.split("/"), method: b.method, body: b.body, url: new URL(\`https://portal.invalid/?\${b.query}\`) }, { has });
      return { user, plan };
    }, false);
    const data = await __visits.callBridge(__visits.bridgeConfig(env), planned.plan.operation, planned.plan.payload);
    if (!planned.plan.audit) return data;
    return await transaction(client, identity, storage, (db) => __visits.visitBridgeFinish({ db, user: planned.user, plan: planned.plan, data }, { audit }), true);
  } catch (error) {
    adoptVisitError(error);
  }
}
`;
const intercept=`      if (typeof b.path === "string" && __visits.isVisitBridgeRequest(b.path, b.method)) {
        const result = await visitsBridgeRequest(client, identity, storage, b, Deno.env.toObject(), async (db) => {
${authorize}
          assert(!user.must_change_password, "Anda wajib mengganti password sementara terlebih dahulu.", 428);
          return user;
        });
        workCompleted = true;
        return Response.json({ ok: true, result }, { headers: { "Cache-Control": "no-store", "X-SPH-Modules-Revision": "20261016.1" } });
      }
`;
let patched=source.slice(0,mainAt)+intercept+source.slice(mainAt);
// Pengganti berupa fungsi: string pengganti akan menafsirkan pola $1/$$/$& di dalam kode.
patched=patched.replace(leaveRoute,()=>leaveRoute+'\n  if (p[0] === "visits") return __visits.visitRoutes({ db, user, p, method, body, url }, { has, audit }).catch(adoptVisitError);');
// Modul visits dibundel terpisah lalu dibungkus satu lingkup (__visits), supaya
// nama di snapshot (assert, has, audit, AppError, …) tidak diganti esbuild dan
// diff snapshot hanya berupa sisipan yang mudah ditinjau.
const shared=resolve('supabase/functions/_shared/portal');
const bundled=await build({stdin:{contents:`export {visitRoutes,visitBridgePlan,visitBridgeFinish,isVisitBridgeRequest} from './visits.mjs';\nexport {bridgeConfig,callBridge} from './visits-bridge.mjs';\n`,resolveDir:shared,sourcefile:'visits-entry.mjs',loader:'js'},
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
for(const name of ['visitRoutes','visitBridgePlan','visitBridgeFinish','isVisitBridgeRequest','bridgeConfig','callBridge'])if(!exported.some(e=>e===name||e.endsWith(` as ${name}`)))throw new Error(`Visits export missing: ${name}`);
const body=moduleText.slice(0,exportMatch.index);
const namespace=`// --- Modul Pengelolaan Kunjungan, dibangkitkan dari lib/visits*.mjs dan lib/guide-form.mjs ---
const __visits = (() => {
${aliases.join('\n')}
${body}
  return { ${exported.map(e=>{const [orig,as=orig]=e.split(/\s+as\s+/);return `${as}: ${orig}`;}).join(', ')} };
})();
`;
patched=patched.replace(helpersAnchor,()=>namespace+helpers+helpersAnchor);
patched=imports.join('\n')+'\n'+patched;
const {parse}=await import('./cloud-tools/node_modules/acorn/dist/acorn.mjs');
parse(patched,{ecmaVersion:'latest',sourceType:'module'});
const out=resolve('supabase/deploy/portal-api/index.ts');mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,patched);
console.log(JSON.stringify({source_sha256:sha,output:out,output_sha256:createHash('sha256').update(readFileSync(out)).digest('hex'),patches:['visits module imports','visits database routes in routeOperation','visits bridge routes outside the write transaction']}));
