/* =========================================================
   Perakitan — binding event, langganan Sync, init
   Berkas 8 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Satu-satunya berkas yang memasang listener DOM dan menjalankan
              init().
   LARANGAN : Tidak memuat logika bisnis; hanya menyambungkan DOM ke App.*.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { APP_VERSION, $, $$, ETIKA_MIN, ETIKA_MAKS, KRIT_ANGKA, KRIT_TINGKAT } = App;

  App.bind = function bind() {
    $('#btnMenu').addEventListener('click', App.openDrawer);
    $('#scrim').addEventListener('click', App.closeDrawer);
    $('#btnBack').addEventListener('click', () => App.go('home'));
    document.addEventListener('click', e => {
      const ulang = e.target.closest('[data-retry]');
      if (ulang) { App.cobaKirimLagi(ulang.dataset.retry); return; }
      const betul = e.target.closest('[data-fix]');
      if (betul) { App.mulaiKoreksi(betul.dataset.fix); return; }
      // "Ya, ini pengantaran berikutnya": petugas menyatakan penilaian yang
      // berdekatan itu memang sah, lalu formulirnya dikirim ulang apa adanya.
      const lanjut = e.target.closest('[data-lanjut]');
      if (lanjut) {
        App.state.form.lanjutJeda = lanjut.dataset.lanjut;
        const kotak = $('#guideAmbigu');
        if (kotak) { kotak.hidden = true; kotak.textContent = ''; }
        App.submitEval({ preventDefault() {} });
        return;
      }
      if (e.target.closest('[data-batal-koreksi]')) { App.batalKoreksi(); return; }
      const hapus = e.target.closest('[data-hapus-tautan]');
      if (hapus) { App.hapusTautan(Number(hapus.dataset.hapusTautan)); return; }
      const nav = e.target.closest('[data-nav]');
      if (nav) { App.go(nav.dataset.nav); }
      const gcard = e.target.closest('[data-guide]');
      if (gcard) {
        // guideId dulu — nama bisa kembar, id tidak pernah.
        const g = App.findGuideById(gcard.dataset.guideId) || App.findGuide(gcard.dataset.guide);
        if (g) {
          App.state.form.guide = g; $('#guideInput').value = g.guideName;
          App.showPicked(g); App.tampilkanKandidat(null); App.saveDraft(); App.go('nilai');
        }
      }
    });

    $('#btnNewEval').addEventListener('click', () => {
      // "Penilaian Baru" selalu berarti baru — kalau ada koreksi yang belum
      // selesai, formulirnya masih terkunci ke guide & pos penilaian lama.
      if (App.state.koreksi) App.batalKoreksi(true);
      App.go('nilai');
    });
    // Pemilih pos hanya tampil bila HP menyimpan tautan lebih dari satu pos.
    $('#homePos').addEventListener('change', e => {
      App.state.form.pos = Number(e.target.value);
      // Persetujuan jeda terikat pada guide DAN pos tertentu; pindah pos
      // berarti situasinya lain, jadi petugas ditanya lagi.
      App.state.form.lanjutJeda = null;
      Sync.Settings.set({ pos: App.state.form.pos });
      App.tampilkanPos();
      if (App.state.form.guide) App.showPicked(App.state.form.guide);
      App.saveDraft();
    });

    $('#formTautan').addEventListener('submit', e => {
      e.preventDefault();
      App.pakaiTautan($('#tautanInput').value);
    });
    $('#btnMoreHistory').addEventListener('click', () => {
      App.state.riwayatBatas += 200;
      App.renderHistory();
    });
    $('#btnMuatUlang').addEventListener('click', async () => {
      // Draf disimpan dulu, jadi isian formulir pulih setelah dimuat ulang.
      await DB.simpanDraftSegera(App.state.form);
      location.reload();
    });

    $('#guideInput').addEventListener('input', e => {
      const teks = String(e.target.value || '').trim();
      const q = teks.toLowerCase();
      // Nama yang diketik bisa dimiliki lebih dari satu orang. Yang sedang
      // tersaring diprioritaskan; kalau tetap lebih dari satu, jangan menebak —
      // tawarkan kandidatnya supaya staff memilih orangnya lewat guideId.
      const persis = (arr) => arr.filter(x => String(x.guideName).toLowerCase() === q);
      let cocok = persis(App.guidesTersaring());
      if (cocok.length !== 1) cocok = persis(App.state.guides);
      if (cocok.length > 1) {
        App.state.form.guide = null;
        $('#guidePicked').classList.add('hidden');
        App.tampilkanKandidat(cocok);
      } else {
        const g = cocok[0] || App.findGuide(teks);
        App.state.form.guide = g;
        if (g && g.guideName.toLowerCase() === q) App.showPicked(g);
        else $('#guidePicked').classList.add('hidden');
        App.tampilkanKandidat(null);
      }
      // Ganti guide berarti situasinya lain: persetujuan jeda untuk guide
      // sebelumnya tidak boleh ikut terbawa.
      App.state.form.lanjutJeda = null;
      App.saveDraft();
      $('#draftNote').hidden = false;
      if (App.tampilkanSaran) App.tampilkanSaran();
    });

    // Daftar saran nama guide (pengganti <datalist>, lihat 02-guide.js).
    const guideInput = $('#guideInput');
    const guideSaran = $('#guideSaran');
    // Selama pembaruan, HP bisa sesaat memuat index.html atau 02-guide.js lama
    // dari cache (keduanya diperbarui terpisah). Tanpa penjagaan ini, satu galat
    // di sini menghentikan semua binding di bawahnya, termasuk tombol SIMPAN.
    if (guideSaran && App.tampilkanSaran) {
      guideInput.addEventListener('focus', () => {
        App.tampilkanSaran();
        // Di HP keyboard menutup hampir separuh layar. Kotak nama digeser ke atas
        // supaya daftar saran di bawahnya terlihat beberapa baris, bukan satu.
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
          setTimeout(() => {
            if (document.activeElement !== guideInput) return;
            const halus = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            guideInput.scrollIntoView({ block: 'start', behavior: halus ? 'smooth' : 'auto' });
          }, 300);
        }
      });
      // Kotak yang masih fokus diketuk lagi setelah daftarnya ditutup (Esc/pilih).
      guideInput.addEventListener('click', () => { if (!App.saranTerbuka()) App.tampilkanSaran(); });
      guideInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!App.saranTerbuka()) App.tampilkanSaran();
          App.geserSaran(e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter' && App.jumlahSaran()) {
          // Enter memilih baris yang disorot, satu-satunya baris, atau nama yang
          // persis sama (saranUntukEnter), dan tidak mengirim formulir selama
          // pilihan nama masih terbuka.
          e.preventDefault();
          const id = App.saranUntukEnter();
          if (id) App.pilihSaran(id);
        } else if (e.key === 'Escape' && App.saranTerbuka()) {
          e.preventDefault();
          App.tutupSaran();
        }
      });
      // Ditutup sedikit tertunda, supaya ketukan pada baris saran sempat diproses
      // di peramban yang memindahkan fokus lebih dulu.
      guideInput.addEventListener('blur', () => {
        setTimeout(() => { if (document.activeElement !== guideInput) App.tutupSaran(); }, 150);
      });
      // Ketukan di luar kotak nama menutup daftar. Di iOS kotak nama tidak selalu
      // kehilangan fokus saat tombol lain diketuk, jadi blur saja tidak cukup.
      document.addEventListener('click', e => {
        if (App.saranTerbuka() && !e.target.closest('.saran-wrap')) App.tutupSaran();
      });
      // Fokus tetap di kotak nama selama baris saran ditekan.
      guideSaran.addEventListener('mousedown', e => e.preventDefault());
      guideSaran.addEventListener('click', e => {
        const item = e.target.closest('[data-saran]');
        if (!item) return;
        App.pilihSaran(item.dataset.saran);
        // Keyboard HP ditutup: langkah berikutnya menekan tombol penilaian.
        guideInput.blur();
      });
      const ukurSaran = () => { if (App.saranTerbuka()) App.ukurSaran(); };
      window.addEventListener('resize', ukurSaran);
      window.addEventListener('scroll', ukurSaran, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', ukurSaran);
        window.visualViewport.addEventListener('scroll', ukurSaran);
      }
    }

    $('#catatan').addEventListener('input', e => { App.state.form.catatan = e.target.value; App.saveDraft(); });

    $$('.criterion').forEach(c => {
      if (!KRIT_ANGKA[c.dataset.crit]) c.classList.add('unset');

      c.querySelectorAll('.seg').forEach(btn => btn.addEventListener('click', () => {
        // Uniform menyimpan ANGKA bertingkat (-1/+1/+2); kriteria lain tetap
        // Ya/Tidak. Tanpa pemisahan ini, "Bagus" tersimpan sebagai false.
        App.state.form.crit[c.dataset.crit] = KRIT_TINGKAT[c.dataset.crit]
          ? Number(btn.dataset.val)
          : Number(btn.dataset.val) === 1;
        App.applyCritUI(); App.saveDraft(); App.haptic(15);
        $('#draftNote').hidden = false;
      }));

      // Penghitung Etika
      c.querySelectorAll('.stepbtn').forEach(btn => btn.addEventListener('click', () => {
        const kk = c.dataset.crit;
        const n = (Number(App.state.form.crit[kk]) || 0) + Number(btn.dataset.step);
        App.state.form.crit[kk] = Math.min(ETIKA_MAKS, Math.max(ETIKA_MIN, n));
        App.applyCritUI(); App.saveDraft(); App.haptic(15);
        $('#draftNote').hidden = false;
      }));
    });

    $('#formEval').addEventListener('submit', App.submitEval);

    $('#guideSearch').addEventListener('input', App.renderGuideCards);

    // Filter kategori & regu di layar Penilaian
    ['#filterKategori', '#filterRegu'].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('change', () => {
        Sync.Settings.set({
          filterKategori: $('#filterKategori').value,
          filterRegu: $('#filterRegu').value,
        });
        // Kalau nama yang sudah diketik tak lagi masuk filter, kosongkan
        const g = App.findGuide($('#guideInput').value);
        if (!g || !App.cocokFilter(g, $('#filterKategori').value, $('#filterRegu').value)) {
          $('#guideInput').value = '';
          App.state.form.guide = null;
          $('#guidePicked').classList.add('hidden');
        }
        App.fillGuideInputs();
        App.saveDraft();
      });
    });

    // Filter kategori di layar Daftar Guide
    $$('.chip[data-gfilter]').forEach(ch => ch.addEventListener('click', () => {
      $$('.chip[data-gfilter]').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      App.state.guideKategoriFilter = ch.dataset.gfilter;
      App.renderGuideCards();
    }));

    // Chip riwayat dan chip daftar guide harus terpisah — jangan pakai '.chip' polos
    $$('.chip[data-filter]').forEach(ch => ch.addEventListener('click', () => {
      $$('.chip[data-filter]').forEach(x => x.classList.remove('active'));
      ch.classList.add('active'); App.state.historyFilter = ch.dataset.filter; App.state.riwayatBatas = 200; App.renderHistory();
    }));

    $('#btnExportCsv').addEventListener('click', App.exportCsv);
    $('#btnSyncNow').addEventListener('click', () => Sync.syncNow({ force: true }));
    $('#btnForceSync').addEventListener('click', () => Sync.syncNow({ force: true }));

    $('#btnTestServer').addEventListener('click', async () => {
      $('#testHint').textContent = 'Menghubungi portal…';
      try {
        const r = await Sync.ping();
        $('#testHint').textContent = `✅ Terhubung · ${r.guides.length} guide aktif`;
        App.toast('Portal dapat dihubungi', 'ok', '📡');
      } catch (e) {
        $('#testHint').textContent = '❌ Gagal: ' + e.message;
        App.toast('Portal tidak dapat dihubungi', 'err', '❌');
      }
      await App.muatTautan();
      await App.loadGuides();
    });

    $('#btnBackup').addEventListener('click', async () => {
      App.download(`cadangan-penilaian-${Date.now()}.json`, await DB.exportJson(), 'application/json');
      App.toast('Cadangan JSON diunduh', 'ok', '📦');
    });

    $('#btnClearSynced').addEventListener('click', async () => {
      if (!confirm('Hapus semua data yang SUDAH terkirim dari perangkat ini?')) return;
      const n = await DB.clearSynced();
      App.toast(`${n} data terkirim dihapus`, 'ok', '🧹');
      App.refreshStats(); App.refreshStorage(); App.renderHistory();
    });

    $('#optForceOffline').addEventListener('change', e => { Sync.Settings.set({ forceOffline: e.target.checked }); App.setNet(); });
    $('#optEncrypt').addEventListener('change', e => { Sync.Settings.set({ encrypt: e.target.checked }); DB.setEncryption(e.target.checked); App.toast('Berlaku untuk data baru', 'ok', '🔐'); });
    $('#optHaptic').addEventListener('change', e => Sync.Settings.set({ haptic: e.target.checked }));

    $('#btnShowTutorial').addEventListener('click', () => App.showTutorial(true));
    $('#tutSkip').addEventListener('click', App.endTutorial);
    $('#tutNext').addEventListener('click', () => {
      if (App.state.tutIndex < App.TUT.length - 1) { App.state.tutIndex++; App.renderTut(); } else App.endTutorial();
    });

    window.addEventListener('hashchange', () => {
      // Tautan pos baru dibuka saat aplikasi sudah terbuka.
      if (Sync.tokenDari(location.hash)) { App.bacaTokenDariAlamat(); return; }
      App.go((location.hash || '#home').slice(1));
    });
    window.addEventListener('beforeunload', () => DB.backupNow());
    document.addEventListener('visibilitychange', () => { if (document.hidden) DB.simpanDraftSegera(App.state.form); });
  }

  /** Muat ulang daftar tautan dari IndexedDB ke state dan tampilan. */
  App.muatTautan = async function muatTautan() {
    App.state.tautan = await DB.bacaTautan();
    if (!App.state.tautan.some(l => l.pos === Number(App.state.form.pos))) App.state.form.pos = App.posBawaan();
    App.tampilkanPos();
    App.tampilkanTautanDicabut();
    if (App.state.current === 'pengaturan') App.renderTautan();
  }

  /**
   * Simpan tautan pos dari teks yang ditempel atau dari bilah alamat.
   * Wajib online sekali: token diperiksa ke portal dan daftar guide dimuat.
   */
  App.pakaiTautan = async function pakaiTautan(teks) {
    const hasil = $('#tautanHasil');
    const tulis = (pesan) => { if (hasil) { hasil.textContent = pesan; hasil.hidden = false; } };
    const token = Sync.tokenDari(teks);
    if (!token) { tulis('Tautan tidak dikenali. Salin seluruh tautan pos dari pengelola, lalu tempel di sini.'); return false; }
    if (!navigator.onLine) { tulis('HP sedang offline. Buka tautan pos saat ada sinyal.'); App.go('tautan'); return false; }
    tulis('Memeriksa tautan…');
    try {
      const data = await Sync.bukaTautan(token);
      $('#tautanInput').value = '';
      if (hasil) hasil.hidden = true;
      await App.muatTautan();
      App.state.form.pos = Number(data.pos);
      Sync.Settings.set({ pos: App.state.form.pos });
      App.tampilkanPos();
      App.state.guides = data.guides;
      App.fillGuideInputs();
      App.toast(`Tautan ${data.label} tersimpan · ${data.guides.length} guide`, 'ok', '🔗');
      App.go('home');
      Sync.syncNow({ force: true });
      return true;
    } catch (e) {
      tulis(e.dicabut ? 'Tautan ini sudah tidak aktif. Minta tautan pos terbaru kepada pengelola kunjungan.'
                      : 'Tautan belum dapat diperiksa: ' + e.message);
      await App.muatTautan();
      App.go('tautan');
      return false;
    }
  }

  /** Token di fragmen (#…) dibaca sekali lalu dihapus dari bilah alamat (ATR-FL-02). */
  App.bacaTokenDariAlamat = async function bacaTokenDariAlamat() {
    const teks = location.hash;
    if (!Sync.tokenDari(teks)) return false;
    history.replaceState(null, '', location.pathname + location.search + '#home');
    return App.pakaiTautan(teks);
  }

  App.hapusTautan = async function hapusTautan(pos) {
    const pending = (await DB.pending()).filter(e => Number(e.pos) === pos).length;
    const pesan = pending
      ? `Masih ada ${pending} penilaian ${App.labelPos(pos)} yang belum terkirim. Penilaian itu tetap di HP dan baru terkirim setelah tautan pos ini dibuka lagi. Hapus tautan?`
      : `Hapus tautan ${App.labelPos(pos)} dari HP ini?`;
    if (!confirm(pesan)) return;
    await DB.hapusTautan(pos);
    await App.muatTautan();
    App.renderTautan();
    App.toast('Tautan dihapus dari HP ini', 'ok', '🔗');
    if (!App.state.tautan.length) App.go('tautan');
  }

  App.bindSync = function bindSync() {
    Sync.onChange((state, d) => {
      App.setNet(state, d);
      if (state === 'done' && d.sent > 0) {
        // Dashboard portal langsung memuat kiriman ini; salinan spreadsheet menyusul otomatis.
        App.toast(`${d.sent} data terkirim ke portal`, 'ok', '✅');
        App.haptic(20);
      }
      if (state === 'error') App.toast('Gagal kirim, akan dicoba lagi otomatis', 'warn', '⏳');
      if (state === 'ditolak') {
        // Ditolak server — bukan masalah jaringan, jadi jangan menjanjikan
        // "akan dicoba lagi otomatis" seolah-olah tinggal menunggu sinyal.
        App.toast(d.ditahan
          ? `${d.ditahan} penilaian ditahan — buka Riwayat untuk melihat alasannya`
          : `Ditolak server: ${d.message || 'lihat Riwayat'}`,
          'warn', '🚫');
      }
      if (state === 'tautan' || state === 'tautanDicabut') App.muatTautan();
      if (state === 'offline') { /* badge saja */ }
      if (state === 'progress' || state === 'syncing') return;
      App.refreshStats();
      // Riwayat tidak digambar ulang pada setiap kemajuan kirim (ATR-FL-12).
      if (App.state.current === 'riwayat') App.renderHistory();
    });
  }

  App.init = async function init() {
    if (App.state.initialised) return;          // cegah inisialisasi ganda
    App.state.initialised = true;
    $$('[data-version]').forEach(el => el.textContent = APP_VERSION);

    const s = Sync.Settings.get();
    $('#optForceOffline').checked = !!s.forceOffline;
    $('#optEncrypt').checked = s.encrypt !== false;
    $('#optHaptic').checked = s.haptic !== false;
    DB.setEncryption(s.encrypt !== false);
    App.state.tautan = await DB.bacaTautan();
    App.state.form.pos = App.posBawaan();
    App.tampilkanPos();
    App.tampilkanTautanDicabut();
    // Filter guide diingat antar penilaian — staff satu pos biasanya
    // menangani kategori/regu yang sama sepanjang hari.
    if ($('#filterKategori')) $('#filterKategori').value = s.filterKategori || '';
    if ($('#filterRegu')) $('#filterRegu').value = s.filterRegu || '';

    App.bind();
    App.bindSync();

    const restored = await DB.restoreIfEmpty();
    if (restored) App.toast(`${restored} data dipulihkan dari cadangan`, 'warn', '♻️');

    // Token di fragmen dihapus dari bilah alamat SEBELUM apa pun digambar.
    const tokenAlamat = Sync.tokenDari(location.hash) ? location.hash : null;
    if (tokenAlamat) history.replaceState(null, '', location.pathname + location.search + '#home');

    await App.loadDraft();
    App.applyCritUI();
    App.setNet();
    await App.refreshStats();
    await App.loadGuides();
    App.go((location.hash || '#home').slice(1));
    if (tokenAlamat) await App.pakaiTautan(tokenAlamat);
    App.showTutorial(false);
    Sync.start();
    DB.pangkasTerkirim().catch(e => console.warn('[db] gagal memangkas entri lama', e));

    // Service worker + pembaruan otomatis.
    // Strategi cache-first membuat perangkat bisa memakai versi lama setelah
    // aplikasi di-deploy ulang; blok ini memuat ulang halaman begitu versi baru
    // mengambil alih, sehingga staff tidak perlu membersihkan cache manual.
    const swBox = $('#aboutSw');
    if ('serviceWorker' in navigator) {
      // Tanyakan versi cache yang benar-benar aktif di perangkat ini.
      navigator.serviceWorker.addEventListener('message', ev => {
        if (ev.data && ev.data.versiCache && swBox) swBox.textContent = ev.data.versiCache;
      });
      const tanyaVersi = () => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage('versi');
        } else if (swBox) {
          swBox.textContent = 'belum dipasang (buka lewat HTTPS agar aktif)';
        }
      };
      setTimeout(tanyaVersi, 800);

      // Kunjungan pertama: service worker baru mengklaim halaman tanpa versi
      // lama, jadi TIDAK dimuat ulang (NG-R2). Versi baru berikutnya tidak
      // memuat ulang selagi formulir berisi isian (ATR-FL-14).
      let adaPengendali = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!adaPengendali) { adaPengendali = true; return; }
        if (App.state.current !== 'nilai' && App.formulirKosong()) { location.reload(); return; }
        App.state.versiBaruSiap = true;
        $('#updateBar').hidden = false;
      });
      navigator.serviceWorker.register('sw.js', { scope: './' })
        .then(reg => {
          reg.update();
          setInterval(() => reg.update(), 60 * 60 * 1000); // cek pembaruan tiap jam
        })
        .catch(e => console.warn('[sw]', e));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', App.init);
  else App.init();
})();
