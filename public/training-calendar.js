import {esc,icon,formatDate,formatTime,labels,badge,dialog} from './ui.js';

const MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const WEEKDAYS=['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
const STATUSES=['COMPLETED','PLANNED','CANCELLED'];

// Every calendar boundary uses WITA (UTC+08:00), including events crossing
// midnight. The ending instant is exclusive: 00:00 belongs to the prior day.
export const witaDay=instant=>new Date(Date.parse(instant)+8*3600000).toISOString().slice(0,10);
export const calendarDayEvents=(items,day)=>items.filter(event=>
  event.starts_at&&event.ends_at&&witaDay(event.starts_at)<=day&&
  witaDay(new Date(Date.parse(event.ends_at)-1).toISOString())>=day
);
export const calendarCells=(year,month)=>{
  const offset=(new Date(Date.UTC(year,month,1)).getUTCDay()+6)%7;
  const days=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return Array.from({length:Math.ceil((offset+days)/7)*7},(_,i)=>{
    const day=i-offset+1;
    return day>=1&&day<=days?day:null;
  });
};
const keyFor=(year,month,day)=>`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const statusClass=status=>STATUSES.includes(status)?status.toLowerCase():'unknown';
const countsFor=events=>Object.fromEntries(STATUSES.map(s=>[s,events.filter(e=>e.status===s).length]));
const statusDots=events=>STATUSES.filter(s=>events.some(e=>e.status===s)).map(s=>`<span class="training-dot ${statusClass(s)}" title="${esc(labels[s])}"></span>`).join('');
const dayLabel=(day,events)=>`${formatDate(day+'T12:00:00+08:00',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}, ${events.length} kegiatan`;

function monthGrid(items,year,month,mini=false,selectedDay=null){
  return `<div class="training-grid ${mini?'mini':''}" role="group" aria-label="Kalender ${MONTHS[month]} ${year}">
    ${WEEKDAYS.map(day=>`<div class="training-weekday">${day}</div>`).join('')}
    ${calendarCells(year,month).map(day=>{
      if(!day)return '<div class="training-outside" aria-hidden="true"></div>';
      const key=keyFor(year,month,day),events=calendarDayEvents(items,key);
      const classes=[...new Set(events.map(e=>statusClass(e.status)))];
      return `<button type="button" class="training-day ${events.length?'has-events':''} ${mini?'mini-day':''} ${key===selectedDay?'selected':''}" data-action="training-day" data-date="${key}" aria-label="${esc(dayLabel(key,events))}" aria-pressed="${key===selectedDay}">
        <span class="training-day-number">${day}</span>
        ${mini?`<span class="training-day-dots">${statusDots(events)}</span>`:`<span class="training-day-events">${events.slice(0,2).map(event=>`<span class="training-event-chip ${statusClass(event.status)}" title="${esc(event.title)}">${esc(event.title)}</span>`).join('')}${events.length>2?`<span class="training-more">+${events.length-2} lainnya</span>`:''}</span>`}
        ${!mini&&events.length===0?'<span class="training-no-event" aria-hidden="true"></span>':''}
        ${mini&&classes.length>1?'<span class="sr-only">Beberapa status</span>':''}
      </button>`;
    }).join('')}
  </div>`;
}

function dailyAgenda(items,day,viewableIds){
  if(!day)return `<div class="training-selected-empty">Pilih tanggal untuk melihat rincian kegiatan.</div>`;
  const events=calendarDayEvents(items,day);
  return `<section class="card training-agenda" aria-label="Kegiatan tanggal terpilih">
    <header class="training-agenda-head"><div><p class="eyebrow">Agenda harian</p><h2>${esc(formatDate(day+'T12:00:00+08:00',{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}</h2></div><span class="chip">${events.length} kegiatan</span></header>
    ${events.length?`<div class="training-agenda-list">${events.map(event=>`<button class="training-agenda-item" type="button" data-action="training-calendar-event" data-id="${esc(event.id)}">
      <span class="training-agenda-bar ${statusClass(event.status)}"></span>
      <span class="training-agenda-text"><strong>${esc(event.title)}</strong><small>${esc(formatTime(event.starts_at))}–${esc(formatTime(event.ends_at))} WITA · ${esc(event.location||'Lokasi belum ditentukan')}</small></span>
      ${badge(event.status)}${viewableIds.has(event.id)?icon('chevron'):''}
    </button>`).join('')}</div>`:`<p class="training-agenda-empty">Tidak ada kegiatan atau pelatihan pada tanggal ini.</p>`}
  </section>`;
}

export function trainingCalendarView({items,view,year,month,selectedDay,viewableIds=new Set()}){
  const counts=countsFor(items);
  const header=`<section class="training-calendar-top">
    <div class="training-calendar-heading"><div><p class="eyebrow">Kalender SDM</p><h2>${view==='year'?year:`${MONTHS[month]} ${year}`}</h2><p>Pantau rencana dan realisasi kegiatan sepanjang tahun.</p></div>
      <div class="training-calendar-nav">
        <button type="button" class="icon-button" data-action="training-prev" aria-label="${view==='year'?'Tahun':'Bulan'} sebelumnya">${icon('chevron')}</button>
        <button type="button" class="button outlined" data-action="training-today">Hari ini</button>
        <button type="button" class="icon-button training-next" data-action="training-next" aria-label="${view==='year'?'Tahun':'Bulan'} berikutnya">${icon('chevron')}</button>
      </div>
    </div>
    <div class="training-calendar-legend" aria-label="Legenda status kegiatan">
      ${STATUSES.map(s=>`<span class="training-legend-item"><span class="training-dot ${statusClass(s)}"></span>${esc(labels[s])}</span>`).join('')}
      <span class="training-legend-item"><span class="training-dot no-events"></span>Tanpa kegiatan</span>
    </div>
  </section>`;
  if(view==='year')return header+`<div class="training-year-grid">${MONTHS.map((name,m)=>{
    const inMonth=items.filter(e=>e.starts_at&&e.ends_at&&witaDay(e.starts_at)<=keyFor(year,m,new Date(Date.UTC(year,m+1,0)).getUTCDate())&&witaDay(new Date(Date.parse(e.ends_at)-1).toISOString())>=keyFor(year,m,1));
    return `<section class="card training-mini-month"><header><h3>${name}</h3><span>${inMonth.length} kegiatan</span></header>${monthGrid(items,year,m,true)}</section>`;
  }).join('')}</div><div class="training-year-totals" aria-label="Ringkasan jumlah kegiatan">${STATUSES.map(s=>`<div class="training-year-stat"><span class="training-dot ${statusClass(s)}"></span><strong>${counts[s]}</strong><span>${esc(labels[s])}</span></div>`).join('')}</div>`;
  return header+monthGrid(items,year,month,false,selectedDay)+dailyAgenda(items,selectedDay,viewableIds);
}

export function showTrainingCalendarEvent(event,canOpenDetails=false){
  const content=`<section class="training-summary-detail"><div>${badge(event.status)}</div>
    <div class="detail-grid"><div><p class="detail-label">Mulai</p><p class="detail-value">${esc(formatDate(event.starts_at))} · ${esc(formatTime(event.starts_at))} WITA</p></div>
    <div><p class="detail-label">Selesai</p><p class="detail-value">${esc(formatDate(event.ends_at))} · ${esc(formatTime(event.ends_at))} WITA</p></div>
    <div><p class="detail-label">Lokasi</p><p class="detail-value">${esc(event.location||'Belum ditentukan')}</p></div></div>
    <section><h3>Keterangan</h3><p class="detail-prose">${esc(event.description||'Belum ada keterangan.')}</p></section>
    ${canOpenDetails?`<div class="form-actions"><button type="button" class="button outlined" data-action="training-open-private" data-id="${esc(event.id)}">${icon('eye')}<span>Buka detail kegiatan</span></button></div>`:''}
  </section>`;
  return dialog(event.title,content,{wide:true,subtitle:'Ringkasan kalender kegiatan'});
}
