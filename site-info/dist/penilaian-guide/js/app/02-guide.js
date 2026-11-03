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

     Daftar ini menampilkan nama + ID · regu di setiap baris, dan baris yang
     dipilih menentukan guide lewat guideId (unik), bukan lewat nama.
     --------------------------------------------------------- */

  // Cukup untuk menggulir ke nama yang dicari tanpa membebani HP lama;
  // selebihnya dipersempit dengan mengetik.
  const SARAN_MAKS = 50;
  // Batas tinggi daftar: minimal ±3 baris, maksimal ±7 baris.
  const SARAN_TINGGI_MIN = 172;
  const SARAN_TINGGI_MAKS = 420;

  // Huruf kecil, spasi dirapikan: "  i  WAYAN " sama dengan "i wayan".
  const rapikan = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** Label filter yang sedang aktif, mis. "Asing · Regu 1". */
  const labelFilter = () => {
    const kat = $('#filterKategori') ? $('#filterKategori').value : '';
    const rg = $('#filterRegu') ? $('#filterRegu').value : '';
    return [kat, rg ? `Regu ${rg}` : ''].filter(Boolean).join(' · ');
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

  /** Gambar ulang daftar saran sesuai ketikan dan filter yang aktif. */
  App.tampilkanSaran = function tampilkanSaran() {
    const box = $('#guideSaran');
    const input = $('#guideInput');
    if (!box || !input) return;
    if (input.disabled || !App.state.guides.length) { App.tutupSaran(); return; }

    const teks = String(input.value || '').trim();
    const filter = labelFilter();
    let cocok = App.cariSaran(teks, App.guidesTersaring());
    let atas = '';
    // Sama seperti saat menyimpan (guideUntukSimpan): bila tak ada yang cocok
    // di filter, cari di semua guide — regu tiap baris tetap terlihat.
    if (!cocok.length && teks && filter) {
      cocok = App.cariSaran(teks, App.state.guides);
      if (cocok.length) atas = `Tidak ada di ${esc(filter)}. Guide dari kategori/regu lain:`;
    }
    if (!cocok.length) {
      atas = teks ? `Tidak ada guide yang cocok dengan “${esc(teks)}”.`
                  : `Belum ada guide di ${esc(filter || 'daftar')}.`;
    }

    const tampil = cocok.slice(0, SARAN_MAKS);
    const sisa = cocok.length - tampil.length;
    App.state.saranAktif = -1;
    input.removeAttribute('aria-activedescendant');
    box.innerHTML =
      (atas ? `<div class="saran-info">${atas}</div>` : '') +
      `<div id="guideSaranDaftar" role="listbox" aria-label="Saran nama guide">` +
      tampil.map((g, i) =>
        `<button type="button" class="saran-item" id="saran-${i}" role="option" tabindex="-1" ` +
        `aria-selected="false" data-saran="${esc(g.guideId)}">` +
        `<span class="saran-nama">${esc(g.guideName)}</span>` +
        `<span class="saran-meta">${esc(g.guideId)} · ${esc(App.labelRegu(g.regu) || 'tanpa regu')}</span>` +
        `</button>`).join('') +
      `</div>` +
      (sisa > 0 ? `<div class="saran-info">+${sisa} guide lainnya — ketik lebih lengkap.</div>` : '');
    box.scrollTop = 0;
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    App.ukurSaran();
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
   * Tinggi daftar mengikuti ruang yang benar-benar terlihat di bawah kotak
   * nama. Di HP keyboard menutup hampir separuh layar; visualViewport memberi
   * tahu di mana layar yang terlihat berakhir.
   */
  App.ukurSaran = function ukurSaran() {
    const box = $('#guideSaran');
    const input = $('#guideInput');
    if (!box || box.hidden || !input) return;
    const vv = window.visualViewport;
    const batasBawah = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const ruang = Math.floor(batasBawah - input.getBoundingClientRect().bottom - 16);
    box.style.maxHeight = Math.max(SARAN_TINGGI_MIN, Math.min(SARAN_TINGGI_MAKS, ruang)) + 'px';
  }

  /** Panah atas/bawah: pindahkan sorotan di daftar saran. */
  App.geserSaran = function geserSaran(arah) {
    const items = $$('#guideSaranDaftar [data-saran]');
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
    const items = $$('#guideSaranDaftar [data-saran]');
    const aktif = items[App.state.saranAktif];
    if (aktif) return aktif.dataset.saran;
    if (items.length === 1) return items[0].dataset.saran;
    const q = rapikan($('#guideInput').value);
    const persis = items.filter(el => rapikan(el.querySelector('.saran-nama').textContent) === q);
    return persis.length === 1 ? persis[0].dataset.saran : null;
  }

  /** Jumlah baris yang bisa dipilih di daftar saran yang sedang terbuka. */
  App.jumlahSaran = function jumlahSaran() {
    return App.saranTerbuka() ? $$('#guideSaranDaftar [data-saran]').length : 0;
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
