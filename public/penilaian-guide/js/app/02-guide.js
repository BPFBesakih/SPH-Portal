/* =========================================================
   Daftar guide — muat, saring, cocokkan nama
   Berkas 3 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Muat daftar guide dari tautan pos, penyaringan kategori/regu, daftar saran
              nama, pencocokan nama yang ambigu.
   LARANGAN : Nama ambigu tidak boleh ditebak diam-diam — "Darta" cocok untuk 14
              orang.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { $, $$, esc } = App;

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
    const total = App.state.guides.length;
    $('#guideCount').textContent = list.length === total
      ? `${total} guide aktif tersedia.`
      : `Menampilkan ${list.length} dari ${total} guide.`;
    if (App.saranTerbuka()) App.tampilkanSaran();
    if (App.state.current === 'guides') App.renderGuideCards();
  }

  /* ---------------------------------------------------------
     Daftar saran nama guide — pengganti <datalist>.

     <datalist> tidak bisa diandalkan untuk daftar ini: Firefox menampilkan
     label <option> (dulu "Asing · Regu 1") MENGGANTIKAN namanya, sementara
     Chrome menampilkan keduanya. Akibatnya di Firefox semua baris terbaca
     sama. Selain itu nama yang kembar tidak bisa dibedakan, karena yang
     dikirim datalist hanya teks nama.

     Perilakunya mengikuti pemilih nama di formulir coaching dan patroli
     (public/employee-picker.js): daftar baru muncul setelah 2 huruf, paling
     banyak 8 baris, menyatu di bawah kotak nama (tidak melayang), dan baris
     keterangan di bawahnya selalu memberi tahu keadaan pencarian. Bedanya,
     setiap baris membawa ID · regu dan memilih guide lewat guideId (unik),
     karena nama guide bisa kembar.
     --------------------------------------------------------- */

  // Sama dengan pemilih nama coaching/patroli.
  const SARAN_MIN_HURUF = 2;
  const SARAN_MAKS = 8;
  const PETUNJUK_AWAL = 'Ketik minimal 2 huruf nama guide, lalu pilih dari daftar.';

  // Huruf kecil, spasi dirapikan: "  i  WAYAN " sama dengan "i wayan".
  const rapikan = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Label filter yang sedang aktif, mis. "Asing · Regu 1". */
  const labelFilter = () => {
    const kat = $('#filterKategori') ? $('#filterKategori').value : '';
    const rg = $('#filterRegu') ? $('#filterRegu').value : '';
    return [kat, rg ? `Regu ${rg}` : ''].filter(Boolean).join(' · ');
  };

  /**
   * Baris keterangan di bawah kotak nama. Selama mencari, isinya keadaan
   * pencarian; selain itu petunjuk awal + jumlah guide sesuai filter.
   */
  const tulisPetunjuk = (teks) => {
    const el = $('#guidePetunjuk');
    const jumlah = $('#guideCount');
    if (el) el.textContent = teks || PETUNJUK_AWAL;
    if (jumlah) jumlah.hidden = !!teks;
  };

  /**
   * Guide yang cocok dengan ketikan. Setiap kata yang diketik harus ada di
   * nama (urutan bebas), atau ketikan cocok dengan ID guide. Urutan hasil:
   * ID persis, nama yang diawali ketikan, kata yang diawali ketikan, lalu
   * sisanya — masing-masing tetap urut nama seperti kiriman portal.
   */
  App.cariSaran = function cariSaran(teks, daftar) {
    const q = rapikan(teks);
    if (!q) return daftar.slice();
    const kata = q.split(' ');
    const hasil = [];
    daftar.forEach((g, i) => {
      const nama = rapikan(g.guideName);
      const id = rapikan(g.guideId);
      let peringkat;
      if (id === q) peringkat = 0;
      else if (nama.startsWith(q)) peringkat = 1;
      else if (kata.every(k => nama.includes(k))) peringkat = (' ' + nama).includes(' ' + kata[0]) ? 2 : 3;
      else if (id.includes(q)) peringkat = 4;
      else return;
      hasil.push({ g, peringkat, i });
    });
    // Indeks asal ikut dibandingkan: sort di WebView lama belum tentu stabil.
    return hasil.sort((a, b) => a.peringkat - b.peringkat || a.i - b.i).map(x => x.g);
  }

  App.saranTerbuka = function saranTerbuka() {
    const box = $('#guideSaran');
    return !!box && !box.hidden;
  }

  /**
   * Cari ulang sesuai ketikan dan filter, lalu tampilkan atau tutup daftar.
   * Tidak membuka apa pun selama ketikan masih nama guide yang sudah dipilih
   * — mengetuk lagi kotak yang sudah terisi tidak memunculkan daftar.
   */
  App.tampilkanSaran = function tampilkanSaran() {
    const box = $('#guideSaran');
    const input = $('#guideInput');
    if (!box || !input) return;
    const teks = String(input.value || '').trim();
    const dipilih = App.state.form.guide;
    if (input.disabled || !App.state.guides.length ||
        (dipilih && rapikan(dipilih.guideName) === rapikan(teks))) {
      App.tutupSaran(); tulisPetunjuk(''); return;
    }
    if (rapikan(teks).length < SARAN_MIN_HURUF) { App.tutupSaran(); tulisPetunjuk(''); return; }

    const filter = labelFilter();
    let cocok = App.cariSaran(teks, App.guidesTersaring());
    let lintasFilter = false;
    // Sama seperti saat menyimpan (guideUntukSimpan): bila tak ada yang cocok
    // di filter, cari di semua guide — regu tiap baris tetap terlihat.
    if (!cocok.length && filter) {
      cocok = App.cariSaran(teks, App.state.guides);
      lintasFilter = cocok.length > 0;
    }
    const tampil = cocok.slice(0, SARAN_MAKS);
    if (!tampil.length) {
      App.tutupSaran();
      tulisPetunjuk(`Guide tidak ditemukan${filter ? ` di ${filter} maupun regu lain` : ''}. Coba bagian nama lainnya.`);
      return;
    }
    tulisPetunjuk(
      (lintasFilter ? `Tidak ada di ${filter}. Dari kategori/regu lain: ` : '') +
      (cocok.length > tampil.length
        ? `Menampilkan ${tampil.length} dari ${cocok.length} hasil. Perjelas pencarian untuk mempersempit hasil.`
        : `${cocok.length} guide ditemukan. Pilih guide yang sesuai.`));

    const baruDibuka = box.hidden;
    App.state.saranAktif = -1;
    input.removeAttribute('aria-activedescendant');
    box.innerHTML = tampil.map((g, i) =>
      `<button type="button" class="saran-item" id="saran-${i}" role="option" tabindex="-1" ` +
      `aria-selected="false" data-saran="${esc(g.guideId)}">` +
      `<span class="saran-nama">${esc(g.guideName)}</span>` +
      `<span class="saran-meta">${esc(g.guideId)} · ${esc(App.labelRegu(g.regu) || 'tanpa regu')}</span>` +
      `</button>`).join('');
    box.scrollTop = 0;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (baruDibuka) App.pastikanSaranTerlihat();
  }

  App.tutupSaran = function tutupSaran() {
    const box = $('#guideSaran');
    const input = $('#guideInput');
    App.state.saranAktif = -1;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    if (!box || box.hidden) return;
    box.hidden = true;
    box.innerHTML = '';
  }

  /**
   * Kotak nama di formulir ini ada di tengah layar, jadi di HP daftar yang baru
   * muncul bisa tertutup keyboard. Halaman digeser seperlunya saja — sampai
   * daftar terlihat, tanpa mendorong kotak nama ke balik bilah judul.
   */
  App.pastikanSaranTerlihat = function pastikanSaranTerlihat() {
    const box = $('#guideSaran');
    const input = $('#guideInput');
    const bilah = $('.appbar');
    if (!box || box.hidden || !input) return;
    const vv = window.visualViewport;
    const atasLayar = (vv ? vv.offsetTop : 0) + (bilah ? bilah.getBoundingClientRect().height : 0) + 8;
    const bawahLayar = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const kurang = box.getBoundingClientRect().bottom + 8 - bawahLayar;
    const ruang = input.getBoundingClientRect().top - atasLayar;
    const geser = Math.min(kurang, ruang);
    if (geser > 4) window.scrollBy({ top: geser, behavior: 'smooth' });
  }

  /** Panah atas/bawah: pindahkan sorotan di daftar saran. */
  App.geserSaran = function geserSaran(arah) {
    const items = $$('#guideSaran [data-saran]');
    if (!items.length) return;
    let i = App.state.saranAktif + arah;
    if (i < 0) i = items.length - 1;
    if (i >= items.length) i = 0;
    App.state.saranAktif = i;
    items.forEach((el, j) => {
      el.classList.toggle('aktif', j === i);
      el.setAttribute('aria-selected', j === i ? 'true' : 'false');
    });
    $('#guideInput').setAttribute('aria-activedescendant', items[i].id);
    items[i].scrollIntoView({ block: 'nearest' });
  }

  /**
   * guideId yang dipilih tombol Enter: baris yang disorot, satu-satunya
   * baris, atau satu-satunya baris yang namanya persis sama dengan ketikan.
   * Null bila belum jelas — Enter tidak boleh menebak.
   */
  App.saranUntukEnter = function saranUntukEnter() {
    const items = $$('#guideSaran [data-saran]');
    const aktif = items[App.state.saranAktif];
    if (aktif) return aktif.dataset.saran;
    if (items.length === 1) return items[0].dataset.saran;
    const q = rapikan($('#guideInput').value);
    const persis = items.filter(el => rapikan(el.querySelector('.saran-nama').textContent) === q);
    return persis.length === 1 ? persis[0].dataset.saran : null;
  }

  /** Jumlah baris yang bisa dipilih di daftar saran yang sedang terbuka. */
  App.jumlahSaran = function jumlahSaran() {
    return App.saranTerbuka() ? $$('#guideSaran [data-saran]').length : 0;
  }

  /**
   * Guide dipilih dari daftar saran. Ditentukan lewat guideId — dua guide
   * boleh bernama persis sama, jadi nama saja tidak cukup.
   */
  App.pilihSaran = function pilihSaran(id) {
    const g = App.findGuideById(id);
    if (!g) return;
    App.state.form.guide = g;
    // Ganti guide berarti situasinya lain: persetujuan jeda untuk guide
    // sebelumnya tidak boleh ikut terbawa.
    App.state.form.lanjutJeda = null;
    $('#guideInput').value = g.guideName;
    App.tutupSaran();
    tulisPetunjuk('');
    App.showPicked(g);
    App.tampilkanKandidat(null);
    App.saveDraft();
    $('#draftNote').hidden = false;
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
