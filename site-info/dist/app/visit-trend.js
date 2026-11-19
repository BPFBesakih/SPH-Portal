import {esc,formatDate} from './ui.js';

// Grafik tren Laporan Kunjungan: SVG buatan sendiri (tanpa pustaka, tanpa gaya inline, sesuai
// CSP portal). Tiga panel bersumbu waktu sama — Nilai rata-rata, Ketaatan (% ID terpasang dan
// % seragam lengkap), dan Pengantaran — dengan satu garis bantu dan satu tooltip untuk semua
// angka di titik itu. Bisa dipakai dengan papan ketik (← → Home End, Esc). Tabel di bawah
// grafik (visits.js) memuat angka yang sama untuk dibaca tanpa grafik.
//
// slots: [{mulai,sampai,mendatang?,berjalan?,pengantaran,guideDinilai,nilai,persenId,persenSeragam,etikaRata}]
// unit : 'hari' | 'minggu' | 'bulan' (label sumbu dan judul tooltip)

const num=(v,d=1)=>Number(v).toLocaleString('id-ID',{maximumFractionDigits:d});
const pctText=v=>v==null?'—':`${num(v*100)}%`;
const etikaText=v=>v==null?'—':`${v>0?'+':v<0?'−':''}${Math.abs(v).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const dayNumber=day=>Number(day.slice(8,10));
const weekday=day=>formatDate(day,{weekday:'short'});

// "16–22 Nov 2026", "27 Okt – 2 Nov 2026", "29 Des 2025 – 4 Jan 2026".
export function rangeLabel(from,to){
 if(from===to)return formatDate(from);
 if(from.slice(0,7)===to.slice(0,7))return `${dayNumber(from)}–${formatDate(to)}`;
 if(from.slice(0,4)===to.slice(0,4))return `${formatDate(from,{day:'numeric',month:'short'})} – ${formatDate(to)}`;
 return `${formatDate(from)} – ${formatDate(to)}`;
}
const monthTitle=day=>formatDate(day,{month:'long',year:'numeric'});
function slotTitle(s,unit){
 if(unit==='hari')return formatDate(s.mulai,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
 if(unit==='bulan')return monthTitle(s.mulai);
 return `Minggu ${rangeLabel(s.mulai,s.sampai)}`;
}
function axisLabel(s,unit,i,dense){
 if(unit==='hari')return dense?formatDate(s.mulai,{day:'numeric',month:'short'}):`${weekday(s.mulai)} ${dayNumber(s.mulai)}`;
 if(unit==='bulan')return i===0||s.mulai.slice(5,7)==='01'?formatDate(s.mulai,{month:'short',year:'numeric'}):formatDate(s.mulai,{month:'short'});
 return formatDate(s.mulai,{day:'numeric',month:'short'});
}

// Rentang sumbu yang rapi. Garis tidak harus mulai dari nol; kolom selalu dari nol.
function niceStep(span,count){const raw=span/Math.max(1,count),mag=10**Math.floor(Math.log10(raw)),n=raw/mag;return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*mag;}
function scaleOf(values,{zero=false,floor=-Infinity,ceil=Infinity,minSpan=1,ticks=3}={}){
 let lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):minSpan;
 if(zero)lo=0;
 if(hi-lo<minSpan){const pad=(minSpan-(hi-lo))/2;lo-=pad;hi+=pad;if(lo<floor){hi+=floor-lo;lo=floor;}if(hi>ceil){lo-=hi-ceil;hi=ceil;}}
 const step=niceStep(hi-lo,ticks);
 lo=Math.max(floor,Math.floor(lo/step)*step);hi=Math.min(ceil,Math.ceil(hi/step)*step);if(hi<=lo)hi=lo+step;
 const list=[];for(let v=lo;v<=hi+step/1000;v+=step)list.push(Math.round(v*1000)/1000);
 return {lo,hi,ticks:list};
}

// Panel dan seri. Nilai bisa di atas 100 (Etika plus), paling tinggi 110.
const panels=[
 {key:'nilai',title:'Nilai rata-rata',height:96,line:true,scale:{floor:0,ceil:110,minSpan:10},tick:v=>num(v,0),
  series:[{key:'nilai',cls:'s1',label:'Nilai rata-rata',value:s=>s.nilai,text:v=>v==null?'—':num(v)}]},
 {key:'taat',title:'Ketaatan',height:96,line:true,scale:{floor:0,ceil:100,minSpan:10},tick:v=>`${num(v,0)}%`,
  series:[{key:'persenId',cls:'s1',label:'ID terpasang',short:'ID',value:s=>s.persenId==null?null:s.persenId*100,text:pctText},
   {key:'persenSeragam',cls:'s2',label:'Seragam lengkap',short:'Seragam',value:s=>s.persenSeragam==null?null:s.persenSeragam*100,text:pctText}]},
 {key:'antar',title:'Pengantaran',height:64,bars:true,scale:{zero:true,floor:0,minSpan:4,ticks:3},tick:v=>num(v,0),
  series:[{key:'pengantaran',cls:'s3',label:'Pengantaran',value:s=>s.mendatang?null:s.pengantaran,text:v=>v==null?'—':num(v,0)}]}
];
const LEFT=40,RIGHT=48,TITLE=22,GAP=16,AXIS=26,BAR_MAX=24;

function geometry(width,slots){
 const plotW=Math.max(160,width-LEFT-RIGHT),slotW=plotW/slots.length;
 let y=0;
 const layout=panels.map(p=>{const values=[];for(const s of slots)for(const se of p.series){const v=se.value(s);if(v!=null&&!s.mendatang)values.push(v);}
  const scale=p.key==='nilai'&&!values.some(v=>v>100)?{...p.scale,ceil:100}:p.scale;
  const top=y+TITLE,bottom=top+p.height;y=bottom+GAP;return {...p,top,bottom,...scaleOf(values,scale)};});
 const height=y-GAP+AXIS;
 return {width,height,plotW,slotW,layout,x:i=>LEFT+slotW*(i+0.5)};
}
const yOf=(p,v)=>p.bottom-(v-p.lo)/(p.hi-p.lo)*(p.bottom-p.top);
const f1=v=>Math.round(v*10)/10;

function linePath(points){
 let d='',open=false;
 for(const pt of points){if(pt==null){open=false;continue;}d+=`${open?'L':'M'}${f1(pt.x)} ${f1(pt.y)}`;open=true;}
 return d;
}
// Kolom dengan ujung data membulat 4px dan pangkal persegi di garis dasar.
function barPath(x,w,y,base){
 const h=base-y;if(h<=0)return '';
 const r=Math.min(4,h,w/2);
 return `M${f1(x)} ${f1(base)}V${f1(y+r)}Q${f1(x)} ${f1(y)} ${f1(x+r)} ${f1(y)}H${f1(x+w-r)}Q${f1(x+w)} ${f1(y)} ${f1(x+w)} ${f1(y+r)}V${f1(base)}Z`;
}

function svgMarkup(g,slots,unit,narrow){
 const parts=[],{layout,x,slotW}=g,n=slots.length,last=LEFT+g.plotW;
 const firstFuture=slots.findIndex(s=>s.mendatang);
 const dots=slots.length<=14;
 for(const p of layout){
  // Judul panel; panel dua seri diberi legenda garis (identitas tidak hanya lewat warna).
  parts.push(`<text class="viz-title" x="${LEFT}" y="${p.top-8}">${esc(p.title)}</text>`);
  if(p.series.length>1){let lx=LEFT+p.title.length*7+18;for(const se of p.series){const label=narrow?se.short:se.label;parts.push(`<line class="viz-key ${se.cls}" x1="${lx}" x2="${lx+14}" y1="${p.top-12}" y2="${p.top-12}"/><text class="viz-legend" x="${lx+19}" y="${p.top-8}">${esc(label)}</text>`);lx+=label.length*6.4+36;}}
  if(firstFuture>=0)parts.push(`<rect class="viz-future" x="${f1(LEFT+slotW*firstFuture)}" y="${p.top}" width="${f1(slotW*(n-firstFuture))}" height="${p.height}"/>`);
  for(const t of p.ticks){const y=f1(yOf(p,t));parts.push(`<line class="${t===p.lo?'viz-axis':'viz-grid'}" x1="${LEFT}" x2="${f1(last)}" y1="${y}" y2="${y}"/><text class="viz-tick" x="${LEFT-6}" y="${y+4}" text-anchor="end">${esc(p.tick(t))}</text>`);}
  if(p.bars){
   const w=Math.min(BAR_MAX,Math.max(2,slotW*0.62)),se=p.series[0];
   slots.forEach((s,i)=>{const v=se.value(s);if(!v)return;parts.push(`<path class="viz-bar" data-i="${i}" d="${barPath(x(i)-w/2,w,yOf(p,v),p.bottom)}"/>`);});
   continue;
  }
  for(const se of p.series){
   const pts=slots.map((s,i)=>{const v=s.mendatang?null:se.value(s);return v==null?null:{x:x(i),y:yOf(p,v),i,open:s.berjalan};});
   parts.push(`<path class="viz-line ${se.cls}" d="${linePath(pts)}"/>`);
   // Titik: semua bila sedikit; selain itu hanya titik tunggal dan ujung. Periode yang masih
   // berjalan digambar berongga.
   const lastPoint=pts.reduce((a,pt)=>pt||a,null);
   pts.forEach((pt,i)=>{if(!pt)return;const alone=!pts[i-1]&&!pts[i+1];if(dots||alone||pt===lastPoint)parts.push(`<circle class="viz-dot ${se.cls}${pt.open?' open':''}" cx="${f1(pt.x)}" cy="${f1(pt.y)}" r="4"/>`);});
  }
  // Angka di ujung garis, hanya bila tidak bertabrakan.
  const ends=p.series.map(se=>{let i=n-1;while(i>=0&&(slots[i].mendatang||se.value(slots[i])==null))i--;return i<0?null:{y:yOf(p,se.value(slots[i])),text:se.text(slots[i][se.key]),x:x(i)};});
  const clash=ends.length===2&&ends[0]&&ends[1]&&Math.abs(ends[0].y-ends[1].y)<14;
  if(!clash)for(const e of ends)if(e)parts.push(`<text class="viz-end" x="${f1(e.x+8)}" y="${f1(e.y+4)}">${esc(e.text)}</text>`);
 }
 // Sumbu waktu di bawah panel terakhir: label dijarangkan supaya tidak bertumpuk.
 const bottom=layout.at(-1).bottom,dense=unit==='hari'&&n>8,room=unit==='hari'&&!dense?44:58,step=Math.max(1,Math.ceil(n/Math.max(1,Math.floor(g.plotW/room))));
 slots.forEach((s,i)=>{if(i%step)return;parts.push(`<text class="viz-tick" x="${f1(x(i))}" y="${bottom+18}" text-anchor="middle">${esc(axisLabel(s,unit,i,dense))}</text>`);});
 // Lapisan sorot: garis bantu, titik aktif, dan sasaran sentuh selebar slot.
 parts.push(`<g class="viz-hover" hidden><line class="viz-cross" y1="${layout[0].top}" y2="${bottom}"/></g>`);
 parts.push(`<rect class="viz-hit" x="${LEFT}" y="0" width="${f1(g.plotW)}" height="${bottom}"/>`);
 return `<svg viewBox="0 0 ${g.width} ${g.height}" width="${g.width}" height="${g.height}" aria-hidden="true" focusable="false">${parts.join('')}</svg>`;
}

function tipMarkup(s,unit){
 const rows=[
  ['s1',s.nilai==null?'—':num(s.nilai),'Nilai rata-rata'],
  ['s1',pctText(s.persenId),'ID terpasang'],
  ['s2',pctText(s.persenSeragam),'Seragam lengkap'],
  ['',etikaText(s.etikaRata),'Etika rata-rata'],
  ['s3',s.mendatang?'—':num(s.pengantaran||0,0),s.mendatang?'Pengantaran':`Pengantaran · ${num(s.guideDinilai||0,0)} guide`]];
 const note=s.mendatang?'Belum berjalan':s.berjalan?`Masih berjalan, sampai ${formatDate(s.sampai,{day:'numeric',month:'short'})}`:!s.pengantaran?'Tidak ada penilaian':'';
 return `<strong>${esc(slotTitle(s,unit))}</strong>${note?`<span class="muted">${esc(note)}</span>`:''}<dl>${rows.map(([cls,value,label])=>`<dt>${esc(value)}</dt><dd>${cls?`<span class="key ${cls}"></span>`:''}${esc(label)}</dd>`).join('')}</dl>`;
}

// Ringkasan untuk pembaca layar: rentang, titik berisi, dan nilai awal/akhir.
function summary(slots,unit){
 const filled=slots.filter(s=>!s.mendatang&&s.pengantaran);
 if(!filled.length)return 'Grafik tren: belum ada penilaian pada rentang ini.';
 const first=filled[0],last=filled.at(-1);
 return `Grafik tren ${slots.length} ${unit==='hari'?'hari':unit==='minggu'?'minggu':'bulan'}, ${filled.length} berisi penilaian. Nilai rata-rata ${num(first.nilai)} (${slotTitle(first,unit)}) sampai ${num(last.nilai)} (${slotTitle(last,unit)}). Angka lengkap ada di tabel di bawah grafik. Gunakan panah kiri dan kanan untuk membaca tiap titik.`;
}

let observer=null;
// Gambar grafik ke dalam `el` selebar wadahnya; digambar ulang saat lebarnya berubah.
export function mountTrend(el,slots,unit){
 observer?.disconnect();observer=null;
 if(!el)return;
 if(!slots.some(s=>!s.mendatang&&s.pengantaran)){el.innerHTML='<p class="visit-trend-empty">Belum ada penilaian pada rentang ini.</p>';el.removeAttribute('tabindex');return;}
 el.tabIndex=0;el.setAttribute('role','group');el.setAttribute('aria-label',summary(slots,unit));
 let active=-1,g=null,drawnWidth=0,docked=false;
 const lastFilled=()=>{let i=slots.length-1;while(i>0&&(slots[i].mendatang||!slots[i].pengantaran))i--;return i;};
 const draw=()=>{
  const width=Math.round(el.clientWidth);if(!width||width===drawnWidth)return;drawnWidth=width;
  g=geometry(width,slots);docked=width<560;el.classList.toggle('docked',docked);
  el.innerHTML=svgMarkup(g,slots,unit,width<480)+`<div class="visit-trend-tip" role="status" aria-live="polite"${docked?'':' hidden'}></div>`;
  if(active>=0||docked)show(active>=0?active:lastFilled());
 };
 const show=i=>{
  active=i;const svg=el.querySelector('svg'),tip=el.querySelector('.visit-trend-tip'),hover=svg?.querySelector('.viz-hover');if(!svg||!g)return;
  const cx=g.x(i),s=slots[i];
  hover.removeAttribute('hidden');hover.querySelector('.viz-cross').setAttribute('x1',f1(cx));hover.querySelector('.viz-cross').setAttribute('x2',f1(cx));
  for(const old of hover.querySelectorAll('circle'))old.remove();
  if(!s.mendatang)for(const p of g.layout)if(!p.bars)for(const se of p.series){const v=se.value(s);if(v==null)continue;
   const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('class',`viz-dot ${se.cls} on`);dot.setAttribute('cx',f1(cx));dot.setAttribute('cy',f1(yOf(p,v)));dot.setAttribute('r','5');hover.append(dot);}
  for(const bar of svg.querySelectorAll('.viz-bar'))bar.classList.toggle('on',Number(bar.dataset.i)===i);
  tip.innerHTML=tipMarkup(s,unit);tip.hidden=false;if(docked)return;
  // Tooltip di sisi yang lebih lapang, tidak keluar dari wadah.
  const scale=el.clientWidth/g.width,box=tip.getBoundingClientRect(),room=el.clientWidth;
  let left=cx*scale+14;if(left+box.width>room)left=cx*scale-14-box.width;
  tip.style.left=`${Math.max(0,Math.round(left))}px`;tip.style.top=`${Math.round(g.layout[0].top*scale)}px`;
 };
 const hide=()=>{if(docked)return;active=-1;const tip=el.querySelector('.visit-trend-tip'),hover=el.querySelector('.viz-hover');if(tip)tip.hidden=true;hover?.setAttribute('hidden','');for(const bar of el.querySelectorAll('.viz-bar.on'))bar.classList.remove('on');};
 const indexAt=clientX=>{const rect=el.querySelector('svg').getBoundingClientRect(),x=(clientX-rect.left)*g.width/rect.width;return Math.min(slots.length-1,Math.max(0,Math.floor((x-LEFT)/g.slotW)));};
 el.onpointermove=el.onpointerdown=e=>{if(g&&e.target.closest?.('svg'))show(indexAt(e.clientX));};
 el.onpointerleave=()=>{if(document.activeElement!==el)hide();};
 el.onfocus=()=>{if(active<0)show(lastFilled());};
 el.onblur=hide;
 el.onkeydown=e=>{
  const keys={ArrowLeft:-1,ArrowRight:1};
  if(e.key in keys){e.preventDefault();show(Math.min(slots.length-1,Math.max(0,(active<0?slots.length-1:active)+keys[e.key])));}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();show(e.key==='Home'?0:slots.length-1);}
  else if(e.key==='Escape')hide();
 };
 draw();
 if(typeof ResizeObserver==='function'){const watch=new ResizeObserver(()=>{if(el.isConnected)draw();else{watch.disconnect();if(observer===watch)observer=null;}});watch.observe(el);observer=watch;}
}
