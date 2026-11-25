/* =========================================================
   Navigasi antar layar
   Berkas 2 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Pindah layar, judul header, buka/tutup laci menu.
   LARANGAN : Tidak boleh tahu isi layar mana pun.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { $, $$, TITLES } = App;

  App.go = function go(view) {
    if (!TITLES[view]) view = 'home';
    // Tanpa tautan pos tersimpan, formulir dan daftar guide tidak ditampilkan
    // (ATR-FL-03): yang ada hanya petunjuk meminta tautan dan kotak tempel.
    if (!App.state.tautan.length && !['tautan', 'tentang', 'pengaturan'].includes(view)) view = 'tautan';
    const laporan = view === 'review' || view === 'komplain';
    if ((view === 'nilai' || laporan) && !App.state.tautan.some(l => l.pos === Number(App.state.form.pos))) view = 'home';
    App.state.current = view;
    $$('.view').forEach(v => v.hidden = true);
    // Review Negatif dan Komplain berbagi satu layar formulir (#view-laporan).
    const el = $('#view-' + (view === 'review' || view === 'komplain' ? 'laporan' : view));
    if (el) el.hidden = false;
    $('#appTitle').textContent = TITLES[view];
    // Tanpa tautan, layar Tautan Pos adalah layar utama: tombol kembali tidak berguna.
    const akar = view === 'home' || (view === 'tautan' && !App.state.tautan.length);
    $('#btnBack').classList.toggle('hidden', akar);
    $('#btnMenu').classList.toggle('hidden', !akar);
    App.closeDrawer();
    // Dijaga: selama pembaruan, HP bisa sesaat memuat 02-guide.js lama dari cache.
    if (App.tutupSaran) App.tutupSaran();
    if (App.tutupSaranLaporan) App.tutupSaranLaporan();
    window.scrollTo(0, 0);
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);

    if (view === 'riwayat') App.renderHistory();
    // Pilihan nama petugas bisa habis masa berlakunya (pergantian shift).
    if (view === 'nilai' && App.tampilkanPetugas) App.tampilkanPetugas();
    if ((view === 'review' || view === 'komplain') && App.bukaLaporan) App.bukaLaporan(view);
    if (view === 'guides') App.renderGuideCards();
    if (view === 'home') App.refreshStats();
    if (view === 'pengaturan') { App.refreshStorage(); App.renderTautan(); App.tampilkanSelisihJam(); }
    if (view === 'home' && App.state.versiBaruSiap && App.formulirKosong()) location.reload();
  }

  App.openDrawer = function openDrawer() {
    $('#drawer').hidden = false; $('#scrim').hidden = false;
    $('#btnMenu').setAttribute('aria-expanded', 'true');
    App.refreshStats();
  }

  App.closeDrawer = function closeDrawer() {
    $('#drawer').hidden = true; $('#scrim').hidden = true;
    $('#btnMenu').setAttribute('aria-expanded', 'false');
  }
})();
