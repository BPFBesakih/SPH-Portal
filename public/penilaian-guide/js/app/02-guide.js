/* =========================================================
   Daftar guide — muat, saring, cocokkan nama
   Berkas 3 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Muat daftar guide dari tautan pos, penyaringan kategori/regu, pencocokan nama yang
              ambigu.
   LARANGAN : Nama ambigu tidak boleh ditebak diam-diam — "Darta" cocok untuk 14
              orang.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { $, esc } = App;

  /**
   * Daftar guide hanya datang dari tautan pos (ATR-FL-05, KM-07):
   *   1. Cache di perangkat (hasil `context` terakhir), supaya tetap tersedia offline
   *   2. Portal — diperbarui paling sering sekali per 10 menit saat online
   * Tidak ada salinan bawaan di aset publik: tanpa tautan pos, daftar ini kosong.
   */
  App.loadGuides = async function loadGuides(opts = {}) {
    const cached = DB.getGuides();
    if (cached && cached.list.length) {
      App.state.guides = cached.list;
      App.fillGuideInputs();
    }
    if (!App.state.tautan.length) return;
    try {
      const dariServer = await Sync.refreshGuides(opts);
      if (Array.isArray(dariServer) && dariServer.length) {
        App.state.guides = dariServer;
        App.fillGuideInputs();
      }
    } catch (e) {
      if (!App.state.guides.length) {
        const el = $('#guideAmbigu');
        if (el) {
          el.textContent = '⚠️ Daftar guide belum dapat dimuat. Pastikan ada sinyal, lalu buka ulang tautan pos.';
          el.hidden = false;
        }
      }
    }
  }

  /** Ubah kode regu ("A1") menjadi label manusia ("Asing · Regu 1"). */
  App.labelRegu = function labelRegu(kode) {
    return String(kode || '').split(',').map(s => s.trim()).filter(Boolean).map(k => {
      const kat = k[0] === 'A' ? 'Asing' : 'Domestik';
      return `${kat} · Regu ${k.slice(1)}`;
    }).join(' + ');
  }

  /** Apakah guide termasuk dalam kategori/regu yang sedang dipilih. */
  App.cocokFilter = function cocokFilter(g, kategori, regu) {
    if (!kategori && !regu) return true;
    const kode = String(g.regu || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!kode.length) return false;
    return kode.some(k => {
      const kat = k[0] === 'A' ? 'Asing' : 'Domestik';
      return (!kategori || kat === kategori) && (!regu || k.slice(1) === regu);
    });
  }

  /** Daftar guide sesuai filter yang aktif di layar Penilaian. */
  App.guidesTersaring = function guidesTersaring() {
    const kat = $('#filterKategori') ? $('#filterKategori').value : '';
    const rg = $('#filterRegu') ? $('#filterRegu').value : '';
    return App.state.guides.filter(g => App.cocokFilter(g, kat, rg));
  }

  App.fillGuideInputs = function fillGuideInputs() {
    const list = App.guidesTersaring();
    const dl = $('#guideList');
    dl.innerHTML = list.map(g =>
      `<option value="${esc(g.guideName)}">${esc(App.labelRegu(g.regu))}</option>`
    ).join('');
    const total = App.state.guides.length;
    $('#guideCount').textContent = list.length === total
      ? `${total} guide aktif tersedia.`
      : `Menampilkan ${list.length} dari ${total} guide.`;
    if (App.state.current === 'guides') App.renderGuideCards();
  }

  /**
   * Cari guide dari teks yang diketik staff.
   * Yang sedang tersaring diprioritaskan, supaya pilihan filter menentukan
   * guide mana yang dimaksud bila ada nama mirip.
   */
  /**
   * Cari guide dari guideId — satu-satunya penanda yang benar-benar unik.
   * Dipakai setiap kali guide dipilih secara eksplisit (kartu, chip kandidat,
   * koreksi), karena beberapa guide bernama persis sama.
   */
  App.findGuideById = function findGuideById(id) {
    const q = String(id || '').trim();
    if (!q) return null;
    return App.state.guides.find(g => String(g.guideId) === q) || null;
  }

  App.findGuide = function findGuide(name) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    const cari = (arr) => arr.find(g => g.guideName.toLowerCase() === q)
                       || arr.find(g => g.guideName.toLowerCase().includes(q))
                       || null;
    return cari(App.guidesTersaring()) || cari(App.state.guides);
  }

  /**
   * Penentuan guide saat penilaian DISIMPAN — sengaja lebih ketat daripada
   * findGuide yang dipakai untuk pratinjau saat mengetik.
   *
   * Banyak nama guide di sini hanya beda satu kata: mengetik "Darta" cocok
   * untuk 14 orang. Menebak yang pertama berarti penilaian tercatat atas nama
   * orang yang salah tanpa ada yang tahu — jadi ketikan yang masih ambigu
   * ditolak, bukan ditebak.
   */
  App.guideUntukSimpan = function guideUntukSimpan(name) {
    const teks = String(name || '').trim();
    const q = teks.toLowerCase();
    if (!q) return { error: 'Pilih nama guide dulu' };

    for (const arr of [App.guidesTersaring(), App.state.guides]) {
      const persis = arr.filter(g => g.guideName.toLowerCase() === q);
      if (persis.length === 1) return { guide: persis[0] };
      if (persis.length > 1) {
        // Dulu di sini hanya ada pesan galat tanpa kandidat, padahal kartu di
        // Daftar Guide juga cuma mengirim nama — staff jadi buntu. Sekarang
        // kandidatnya dikembalikan supaya bisa dipilih lewat guideId.
        return { error: `Ada ${persis.length} guide bernama "${teks}" — pilih salah satu`, kandidat: persis };
      }
      const mirip = arr.filter(g => g.guideName.toLowerCase().includes(q));
      if (mirip.length === 1) return { guide: mirip[0] };
      if (mirip.length > 1) {
        return { error: `"${teks}" cocok untuk ${mirip.length} guide — ketik nama lengkapnya`, kandidat: mirip };
      }
    }
    return { error: `Guide "${teks}" tidak ada dalam daftar` };
  }

  App.renderGuideCards = function renderGuideCards() {
    const q = ($('#guideSearch').value || '').toLowerCase();
    const list = App.state.guides
      .filter(g => !App.state.guideKategoriFilter || App.cocokFilter(g, App.state.guideKategoriFilter, ''))
      .filter(g => !q || g.guideName.toLowerCase().includes(q) || String(g.guideId).toLowerCase().includes(q));
    const box = $('#guideCards');
    const info = $('#guideTotal');
    if (info) info.textContent = `${list.length} dari ${App.state.guides.length} guide`;
    if (!list.length) {
      box.innerHTML = `<div class="empty"><span class="big">👥</span>Tidak ada guide yang cocok.</div>`;
      return;
    }
    // Batasi jumlah kartu yang digambar agar layar tetap ringan di perangkat lama.
    // Batas lama (120) menyembunyikan lebih dari separuh dari 296 guide bahkan
    // saat tanpa filter, jadi dinaikkan sampai seluruh daftar muat.
    const tampil = list.slice(0, 300);
    box.innerHTML = tampil.map(g => `
      <button class="card" data-guide="${esc(g.guideName)}" data-guide-id="${esc(g.guideId)}">
        <span class="cstat">👤</span>
        <span class="cbody">
          <span class="cname">${esc(g.guideName)}</span>
          <span class="cmeta">${esc(g.guideId)} · ${esc(App.labelRegu(g.regu))}</span>
        </span>
      </button>`).join('')
      + (list.length > tampil.length
        ? `<div class="help">Menampilkan ${tampil.length} teratas. Ketik di kotak cari untuk mempersempit.</div>`
        : '');
  }
})();
