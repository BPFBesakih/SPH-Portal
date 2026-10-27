import './photo-slideshow.js';
import {bindAnnouncements,syncAnnouncementBadges,announcementSummary,handleAnnouncementAction,unreadAnnouncementCount,loadAnnouncementSummary,invalidateAnnouncementSummary,resetAnnouncementSummary} from './announcements.js';
import {showReportPhoto} from './field-reports.js';
import {state,api,post,refresh,permitted} from './api.js';
import {esc,icon,avatar,button,formDialog,dialog,toast,formatDate,localToday} from './ui.js';
import {loadPage,pageTitles,employeeRows,importRows,documentRows,incidentRows,logbookRows,rosterPage,configPage,documentsPage,incidentsPage,trainingPage} from './pages.js';
import {showTrainingCalendarEvent} from './training-calendar.js';
import {handleFormAction} from './forms.js';
import {bindBriefings,handleBriefingAction} from './briefings.js';
import {openCoachingShareLink} from './coaching-link-management.js';
import {openReportExport} from './report-exports.js';
import {openDetail,closeDetails} from './details.js';
import {purchasingNav,purchasingRoutes,purchasingAllowed,loadPurchasingOverview,invalidatePurchasingOverview,handlePurchasingAction,bindPurchasingPage,afterPurchasingPage,purchasingNotices,resetPurchasingState} from './purchasing.js';
import {createNavigationQueue} from './navigation-queue.js';
import {registerServiceWorker} from './pwa.js';
const app=document.querySelector('#app'),navigation=createNavigationQueue();
let renderedWorkspace='',renderedNavigation='';
function applyTheme(theme){
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]').content=getComputedStyle(document.documentElement).getPropertyValue('--besakih-theme-color').trim();
}
const navs={hr:[['dashboard','Dashboard','dashboard','hr.'],['employees','Data Pegawai & Organisasi','people','hr.employees.read'],['documents','Regulasi & SOP','document','hr.documents.read'],['training','Kegiatan & Pelatihan','training','training-calendar'],['coaching','Evaluasi & Coaching','coaching','hr.coaching.read']],security:[['security','Dashboard','dashboard','security.'],['roster','Jadwal & Penugasan','calendar','security.roster.read'],['logbook','Logbook & Patroli','log','security.logbook.read'],['incidents','Laporan Kejadian','incident','security.incidents.read'],['sop','SOP Keamanan','document','hr.documents.read']],purchasing:purchasingNav};
const commonNav=[['announcements','Informasi Internal','bell','announcements'],['briefings','Briefing Pagi','coaching','briefings']];
const adminNav=[['accounts','Akun Pengguna','people','admin.users.read'],['roles','Role & Izin','key','admin.roles.read'],['audit','Riwayat Aktivitas','audit','admin.audit.read']];
const hasHrDashboard=()=>state.permissions.some(p=>p.startsWith('hr.')&&(!state.permissions.some(x=>x.startsWith('security.'))||!['hr.documents.read','hr.documents.download'].includes(p)));
const hasModule=module=>module==='hr'?Boolean(state.me):module==='purchasing'?state.permissions.some(p=>p.startsWith('purchasing.'))||state.me?.purchasing_pending>0||state.purchasing?.counts?.approvals>0:state.permissions.some(p=>p.startsWith(module+'.'));
const visible=([,,,permission])=>permission==='training-calendar'?Boolean(state.me):['announcements','briefings'].includes(permission)?true:permission.startsWith('purchasing:')?purchasingAllowed(permission.slice(11)):permission.endsWith('.')?state.permissions.some(p=>p.startsWith(permission)):permitted(permission)||(permission==='hr.coaching.read'&&permitted('hr.coaching.manage'));
function currentRoute(){const r=location.hash.slice(1).split('?')[0];if(r==='pr-verify')return r;const active=activeRoute(r),entry=[...navs.hr,...navs.security,...navs.purchasing,...commonNav,...adminNav].find(n=>n[0]===active),isPurchasing=purchasingRoutes.includes(r),isHr=['dashboard','employees','organization','imports','documents','training','coaching'].includes(r),isSecurity=['security','roster','roster-settings','logbook','incidents','sop'].includes(r);return pageTitles[r]&&entry&&visible(entry)&&(!isHr||hasModule('hr'))&&(!isSecurity||hasModule('security'))&&(!isPurchasing||hasModule('purchasing'))?r:(hasHrDashboard()?'dashboard':hasModule('security')?'security':hasModule('purchasing')?'purchasing':permitted('admin.users.read')?'accounts':permitted('admin.roles.read')?'roles':'training');}
function activeRoute(route){return ['organization','imports'].includes(route)?'employees':route==='roster-settings'?'roster':route;}
function navLink([route,label,ico]){return `<a href="#${route}" class="nav-link ${activeRoute(state.route)===route?'active':''}" ${activeRoute(state.route)===route?'aria-current="page"':''}>${icon(ico)}<span>${esc(label)}</span>${route==='announcements'?'<span class="badge-count" data-announcement-count hidden></span>':''}${route==='pr-approvals'&&state.purchasing?.counts?.approvals?`<span class="badge-count">${Number(state.purchasing.counts.approvals)}</span>`:''}</a>`;}
function workspaceSwitch(){
  const hr=hasModule('hr'),security=hasModule('security'),purchasing=hasModule('purchasing'),workspaces=[hr,security,purchasing].filter(Boolean).length,module=state.module;
  return `<div class="workspace-switch ${workspaces>2?'three':''}" aria-label="Pilih modul">${hr?`<button data-action="switch-hr" class="${module==='hr'?'active':''}">${icon('people')} SDM</button>`:''}${security?`<button data-action="switch-security" class="${module==='security'?'active':''}">${icon('shield')} Keamanan</button>`:''}${purchasing?`<button data-action="switch-purchasing" class="${module==='purchasing'?'active':''}">${icon('building')} Pengadaan</button>`:''}</div>`;
}
function sidebarNavigation(){const module=state.module;return `<p class="nav-group">${module==='hr'?'MANAJEMEN SDM':module==='purchasing'?'PENGADAAN':'OPERASIONAL KEAMANAN'}</p>${commonNav.map(navLink).join('')}<div class="nav-divider"></div>${navs[module].filter(visible).map(navLink).join('')}${adminNav.some(visible)?`<div class="nav-divider"></div><p class="nav-group">PENGATURAN AKSES</p>${adminNav.filter(visible).map(navLink).join('')}`:''}`;}
function shell(){
  const module=state.module;renderedWorkspace=workspaceSwitch();renderedNavigation=sidebarNavigation();
  app.innerHTML=`<div class="mobile-backdrop" data-action="mobile-close"></div><aside class="sidebar" aria-label="Navigasi utama"><a class="brand" href="#${module==='hr'?'dashboard':module==='purchasing'?'purchasing':'security'}"><img src="/app/assets/mark.svg" alt="Logo Badan Pengelola Besakih" width="42" height="42"><div><div class="brand-name">SPH-Portal</div><div class="brand-subtitle">SDM & Operasional</div></div></a>${renderedWorkspace}<nav class="sidebar-nav">${renderedNavigation}</nav><div class="sidebar-bottom"><button class="help-box" data-action="help">${icon('help')}<div><strong>Butuh bantuan?</strong><small>Panduan penggunaan portal</small></div>${icon('chevron')}</button><div class="sidebar-footnote">Badan Pengelola Besakih<span>Fasilitas Kawasan Suci Pura Agung Besakih</span></div></div></aside><div class="shell">${state.me.demo?`<div class="demo-banner">${icon('incident')}Mode demonstrasi · Data fiktif dan aturan contoh · Bukan data operasional</div>`:''}<header class="topbar"><button class="icon-button mobile-menu" data-action="mobile-menu" aria-label="Buka navigasi">${icon('menu')}</button><div class="breadcrumb"><span>Ruang kerja</span>${icon('chevron')}<strong>${state.route==='accounts'||state.route==='roles'||state.route==='audit'?'Pengaturan Akses':module==='hr'?'Sumber Daya Manusia':module==='purchasing'?'Pengadaan':'Keamanan'}</strong></div><div class="topbar-spacer"></div>${permitted('hr.employees.read')?`<form id="global-search" class="global-search">${icon('search')}<input aria-label="Cari pegawai" placeholder="Cari pegawai…"><span class="keyboard-key">↵</span></form>`:''}<div class="top-date">${icon('calendar')}${formatDate(localToday(),{day:'numeric',month:'short',year:'numeric'})}</div><button class="icon-button" data-action="theme" aria-label="Ganti tema">${icon('moon')}</button><button class="icon-button" data-action="notifications" aria-label="Buka notifikasi" aria-haspopup="true" aria-expanded="false">${icon('bell')}<span class="notification-dot" data-bell-count hidden></span></button><button class="top-profile" data-action="profile" aria-label="Menu akun">${avatar(state.me.name)}${icon('down')}</button></header><main id="main" tabindex="-1"><div class="loading-panel"><span class="spinner"></span>Memuat data…</div></main></div>`;
  app.querySelector('#global-search')?.addEventListener('submit',async e=>{e.preventDefault();state.pendingSearch=e.target.querySelector('input').value.trim();if(location.hash==='#employees')await navigate();else location.hash='employees';});
}
function refreshSummaryUI(){
  if(!state.me)return;
  const workspace=document.querySelector('.workspace-switch'),nav=document.querySelector('.sidebar-nav');
  if(workspace)workspace.outerHTML=workspaceSwitch();
  if(nav)nav.innerHTML=sidebarNavigation();
  syncAnnouncementBadges();syncBell();
  if(['dashboard','security'].includes(state.route)&&state.announcements){
    const summary=document.querySelector('.announcement-summary');
    if(summary)summary.outerHTML=announcementSummary();else document.querySelector('#main .hero')?.insertAdjacentHTML('afterend',announcementSummary());
  }
  remindOnce();
}
const needsPurchasingOverview=()=>Boolean(state.me?.user.employee_id||state.permissions.some(p=>p.startsWith('purchasing.')));
function refreshBackgroundSummaries(route){
  const session=state.me,update=()=>{if(state.me===session)refreshSummaryUI();};
  if(route!=='announcements')loadAnnouncementSummary({background:true}).then(update).catch(()=>{});
  if(needsPurchasingOverview())loadPurchasingOverview({background:true}).then(update).catch(()=>{});
}
function navigate(){return navigation.run(async isCurrent=>{
  if(!state.me){await loginPage();return;}
  if(state.me.user.must_change_password){passwordForm(true);return;}
  // Only purchasing pages need capabilities before routing. Other menus load
  // first, then refresh notification summaries in the background.
  const requested=location.hash.slice(1).split('?')[0];
  if(needsPurchasingOverview()&&(purchasingRoutes.includes(requested)||(!requested&&!hasModule('hr')&&!hasModule('security'))))try{await loadPurchasingOverview();}catch{state.purchasing=null;}
  if(!isCurrent()||!state.me)return;
  if(!hasModule(state.module))state.module=hasModule('security')?'security':hasModule('hr')||!hasModule('purchasing')?'hr':'purchasing';
  const route=currentRoute();
  if(location.hash&&location.hash.split('?')[0]!==`#${route}`)history.replaceState(null,'',`#${route}`);
  if(['security','roster','roster-settings','logbook','incidents','sop'].includes(route))state.module='security';else if(['dashboard','employees','organization','imports','documents','training','coaching'].includes(route))state.module='hr';else if(purchasingRoutes.includes(route)&&route!=='pr-verify')state.module='purchasing';
  state.route=route;shell();document.title=`${pageTitles[route]} — SPH-Portal`;
  try{
    const html=await loadPage(route);if(!isCurrent()||!state.me)return;
    document.querySelector('#main').innerHTML=html;bindPage();
    if(purchasingRoutes.includes(route)){bindPurchasingPage();await afterPurchasingPage();}
    if(!isCurrent()||!state.me)return;
    refreshSummaryUI();refreshBackgroundSummaries(route);
    if(route==='employees'&&state.pendingSearch!==undefined){state.filter=state.pendingSearch.toLowerCase();document.querySelector('#list-search').value=state.pendingSearch;delete state.pendingSearch;updateList();}
  }catch(e){if(!isCurrent()||!state.me)return;if(e.status!==401)document.querySelector('#main').innerHTML=`<div class="notice error">${icon('lock')}<div><strong>Halaman belum dapat ditampilkan</strong><p>${esc(e.message)}</p></div></div>`;}
});}
// Lonceng: jumlah informasi belum dibaca + tindakan Pengadaan yang menunggu akun ini.
function bellItems(){
  const items=hasModule('purchasing')?purchasingNotices():[];const unread=unreadAnnouncementCount();
  if(unread)items.push({route:'announcements',count:unread,title:'Informasi internal belum dibaca',note:'Pengumuman yang masih berlaku',ico:'bell'});
  return items;
}
function syncBell(){const total=bellItems().reduce((n,i)=>n+i.count,0);document.querySelectorAll('[data-bell-count]').forEach(el=>{el.textContent=total>99?'99+':total;el.hidden=!total;});}
function closeBell(){document.querySelector('.bell-panel')?.remove();document.querySelector('[data-action=notifications]')?.setAttribute('aria-expanded','false');}
function openBell(){
  closeBell();const bell=document.querySelector('[data-action=notifications]');if(!bell)return;
  const items=bellItems(),panel=document.createElement('div');panel.className='bell-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Notifikasi');
  panel.innerHTML=`<header><strong>Notifikasi</strong><button type="button" class="icon-button" data-bell-close aria-label="Tutup notifikasi">${icon('close')}</button></header>${items.length?items.map(i=>`<a class="bell-item" href="#${i.route}">${icon(i.ico)}<span><strong>${esc(i.title)}</strong><small>${esc(i.note)}</small></span><span class="badge-count">${i.count}</span></a>`).join(''):'<p class="bell-empty">Tidak ada notifikasi baru.</p>'}<a class="bell-footer" href="#announcements">Buka Informasi Internal ${icon('arrow')}</a>`;
  document.body.append(panel);const r=bell.getBoundingClientRect();panel.style.top=`${Math.round(r.bottom+8)}px`;panel.style.right=`${Math.max(12,Math.round(window.innerWidth-r.right))}px`;
  bell.setAttribute('aria-expanded','true');panel.querySelector('a,button')?.focus();
}
// Sekali per sesi browser: buka lonceng otomatis bila ada PR yang menunggu tindakan akun ini.
function remindOnce(){
  if(!hasModule('purchasing')||!purchasingNotices().length)return;const key=`besakih-bell-${state.me.user.id}`;
  try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');}catch{if(state.bellShown)return;}
  state.bellShown=true;openBell();
}
document.addEventListener('badges-changed',syncBell);
document.addEventListener('click',e=>{const panel=document.querySelector('.bell-panel');if(!panel)return;if(e.target.closest('[data-bell-close]')||e.target.closest('.bell-panel a')||(!e.target.closest('.bell-panel')&&!e.target.closest('[data-action=notifications]')))closeBell();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('.bell-panel')){closeBell();document.querySelector('[data-action=notifications]')?.focus();}});
window.addEventListener('resize',closeBell);
function bindPage(){
  bindBriefings();
  bindAnnouncements();syncAnnouncementBadges();syncBell();
  document.querySelector('#list-search')?.addEventListener('input',e=>{state.filter=e.target.value.toLowerCase();state.page=1;updateList();});
  document.querySelector('#unit-filter')?.addEventListener('change',e=>{state.unit=e.target.value;state.page=1;updateList();});
  document.querySelector('#dashboard-date')?.addEventListener('change',async e=>{state.date=e.target.value;await navigate();});
  document.querySelector('#revision-selector')?.addEventListener('change',async e=>{state.revisionId=e.target.value;await rerenderRoster();});
}
function updateList(){const list=document.querySelector('#data-list');if(!list)return;const renderer={employees:employeeRows,imports:importRows,documents:documentRows,sop:documentRows,incidents:incidentRows,logbook:logbookRows}[state.route];if(renderer)list.innerHTML=renderer();}
async function rerenderRoster(){document.querySelector('#main').innerHTML=await rosterPage();bindPage();}
function passwordForm(required=false){
  if(document.querySelector('[data-password]'))return;
  if(required)app.innerHTML='<div class="initial-loading">Ganti password awal untuk melanjutkan.</div>';
  const form=formDialog('Ganti password',`<label class="field full"><span>Password saat ini</span><input name="current_password" type="password" autocomplete="current-password" required></label><label class="field full"><span>Password baru (6–128 karakter)</span><input name="new_password" type="password" minlength="6" maxlength="128" autocomplete="new-password" required></label><label class="field full"><span>Ulangi password baru</span><input name="confirm" type="password" minlength="6" maxlength="128" autocomplete="new-password" required></label>`,async b=>{if(b.new_password!==b.confirm)throw new Error('Konfirmasi password tidak sama.');await post('auth/password',b);state.me=null;toast('Password diperbarui. Silakan masuk kembali.');await loginPage();},{note:'Setelah password berubah, semua sesi dicabut dan Anda perlu masuk kembali.'});
  form.dataset.password='true';if(required){form.querySelectorAll('[data-close]').forEach(b=>b.remove());form.addEventListener('cancel',e=>e.preventDefault());}
}
async function loginPage(){
  navigation.invalidate();state.me=null;state.permissions=[];state.items=[];state.trainingCalendarItems=[];state.trainingSelectedDay=null;closeDetails();closeBell();resetPurchasingState();resetAnnouncementSummary();state.bellShown=false;document.querySelectorAll('dialog').forEach(d=>d.close());document.title='Masuk — SPH-Portal';
  app.innerHTML=`<div class="login-page"><section class="login-brand-panel"><a class="brand" href="/"><img src="/app/assets/mark.svg" alt="Logo Badan Pengelola Besakih" width="42" height="42"><div><div class="brand-name">SPH-Portal</div><div class="brand-subtitle">SDM & Operasional</div></div></a><div class="login-story"><div class="eyebrow">Portal internal BP Besakih</div><h1>Bersama merawat kawasan suci.</h1><p>Satu ruang untuk mengelola tim, mengembangkan pelayanan, dan menjaga kawasan Besakih.</p></div><besakih-photo-slideshow></besakih-photo-slideshow></section><section class="login-form-panel"><div class="login-form-box"><div class="eyebrow">Selamat datang kembali</div><h2>Masuk ke portal</h2><p>Gunakan akun yang diberikan oleh administrator.</p><form id="login-form"><label class="field"><span>Username</span><input name="username" autocomplete="username" placeholder="Masukkan username" required maxlength="64"></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Masukkan password" required maxlength="128"></label><p class="form-error" role="alert"></p><button class="button primary" type="submit">Masuk ke portal ${icon('arrow')}</button></form><button class="button text" data-action="recover">Pulihkan password</button><p class="login-footer">Akses terbatas untuk pengguna yang diberi izin.<br>© ${new Date().getFullYear()} Badan Pengelola Besakih</p></div></section></div>`;
  document.querySelector('#login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('.form-error').textContent='';try{const values=Object.fromEntries(new FormData(form));form.querySelector('[name=password]').value='';await post('auth/login',values);state.me=await api('auth/me');state.permissions=state.me.permissions;await navigate();}catch(err){form.querySelector('.form-error').textContent=err.message;button.disabled=false;}});
}
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;
  try {
    if(action==='recover'){formDialog('Pulihkan password',`<label class="field full"><span>Kredensial sekali pakai dari administrator</span><input name="token" required autocomplete="off"></label><label class="field full"><span>Password baru</span><input type="password" name="new_password" required minlength="6" maxlength="128" autocomplete="new-password"></label>`,async b=>{await post('auth/reset',b);toast('Password berhasil dipulihkan. Silakan masuk.');},{note:'Hubungi administrator untuk verifikasi identitas dan meminta kredensial pemulihan. Kredensial berlaku 30 menit.'});return;}
    if(action==='theme'){const current=document.documentElement.dataset.theme;applyTheme(current==='dark'?'light':'dark');localStorage.setItem('besakih-theme',document.documentElement.dataset.theme);return;}
    if(action==='mobile-menu'||action==='mobile-close'){document.querySelector('.sidebar')?.classList.toggle('open',action==='mobile-menu');document.querySelector('.mobile-backdrop')?.classList.toggle('open',action==='mobile-menu');return;}
    if(action==='switch-hr'||action==='switch-security'||action==='switch-purchasing'){state.module=action.slice(7);const route={hr:hasHrDashboard()?'dashboard':'training',security:'security',purchasing:'purchasing'}[state.module];if(location.hash===`#${route}`)await navigate();else location.hash=route;return;}
    if(action==='training-view'){state.trainingView=el.dataset.view;document.querySelector('#main').innerHTML=trainingPage();return;}
    if(['training-prev','training-next','training-today'].includes(action)){
      const previous={year:state.trainingYear,month:state.trainingMonth,selectedDay:state.trainingSelectedDay};
      if(action==='training-today'){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar'}).format(new Date());state.trainingYear=Number(today.slice(0,4));state.trainingMonth=Number(today.slice(5,7))-1;state.trainingSelectedDay=today;}
      else {const delta=action==='training-next'?1:-1;if(state.trainingView==='year')state.trainingYear+=delta;else {const date=new Date(Date.UTC(state.trainingYear,state.trainingMonth+delta,1));state.trainingYear=date.getUTCFullYear();state.trainingMonth=date.getUTCMonth();}state.trainingSelectedDay=null;}
      el.disabled=true;
      try{
        if(state.trainingYear!==previous.year)state.trainingCalendarItems=(await api(`training/calendar?year=${state.trainingYear}`)).items;
        document.querySelector('#main').innerHTML=trainingPage();
      }catch(error){Object.assign(state,{trainingYear:previous.year,trainingMonth:previous.month,trainingSelectedDay:previous.selectedDay});throw error;}
      finally{el.disabled=false;}
      return;
    }
    if(action==='training-day'){
      const day=el.dataset.date;
      state.trainingYear=Number(day.slice(0,4));state.trainingMonth=Number(day.slice(5,7))-1;state.trainingSelectedDay=day;state.trainingView='month';
      document.querySelector('#main').innerHTML=trainingPage();
      document.querySelector('.training-agenda')?.scrollIntoView({block:'nearest',behavior:'smooth'});
      return;
    }
    if(action==='training-calendar-event'){
      const item=state.trainingCalendarItems.find(event=>event.id===el.dataset.id);
      if(item)showTrainingCalendarEvent(item,state.items.some(record=>record.id===item.id));
      return;
    }
    if(action==='training-open-private'){el.closest('dialog')?.close();await openDetail('training',el.dataset.id);return;}
    if(action.startsWith('go-')){const route={'go-employees':'employees','go-roster':'roster','go-config':'roster-settings'}[action];if(route)location.hash=route;return;}
    if(await handleBriefingAction(action,el))return;
    if(action==='export-patroli'||action==='export-coaching'){openReportExport(action==='export-patroli'?'patroli':'coaching');return;}
    if(await handleAnnouncementAction(action,el))return;
    if(await handlePurchasingAction(action,el))return;
    if(action==='coaching-share-link'){const previous=el.disabled;el.disabled=true;try{await openCoachingShareLink();}finally{el.disabled=previous;}return;}
    if(action==='report-photo'){showReportPhoto(el.dataset.id);return;}
    if(action==='detail'){await openDetail(el.dataset.type,el.dataset.id);return;}
    if(action==='profile'){dialog('Akun Anda',`<div class="account-profile"><div class="table-person">${avatar(state.me.name)}<div><strong>${esc(state.me.name)}</strong><p class="muted text-small">${esc(state.me.user.username)}</p></div></div><div class="actions">${button('Ganti password','change-password','key','outlined')}${button('Keluar','logout','logout','primary')}</div></div>`);return;}
    if(action==='change-password'){passwordForm();return;}
    if(action==='logout'){await post('auth/logout',{});state.me=null;await loginPage();return;}
    if(action==='help'){dialog('Panduan penggunaan',`<section class="detail-section"><h3>Mulai dari data dasar</h3><p class="detail-prose">Buka Data Pegawai & Organisasi untuk menambah pegawai atau meninjau hasil impor. Nomor pegawai, tanggal mulai, dan status harus mengikuti data resmi.</p></section><section class="detail-section"><h3>Dokumen dan pengembangan</h3><p class="detail-prose">Tambahkan dokumen, unggah versi, lalu aktifkan setelah tanggal berlaku. Kelola peserta dan kehadiran melalui detail kegiatan atau pelatihan. Coaching hanya dapat dibaca pihak yang berhak.</p></section><section class="detail-section"><h3>Penjadwalan keamanan</h3><p class="detail-prose">Lengkapi kelompok, pos, shift, anggota, kelayakan, aturan kerja, pola, binding, dan kebutuhan rutin. Buat periode, buat draf revisi, susun otomatis, periksa hasil, lalu terbitkan. Aturan kerja harus disepakati pengelola terlebih dahulu.</p></section><section><h3>Pemulihan akun</h3><p class="detail-prose">Hubungi administrator untuk kredensial pemulihan sekali pakai. Panduan instalasi, deploy Docker, backup, dan pemulihan tersedia dalam berkas README.md dan docs/DEPLOYMENT.md pada paket aplikasi.</p></section>`);return;}
    if(action==='notifications'){if(document.querySelector('.bell-panel'))closeBell();else openBell();return;}
    if(action==='prev-page'||action==='next-page'){state.page+=action==='next-page'?1:-1;updateList();return;}
    if(action==='category'){state.category=el.dataset.value;state.page=1;document.querySelectorAll('[data-action=category]').forEach(c=>c.classList.toggle('active',c===el));updateList();return;}
    if(action==='select-period'){state.periodId=el.dataset.id;state.revisionId=null;await rerenderRoster();return;}
    if(action==='config-tab'){state.configKey=el.dataset.key;state.items=(await api(`config/${state.configKey}`)).items;document.querySelector('#main').innerHTML=configPage();return;}
    if(action==='export-employees'||action==='export-roster'){const data=await api(action==='export-employees'?'exports/employees':`exports/revisions/${state.revision.id}`);const blob=new Blob(['\uFEFF',data.csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=data.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    const original=el.disabled;el.disabled=true;try{await handleFormAction(action,el);}finally{el.disabled=original;}
  }catch(err){toast(err.message,true);}
});
document.addEventListener('data-changed',()=>{invalidateAnnouncementSummary();invalidatePurchasingOverview();});
document.addEventListener('refresh-app',()=>{invalidateAnnouncementSummary();invalidatePurchasingOverview();navigate();});document.addEventListener('session-ended',()=>loginPage());window.addEventListener('hashchange',()=>{closeDetails();closeBell();navigate();});
const preferred=localStorage.getItem('besakih-theme');applyTheme(preferred==='dark'?'dark':'light');
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();(document.querySelector('#main')||document.querySelector('#login-form input'))?.focus();});
registerServiceWorker();
try{state.me=await api('auth/me');state.permissions=state.me.permissions;await navigate();}catch{await loginPage();}
