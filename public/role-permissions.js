// Display every permission returned by the backend, including modules that
// did not exist when this UI was first published. Hidden grants must never be
// lost simply because the role editor does not recognize a resource.
const resourceNames={
  'hr.briefings':'Briefing Pagi (Wewarah Semeng)','hr.employees':'Data pegawai',
  'hr.organization':'Organisasi','hr.employee_files':'Berkas pegawai',
  'hr.documents':'Regulasi & SOP','hr.training':'Kegiatan & Pelatihan',
  'hr.coaching':'Coaching','security.config':'Konfigurasi keamanan',
  'security.roster':'Jadwal & penugasan','security.logbook':'Logbook',
  'security.incidents':'Kejadian','admin.users':'Akun pengguna',
  'admin.roles':'Role & izin','admin.audit':'Audit',
  'purchasing.requests':'Pengadaan: PR',
  'purchasing.procurement':'Pengadaan: proses Purchasing',
  'purchasing.vendors':'Pengadaan: vendor',
  'purchasing.budget':'Pengadaan: Pos RKA',
  'purchasing.reports':'Pengadaan: laporan',
  'purchasing.settings':'Pengadaan: pengaturan',
  'merchandise.catalog':'Bisnis: katalog dan harga merchandise',
  'merchandise.stock':'Bisnis: stok barang',
  'merchandise.sales':'Bisnis: penjualan',
  'merchandise.reports':'Bisnis: laporan penjualan'
};
const actionNames={
  read:'Lihat',create:'Tambah',update:'Ubah',manage:'Kelola',
  publish:'Terbitkan',download:'Unduh',export:'Ekspor',
  participants:'Kelola peserta',generate:'Susun otomatis',edit:'Ubah draf',
  acknowledge:'Akui kekurangan',reopen:'Buka kembali',reset:'Reset password',
  verify:'Verifikasi',sensitive:'Lihat data sensitif',
  costs:'Lihat harga modal',record:'Catat stok',adjust:'Koreksi stok',
  void:'Batalkan transaksi'
};
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[char]);

export function renderRolePermissionGroups(permissions,selectedCodes=[],editable=true,preferredModule=''){
  const selected=new Set(selectedCodes);
  const byResource=new Map();
  for(const permission of permissions){
    if(!byResource.has(permission.resource))byResource.set(permission.resource,[]);
    byResource.get(permission.resource).push(permission);
  }
  const order=new Map(Object.keys(resourceNames).map((resource,index)=>[resource,index]));
  const resources=[...byResource.keys()].sort((a,b)=>{
    const priority=resource=>Number(Boolean(preferredModule)&&resource.startsWith(preferredModule+'.'));
    return priority(b)-priority(a)||(order.get(a)??10000)-(order.get(b)??10000)||a.localeCompare(b);
  });
  return resources.map(resource=>{
    const name=resourceNames[resource]||resource;
    return `<div class="permission-group" data-module="${escapeHtml(resource.split('.')[0])}"><h3>${escapeHtml(name)}</h3><div class="permission-grid">${byResource.get(resource).map(permission=>`<label class="check-field"><input type="checkbox" name="permissions[]" value="${escapeHtml(permission.code)}" ${selected.has(permission.code)?'checked':''} ${editable?'':'disabled'}><span>${escapeHtml(actionNames[permission.action]||permission.action)}</span></label>`).join('')}</div></div>`;
  }).join('');
}
