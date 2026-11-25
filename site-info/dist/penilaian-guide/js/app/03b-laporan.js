/* =========================================================
   Review negatif & komplain wisatawan (menu baru 2.4.0)
   Berkas 4b — lapisan UI Penilaian Guide Besakih

   TUGAS    : Formulir menu Review Negatif dan Komplain: pos & petugas, guide, jenis
              keluhan, tanggal kejadian, apa kata wisatawan (dan kronologi + data
              wisatawan untuk komplain); simpan ke antrean yang sama dengan penilaian.
   LARANGAN : Tidak menulis IndexedDB langsung — selalu lewat DB.*. Guide tidak pernah
              ditebak dari ketikan: harus dipilih dari daftar (nama guide bisa kembar).

   Keputusan pemilik 23 November 2026: dicatat petugas pos (nama petugas wajib), baru
   berdampak setelah disetujui Pengelola Kunjungan di portal. Review negatif memotong nilai
   akhir guide bulan itu; komplain menghapus nilai guide bulan itu.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { $, $$, uuid, esc } = App;

  /**
   * Batas dan daftar bawaan = isi awal migrasi portal. Dipakai hanya bila HP belum pernah
   * menerima daftar dari portal; kodenya pasti dikenal portal karena jenis tidak pernah dihapus.
   * Catatan yang disimpan dengan daftar ini tetap MENUNGGU di HP sampai server menerima
   * review negatif & komplain (lihat Sync.serverTerimaLaporan).
   */
  const LAPORAN_BAWAAN = {
    keteranganMin: 3, keteranganMaks: 500, kronologiMin: 3, kronologiMaks: 1000, wisatawanMaks: 120, mundurHari: 7,
    review: [
      { kode: 'kurang-ramah', label: 'Kurang ramah atau tidak sopan' },
      { kode: 'penjelasan-kurang', label: 'Penjelasan kurang atau tidak jelas' },
      { kode: 'terburu-buru', label: 'Terburu-buru' },
      { kode: 'terlambat', label: 'Terlambat atau membuat tamu menunggu' },
      { kode: 'review-lain', label: 'Keluhan pelayanan lain (tulis di keterangan)' },
    ],
    komplain: [
      { kode: 'komplain-pungutan', label: 'Meminta uang di luar tarif resmi' },
      { kode: 'komplain-memaksa', label: 'Memaksa belanja atau donasi' },
      { kode: 'komplain-kasar', label: 'Berkata kasar atau mengancam' },
      { kode: 'komplain-menelantarkan', label: 'Menelantarkan tamu' },
      { kode: 'komplain-lain', label: 'Komplain lain (tulis di keterangan)' },
    ],
  };
  const NAMA = { review: 'Review negatif', komplain: 'Komplain' };
  const SARAN_MIN_HURUF = 2;
  const SARAN_MAKS = 8;
  const PETUNJUK_GUIDE = 'Ketik minimal 2 huruf nama guide, lalu pilih dari daftar.';
  const rapikan = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Bahan menu dari portal, atau null bila server belum menerima review negatif & komplain. */
  App.konteksLaporan = function konteksLaporan() {
    const k = DB.getPenilaian();
    const l = k && k.laporan;
    return l && Array.isArray(l.review) && Array.isArray(l.komplain) ? { ...LAPORAN_BAWAAN, ...l } : null;
  };

  /** Daftar dan batas yang dipakai formulir: dari portal, atau bawaan selama server belum siap. */
  const bahan = () => App.konteksLaporan() || LAPORAN_BAWAAN;

  /** Label jenis keluhan dari kodenya (juga untuk kode yang kini tidak aktif). */
  App.labelLaporan = function labelLaporan(jenis, kode) {
    const cari = list => (list || []).find(t => t.kode === kode);
    const t = cari(bahan()[jenis]) || cari(LAPORAN_BAWAAN[jenis]);
    return t ? t.label : kode;
  };

  // `ketikan` = isi kotak nama guide yang belum dipilih dari daftar (ikut draf supaya tidak hilang).
  const kosong = jenis => ({ jenis, guide: null, ketikan: '', kode: '', tanggal: DB.tanggalLokal(), keterangan: '', kronologi: '', wisatawan: { nama: '', asal: '', kontak: '' } });

  /** True bila formulir menu ini berisi ketikan yang bisa hilang saat dimuat ulang. */
  App.laporanBerisi = function laporanBerisi() {
    const l = App.state.laporan;
    if (!l) return false;
    const w = l.wisatawan || {};
    const ketikan = String(l.ketikan || ($('#lapGuideInput') ? $('#lapGuideInput').value : '') || '').trim();
    return !!(l.guide || ketikan || String(l.keterangan || '').trim() || String(l.kronologi || '').trim() || w.nama || w.asal || w.kontak);
  };

  // Draf ikut dienkripsi (DB.simpanDraftLaporan), sama seperti draf penilaian.
  const simpanDraf = () => DB.simpanDraftLaporan(App.laporanBerisi() ? App.state.laporan : null);
  App.simpanDraftLaporan = simpanDraf;

  App.muatDraftLaporan = async function muatDraftLaporan() {
    const d = await DB.bacaDraftLaporan();
    if (!d || !['review', 'komplain'].includes(d.jenis)) return;
    App.state.laporan = { ...kosong(d.jenis), ...d, wisatawan: { nama: '', asal: '', kontak: '', ...(d.wisatawan || {}) } };
    // Guide di draf dicocokkan ulang ke daftar terbaru lewat guideId.
    const g = App.state.laporan.guide;
    if (g) App.state.laporan.guide = App.findGuideById(g.guideId) || g;
  };

  /** Buka menu Review Negatif atau Komplain. Pindah menu mempertahankan isian; jenis keluhan dipilih ulang. */
  App.bukaLaporan = function bukaLaporan(jenis) {
    const lama = App.state.laporan;
    if (!lama) App.state.laporan = kosong(jenis);
    else if (lama.jenis !== jenis) App.state.laporan = { ...lama, jenis, kode: '' };
    App.gambarLaporan();
  };

  /** Rentang tanggal kejadian yang diterima portal: hari ini sampai mundurHari sebelumnya. */
  const rentangTanggal = () => {
    const maks = DB.tanggalLokal();
    const d = new Date(maks + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - bahan().mundurHari);
    return { min: d.toISOString().slice(0, 10), maks };
  };

  App.gambarLaporan = function gambarLaporan() {
    const l = App.state.laporan;
    if (!l) return;
    const komplain = l.jenis === 'komplain', siap = !!App.konteksLaporan(), b = bahan();
    $('#lapJudul').textContent = komplain ? '📢 Komplain wisatawan' : '👎 Review negatif wisatawan';
    $$('[data-patokan-jenis]').forEach(li => li.classList.toggle('aktif', li.dataset.patokanJenis === l.jenis));
    const ganti = $('#lapGantiJenis');
    ganti.dataset.nav = komplain ? 'review' : 'komplain';
    ganti.textContent = komplain ? 'Hanya soal pelayanan? Pindah ke Review Negatif' : 'Dugaan pelanggaran? Pindah ke Komplain';
    const server = $('#lapServer');
    server.hidden = siap;
    if (!siap) {
      server.innerHTML = `<strong>⏳ Portal belum menerima ${komplain ? 'komplain' : 'review negatif'}</strong>` +
        `<p>Catatan tetap bisa disimpan dan aman di HP, lalu terkirim sendiri setelah portal diperbarui. Beri tahu Pengelola Kunjungan.</p>`;
    }
    $('#lapPosLabel').textContent = App.state.form.pos ? App.labelPos(App.state.form.pos) : 'Belum ada tautan pos';
    App.tampilkanPetugas();
    $('#lapGuideInput').value = l.guide ? l.guide.guideName : (l.ketikan || '');
    App.tampilkanGuideLaporan();
    const daftar = b[l.jenis] || [];
    // Draf boleh memuat jenis yang kemudian dinonaktifkan pengelola: tetap terlihat sampai diganti.
    const pilihan = [...daftar, ...(l.kode && !daftar.some(t => t.kode === l.kode) ? [{ kode: l.kode, label: `${App.labelLaporan(l.jenis, l.kode)} (tidak aktif)` }] : [])];
    $('#lapKode').innerHTML = `<option value="">Pilih jenis ${komplain ? 'komplain' : 'keluhan'}…</option>` +
      pilihan.map(t => `<option value="${esc(t.kode)}">${esc(t.label)}</option>`).join('');
    $('#lapKode').value = l.kode || '';
    const r = rentangTanggal(), tgl = $('#lapTanggal');
    tgl.min = r.min; tgl.max = r.maks;
    if (!l.tanggal || l.tanggal < r.min || l.tanggal > r.maks) l.tanggal = r.maks;
    tgl.value = l.tanggal;
    $('#lapTanggalHelp').textContent = `Bawaan hari ini. Paling lama ${b.mundurHari} hari sebelumnya.`;
    $('#lapKeterangan').value = l.keterangan || '';
    $('#lapKeterangan').maxLength = b.keteranganMaks;
    $('#lapKronologi').value = l.kronologi || '';
    $('#lapKronologi').maxLength = b.kronologiMaks;
    for (const [sel, key] of [['#lapWisNama', 'nama'], ['#lapWisAsal', 'asal'], ['#lapWisKontak', 'kontak']]) {
      $(sel).value = (l.wisatawan || {})[key] || '';
      $(sel).maxLength = b.wisatawanMaks;
    }
    $$('[data-hanya-komplain]').forEach(el => { el.hidden = !komplain; });
    $('#lapSimpanLabel').textContent = komplain ? 'SIMPAN KOMPLAIN' : 'SIMPAN REVIEW NEGATIF';
  };

  /* ---------------- Pilih guide (tanpa menebak) ---------------- */

  App.tampilkanGuideLaporan = function tampilkanGuideLaporan() {
    const el = $('#lapGuidePicked'), g = App.state.laporan && App.state.laporan.guide;
    if (!el) return;
    if (!g) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = `✓ ${g.guideName} · ${g.guideId} · ${App.labelRegu(g.regu)}`;
    el.classList.remove('hidden');
  };

  const tulisPetunjuk = teks => { const el = $('#lapGuideHelp'); if (el) el.textContent = teks || PETUNJUK_GUIDE; };

  App.saranLaporanTerbuka = () => { const box = $('#lapGuideSaran'); return !!box && !box.hidden; };

  App.tutupSaranLaporan = function tutupSaranLaporan() {
    const box = $('#lapGuideSaran'), input = $('#lapGuideInput');
    App.state.lapSaranAktif = -1;
    if (input) { input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    if (box && !box.hidden) { box.hidden = true; box.innerHTML = ''; }
  };

  /** Daftar saran dari SEMUA guide aktif: keluhan bisa tentang guide regu mana pun. */
  App.tampilkanSaranLaporan = function tampilkanSaranLaporan() {
    const box = $('#lapGuideSaran'), input = $('#lapGuideInput'), l = App.state.laporan;
    if (!box || !input || !l) return;
    const teks = String(input.value || '').trim();
    if (l.guide && rapikan(l.guide.guideName) === rapikan(teks)) { App.tutupSaranLaporan(); tulisPetunjuk(''); return; }
    if (rapikan(teks).length < SARAN_MIN_HURUF || !App.state.guides.length) { App.tutupSaranLaporan(); tulisPetunjuk(''); return; }
    const cocok = App.cariSaran(teks, App.state.guides), tampil = cocok.slice(0, SARAN_MAKS);
    if (!tampil.length) { App.tutupSaranLaporan(); tulisPetunjuk('Guide tidak ditemukan. Coba bagian nama lainnya.'); return; }
    tulisPetunjuk(cocok.length > tampil.length
      ? `Menampilkan ${tampil.length} dari ${cocok.length} hasil. Perjelas pencarian untuk mempersempit hasil.`
      : `${cocok.length} guide ditemukan. Pilih guide yang sesuai.`);
    App.state.lapSaranAktif = -1;
    input.removeAttribute('aria-activedescendant');
    box.innerHTML = tampil.map((g, i) =>
      `<button type="button" class="saran-item" id="lap-saran-${i}" role="option" tabindex="-1" aria-selected="false" data-lap-saran="${esc(g.guideId)}">` +
      `<span class="saran-nama">${esc(g.guideName)}</span>` +
      `<span class="saran-meta">${esc(g.guideId)} · ${esc(App.labelRegu(g.regu) || 'tanpa regu')}</span></button>`).join('');
    box.scrollTop = 0;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  /** Ketikan berubah: pilihan guide sebelumnya batal bila namanya tidak lagi sama. */
  App.ketikGuideLaporan = function ketikGuideLaporan() {
    const l = App.state.laporan, teks = String($('#lapGuideInput').value || '');
    if (!l) return;
    l.ketikan = teks;
    if (l.guide && rapikan(l.guide.guideName) !== rapikan(teks)) { l.guide = null; App.tampilkanGuideLaporan(); }
    App.tampilkanSaranLaporan();
    simpanDraf();
  };

  App.pilihGuideLaporan = function pilihGuideLaporan(id) {
    const g = App.findGuideById(id);
    if (!g || !App.state.laporan) return;
    App.state.laporan.guide = g;
    App.state.laporan.ketikan = g.guideName;
    $('#lapGuideInput').value = g.guideName;
    App.tutupSaranLaporan();
    tulisPetunjuk('');
    App.tampilkanGuideLaporan();
    simpanDraf();
  };

  /** Panah atas/bawah memindahkan sorotan; Enter memilih yang disorot atau satu-satunya baris. */
  App.geserSaranLaporan = function geserSaranLaporan(arah) {
    const items = $$('#lapGuideSaran [data-lap-saran]');
    if (!items.length) return;
    let i = App.state.lapSaranAktif + arah;
    if (i < 0) i = items.length - 1;
    if (i >= items.length) i = 0;
    App.state.lapSaranAktif = i;
    items.forEach((el, j) => { el.classList.toggle('aktif', j === i); el.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
    $('#lapGuideInput').setAttribute('aria-activedescendant', items[i].id);
    items[i].scrollIntoView({ block: 'nearest' });
  };
  App.saranLaporanUntukEnter = function saranLaporanUntukEnter() {
    const items = $$('#lapGuideSaran [data-lap-saran]');
    const aktif = items[App.state.lapSaranAktif];
    if (aktif) return aktif.dataset.lapSaran;
    return items.length === 1 ? items[0].dataset.lapSaran : null;
  };

  /** Isian teks diperbarui ke state (dan draf) setiap kali diketik. */
  App.ubahIsianLaporan = function ubahIsianLaporan(el) {
    const l = App.state.laporan;
    if (!l) return;
    if (el.id === 'lapKode') l.kode = el.value;
    else if (el.id === 'lapTanggal') l.tanggal = el.value;
    else if (el.id === 'lapKeterangan') l.keterangan = el.value;
    else if (el.id === 'lapKronologi') l.kronologi = el.value;
    else if (el.id === 'lapWisNama') l.wisatawan.nama = el.value;
    else if (el.id === 'lapWisAsal') l.wisatawan.asal = el.value;
    else if (el.id === 'lapWisKontak') l.wisatawan.kontak = el.value;
    else return;
    simpanDraf();
  };

  /* ---------------- Simpan ---------------- */

  App.simpanLaporan = async function simpanLaporan(e) {
    e.preventDefault();
    const l = App.state.laporan;
    if (!l) return;
    const b = bahan(), komplain = l.jenis === 'komplain', nama = NAMA[l.jenis];
    const gagal = (pesan, ikon, fokus) => { App.toast(pesan, 'warn', ikon); if (fokus && $(fokus)) $(fokus).focus(); };
    if (!(App.konteksPenilaian().petugas || []).length) return gagal('Daftar petugas belum diisi Pengelola Kunjungan', '👤');
    const petugas = App.petugasAktif();
    if (!petugas) { App.tampilkanPetugas(); return gagal('Pilih nama petugas dulu (sekali per shift)', '👤', '#lapPetugasSelect'); }
    if (!l.guide) {
      App.tampilkanSaranLaporan();
      return gagal(String($('#lapGuideInput').value || '').trim() ? 'Pilih guide dari daftar — nama bisa kembar' : 'Pilih nama guide dulu', '⚠️', '#lapGuideInput');
    }
    if (!l.kode) return gagal(`Pilih jenis ${komplain ? 'komplain' : 'keluhan'}`, '⚠️', '#lapKode');
    const r = rentangTanggal();
    if (!l.tanggal || l.tanggal < r.min || l.tanggal > r.maks) return gagal(`Tanggal kejadian harus antara ${r.min} dan ${r.maks}`, '📅', '#lapTanggal');
    const keterangan = String(l.keterangan || '').trim(), kronologi = String(l.kronologi || '').trim();
    if (keterangan.length < b.keteranganMin) return gagal('Tulis apa kata wisatawan', '📝', '#lapKeterangan');
    if (komplain && kronologi.length < b.kronologiMin) return gagal('Tulis kronologi komplain', '📝', '#lapKronologi');
    const pos = Number(App.state.form.pos);
    if (!App.state.tautan.some(t => t.pos === pos)) { App.toast('Simpan tautan pos dulu', 'warn', '🔗'); App.go('tautan'); return; }

    const w = l.wisatawan || {}, rapi = v => String(v || '').trim().replace(/\s+/g, ' ').slice(0, b.wisatawanMaks);
    const entri = {
      evaluationId: uuid(),
      guideId: l.guide.guideId,
      guideName: l.guide.guideName,
      pos,
      timestamp: DB.sekarangISO(),
      // Dikirim sebagai id; nama diambil portal dari daftar petugas.
      petugasId: petugas.id,
      petugasNama: petugas.nama,
      // Pengaman rollback: bila Pages dikembalikan ke PWA 2.3 sementara catatan ini masih di
      // antrean, versi lama mengirimnya sebagai penilaian formulir 2.2 dengan seragam "laporan"
      // yang pasti ditolak portal — tidak pernah tercatat sebagai pengantaran bernilai.
      // PWA 2.4 tidak membaca `criteria` catatan (dikirim lewat payloadLaporan).
      criteria: { seragam: 'laporan' },
      laporan: {
        jenis: l.jenis,
        tanggal: l.tanggal,
        kode: l.kode,
        keterangan: keterangan.slice(0, b.keteranganMaks),
        kronologi: komplain ? kronologi.slice(0, b.kronologiMaks) : '',
        wisatawan: komplain ? { nama: rapi(w.nama), asal: rapi(w.asal), kontak: rapi(w.kontak) } : { nama: '', asal: '', kontak: '' },
      },
      synced: false,
    };
    try { await DB.save(entri); }
    catch (err) { App.toast('Gagal menyimpan: ' + err.message, 'err', '❌'); return; }

    App.haptic([30, 40, 30]);
    App.toast(`${nama} tersimpan`, 'ok', '💾');
    App.state.laporan = kosong(l.jenis);
    DB.hapusDraftLaporan();
    $('#lapGuideInput').value = '';
    App.gambarLaporan();
    App.refreshStats();
    // Versi baru menunggu sampai formulir kosong (ATR-FL-14).
    if (App.state.versiBaruSiap && App.formulirKosong()) { location.reload(); return; }
    App.go('home');
    if (Sync.isOnline()) Sync.syncNow();
  };
})();
