// Bangun Edge Function attendance-form (halaman absen /absen/ tanpa login) menjadi
// satu berkas untuk di-deploy: supabase/deploy/attendance-form/index.ts.
// Fungsi ini berdiri sendiri dan tidak menyentuh snapshot portal-api.
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from './cloud-tools/node_modules/esbuild/lib/main.js';
const root=new URL('../',import.meta.url),output=new URL('supabase/deploy/attendance-form/',root);
mkdirSync(output,{recursive:true});
const out=fileURLToPath(new URL('index.ts',output));
await build({entryPoints:[fileURLToPath(new URL('supabase/functions/attendance-form/index.ts',root))],outfile:out,bundle:true,format:'esm',platform:'neutral',target:'es2022',packages:'external',external:['node:*','npm:*'],legalComments:'none'});
console.log(JSON.stringify({output:out,output_sha256:createHash('sha256').update(readFileSync(out)).digest('hex')}));
