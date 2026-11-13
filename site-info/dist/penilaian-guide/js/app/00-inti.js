/* =========================================================
   Inti — namespace, state bersama, pembantu murni
   Berkas 1 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Membuat window.App, memegang satu-satunya salinan state yang
              berubah, dan menyediakan pembantu tanpa efek samping.
   LARANGAN : Tidak boleh memanggil DB/Sync maupun menyentuh state milik satu
              layar.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = (window.App = window.App || {});

  /**
   * Isian penilaian "100 − potongan" (sejak 2.2.0). Petugas hanya mencatat yang
   * terlihat; besar potongan ditetapkan portal per bulan dan tidak ada di HP.
   *   idCard   : true = terpasang & terlihat, false = tidak (wajib dipilih)
   *   seragam  : 'lengkap' | 'kurang' | 'tidak' (wajib dipilih)
   *   teguran  : kode jenis teguran, paling banyak 2
   *   berat    : kode pelanggaran berat atau '' — diverifikasi Pengelola
   *   apresiasi: kode apresiasi atau '' — diverifikasi Pengelola, tidak masuk nilai
   */
  function kritKosong() { return { idCard: null, seragam: null, teguran: [], berat: '', apresiasi: '' }; }

  /**
   * Satu-satunya salinan state yang berubah. Sengaja dikumpulkan di sini:
   * setelah app.js dipecah, dua berkas yang masing-masing memegang salinannya
   * sendiri akan berselisih diam-diam. Semua berkas membacanya lewat App.state.
   */
  App.state = {
    guides: [],
    current: 'home',
    // lanjutJeda = evaluationId penilaian sebelumnya yang sudah petugas
    // nyatakan "ini pengantaran berikutnya". Disimpan per formulir, dan hangus
    // begitu guide atau pos berganti — persetujuan untuk satu situasi tidak
    // boleh diam-diam berlaku untuk situasi lain.
    form: { pos: null, guide: null, crit: kritKosong(), catatan: '', lanjutJeda: null },
    // Tautan pos tersimpan di HP: [{token, pos, label, dicabut}]. Pos penilaian
    // selalu diambil dari sini, bukan dipilih bebas oleh petugas.
    tautan: [],
    riwayatBatas: 200,
    // Versi baru sudah siap, tapi halaman tidak dimuat ulang selagi formulir berisi.
    versiBaruSiap: false,
    historyFilter: 'all',
    /**
     * Penilaian yang sedang dibetulkan, atau null.
     * Salah pencet tidak bisa dihapus — tab Evaluations append-only dan satu pos
     * hanya boleh menilai satu kali sehari. Yang bisa dilakukan adalah mengirim
     * penilaian PENGGANTI yang menunjuk penilaian lama; server menandai yang
     * lama 'diganti' dan rekap memakai yang baru.
     */
    koreksi: null,
    guideKategoriFilter: '',
    // Baris daftar saran nama guide yang disorot panah atas/bawah; -1 = tidak ada.
    saranAktif: -1,
    tutIndex: 0,
    initialised: false,
  };

  // Dinaikkan bersama versi cache di sw.js. Keduanya harus bergerak
  // beriringan: kalau APP_VERSION mandek, laporan staff ("versi berapa yang
  // muncul di layar Tentang?") tidak bisa dipakai memastikan HP mana yang
  // sudah menerima pembaruan.
  const APP_VERSION = '2.2.0';

  const $ = s => document.querySelector(s);

  const $$ = s => Array.from(document.querySelectorAll(s));

  const TITLES = {
    home: 'Penilaian Guide',
    nilai: 'Penilaian Baru',
    guides: 'Daftar Guide',
    riwayat: 'Riwayat',
    pengaturan: 'Pengaturan',
    tentang: 'Tentang',
    tautan: 'Tautan Pos',
  };

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16);
      }));

  const fmtTime = iso => {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const jamLokal = iso => {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return isNaN(d) ? '' : `${p(d.getHours())}.${p(d.getMinutes())}`;
  };

  // Penilaian cara lama (sebelum 2.2.0) masih bisa ada di HP: Uniform −1/+1/+2 dan
  // Etika −5…+5. Dibaca untuk riwayat dan dipetakan seperti di portal.
  const ETIKA_MIN = -5;

  const ETIKA_MAKS = 5;

  const UNIFORM_LABEL = { '-1': 'Tidak sesuai', '1': 'Sesuai', '2': 'Bagus' };

  const SERAGAM_LABEL = { lengkap: 'Lengkap', kurang: 'Kurang lengkap', tidak: 'Tidak berseragam' };

  const TEGURAN_MAKS = 2;

  // Jam berlaku pilihan nama petugas: sekali per shift.
  const PETUGAS_JAM = 8;

  /**
   * Samakan nilai Uniform ke skala tiga tingkat.
   * Entri lama di perangkat menyimpannya sebagai boolean, dan 0 hanya ada di
   * data lama — keduanya dipetakan ke -1 "tidak sesuai", sama seperti server.
   */
  const nilaiUniform = v => {
    if (v === true) return 1;
    if (v === false) return -1;
    const n = Number(v);
    if (!isFinite(n) || n === 0) return -1;
    return Math.max(-1, Math.min(2, Math.round(n)));
  };

  const labelUniform = v => UNIFORM_LABEL[String(nilaiUniform(v))];

  /** true bila isian memakai cara baru (2.2.0+). */
  const caraBaru = c => !!c && typeof c.seragam === 'string';

  /**
   * Temuan satu penilaian, untuk cara baru dan lama sekaligus — sama dengan portal:
   * cara lama ID 0 = tanpa ID, Uniform −1 = tidak berseragam, Etika minus dengan
   * seragam sesuai = 1 teguran ("Bagus" dan Etika plus tidak dihitung).
   */
  const temuanDari = c => {
    c = c || {};
    if (caraBaru(c)) {
      return { tanpaId: c.idCard ? 0 : 1, kurang: c.seragam === 'kurang' ? 1 : 0, tidak: c.seragam === 'tidak' ? 1 : 0,
               teguran: Array.isArray(c.teguran) ? c.teguran.length : 0 };
    }
    const u = nilaiUniform(c.uniform), e = Number(c.etika) || 0;
    return { tanpaId: c.idCard ? 0 : 1, kurang: 0, tidak: u === -1 ? 1 : 0, teguran: e < 0 && u >= 1 ? 1 : 0 };
  };

  /** Ringkasan singkat isian untuk pesan dan riwayat, mis. "ID Tidak, Seragam Lengkap, 1 teguran". */
  const ringkasKriteria = c => {
    c = c || {};
    if (!caraBaru(c)) return `Uniform ${labelUniform(c.uniform)}, ID ${c.idCard ? 'Ya' : 'Tidak'}, Etika ${Number(c.etika) > 0 ? '+' : ''}${Number(c.etika) || 0}`;
    const n = Array.isArray(c.teguran) ? c.teguran.length : 0;
    return `ID ${c.idCard ? 'Terpasang' : 'Tidak'}, Seragam ${SERAGAM_LABEL[c.seragam] || '—'}` +
      (n ? `, ${n} teguran` : '') + (c.berat ? ', pelanggaran berat dilaporkan' : '') + (c.apresiasi ? ', apresiasi' : '');
  };

  /** Tautan aktif untuk pos tertentu, atau null. */
  App.tautanPos = function tautanPos(pos) {
    return App.state.tautan.find(l => l.pos === Number(pos) && !l.dicabut) || null;
  };

  /** Label pos dari tautan (mis. "Pos 1 — Pintu Masuk"). */
  App.labelPos = function labelPos(pos) {
    const l = App.state.tautan.find(x => x.pos === Number(pos));
    return l ? l.label : `Pos ${pos}`;
  };

  App.toast = function toast(msg, type = '', icon = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    // Disusun sebagai teks, bukan HTML. Pesannya kerap memuat ketikan staff
    // (mis. nama guide yang ambigu) dan alasan penolakan dari server — keduanya
    // tidak boleh ikut dieksekusi sebagai markup.
    if (icon) {
      const ik = document.createElement('span');
      ik.className = 'ticon';
      ik.textContent = icon;
      el.appendChild(ik);
    }
    const teks = document.createElement('span');
    teks.textContent = msg;
    el.appendChild(teks);
    $('#toastWrap').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 3200);
  }

  App.haptic = function haptic(pattern = 30) {
    if (Sync.Settings.get().haptic && navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} }
  }

  App.download = function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* Diekspor supaya berkas lain bisa men-destructure-nya dari App. */
  Object.assign(App, { APP_VERSION, $, $$, TITLES, uuid, fmtTime, esc, jamLokal,
                       ETIKA_MIN, ETIKA_MAKS, UNIFORM_LABEL, SERAGAM_LABEL, TEGURAN_MAKS, PETUGAS_JAM,
                       nilaiUniform, labelUniform, caraBaru, temuanDari, ringkasKriteria, kritKosong });
})();
