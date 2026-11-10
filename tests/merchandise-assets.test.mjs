import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

// Di produksi merchandise.js dibundel ke /portal-static/. Aset yang dirujuk
// relatif terhadap modul (new URL('./assets/…',import.meta.url)) akan mengarah
// ke /portal-static/assets/… yang tidak ada, sehingga Ekspor Stok Bulanan gagal
// dengan "Logo resmi BPFKSPA gagal dimuat".
test('logo Ekspor Stok Bulanan dimuat dari /app/assets/ setelah dibundel',async()=>{
  const source=await read('public/merchandise.js');
  assert.doesNotMatch(source,/new URL\(\s*['"]\.\/assets\//);
  assert.match(source,/exportModuleURL\('assets\/bp-besakih\.png'\)/);
  const definition=source.match(/const exportModuleURL=(name=>[^;]+);/)?.[1];
  assert(definition,'exportModuleURL tidak ditemukan');

  const manifest=JSON.parse(await read('site-info/dist/portal-static/manifest.json'));
  const bundle=await read('site-info/dist'+manifest.javascript);
  assert.doesNotMatch(bundle,/new URL\(\s*"\.\/assets\//);
  assert.match(bundle,/"assets\/bp-besakih\.png"/);

  for(const [base,expected,file] of [
    ['https://bpbesakih.com'+manifest.javascript,'/app/assets/bp-besakih.png','site-info/dist/app/assets/bp-besakih.png'],
    ['http://localhost:3000/merchandise.js','/assets/bp-besakih.png','public/assets/bp-besakih.png']
  ]){
    const exportModuleURL=new Function('name',`return (${definition.replaceAll('import.meta.url','this')})(name);`).bind(base);
    assert.equal(new URL(exportModuleURL('assets/bp-besakih.png')).pathname,expected);
    await access(new URL(file,root));
  }
});
