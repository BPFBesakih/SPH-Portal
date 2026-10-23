import {api} from './api.js';
import {dialog,esc} from './ui.js';

export async function openCoachingShareLink(){
  const result=await api('coaching-form-link');
  if(typeof result.token!=='string'||!/^[a-f0-9]{64}$/.test(result.token))throw new Error('Tautan coaching belum tersedia.');
  const url=new URL('/coaching/',location.origin);url.hash=result.token;
  const el=dialog('Link Formulir Coaching',`<p class="detail-prose">Bagikan link ini kepada karyawan untuk mengisi coaching tanpa login. Hasilnya tersimpan di portal.</p><label class="field full"><span>Link Formulir Coaching</span><input type="url" readonly value="${esc(url.href)}" data-coaching-share-link></label><div class="actions"><button type="button" class="button primary" data-copy-coaching-link>Salin link</button><a class="button outlined" href="${esc(url.href)}" target="_blank" rel="noreferrer">Buka formulir</a></div><p role="status" data-coaching-copy-status></p>`);
  const copy=async()=>{const input=el.querySelector('[data-coaching-share-link]'),status=el.querySelector('[data-coaching-copy-status]');try{await navigator.clipboard.writeText(url.href);status.textContent='Link formulir coaching berhasil disalin.';}catch{input.focus();input.select();status.textContent='Pilih Salin link atau salin tautan di atas secara manual.';}};
  el.querySelector('[data-copy-coaching-link]').addEventListener('click',copy);
  await copy();
}
