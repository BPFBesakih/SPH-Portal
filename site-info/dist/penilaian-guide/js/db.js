/* =========================================================
   db.js — Penyimpanan lokal (IndexedDB + enkripsi AES-256-GCM)
   PRD §4.4, §5 (keamanan), §10 (mitigasi korupsi data)
   ========================================================= */
(function (global) {
  'use strict';

  // Nama baru di origin portal: data aplikasi lama ada di nilaiguide.vercel.app
  // dan tidak bisa dipindah otomatis (ATR-FL-10).
  const DB_NAME = 'bpb-penilaian-guide';
  const DB_VERSION = 1;
  const STORE = 'evaluations';
  const META = 'meta';
  const KEY_STORAGE = 'bpb.pg.cryptoKey';
  const BACKUP_KEY = 'bpb.pg.backup';
  const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // §10: backup tiap 5 menit
  const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024; // §10: batas 10 MB
  const DRAFT_KEY = 'bpb.pg.draft';
  const STATUS_BACKUP_KEY = 'bpb.pg.backupStatus';
  const JAM_KEY = 'bpb.pg.selisihJam';

  /**
   * Selisih jam perangkat terhadap jam server, dalam milidetik
   * (positif = jam perangkat KETINGGALAN).
   *
   * Jam HP yang meleset membuat penilaian jatuh pada TANGGAL yang salah di
   * rekap — dan itu tidak bisa dilihat dari sisi perangkat, karena semua
   * tampilan di aplikasi memakai jam yang sama melesetnya. Selisih ini diisi
   * sync.js setiap kali server membalas dengan serverTime, lalu dipakai
   * membuat cap waktu penilaian berikutnya, termasuk saat sedang offline.
   */
  const TOLERANSI_JAM_MS = 60 * 1000;        // di bawah ini dianggap derau jaringan
  const JAM_MENCURIGAKAN_MS = 5 * 60 * 1000; // di atas ini staff diberi tahu

  /**
   * Berapa kali sebuah entri boleh DITOLAK SERVER sebelum berhenti dicoba
   * otomatis. Yang dihitung hanya penolakan server (HTTP 400 / masuk daftar
   * `rejected`), bukan kegagalan jaringan — perangkat bisa berminggu-minggu di
   * luar jangkauan, dan itu bukan alasan menyerah.
   *
   * Entri yang buntu TIDAK dibuang: ia hilang dari antrean otomatis, muncul di
   * layar Riwayat lengkap dengan alasannya, dan bisa dikembalikan ke antrean
   * lewat tombol "Coba lagi" — mis. setelah admin menambahkan guide-nya di tab
   * Guides.
   */
  const MAKS_TOLAKAN = 6;

  // Entri TERKIRIM yang lebih tua dari ini dihapus otomatis. Entri yang belum
  // terkirim tidak pernah dihapus (ATR-FL-11).
  const SIMPAN_TERKIRIM_HARI = 45;
  const GUIDES_KEY = 'bpb.pg.guides';
  // Bahan formulir "100 − potongan" dari tautan pos: jenis temuan, petugas, petunjuk.
  const PENILAIAN_KEY = 'bpb.pg.penilaian';
  const TAUTAN_KEY = 'tautanPos';

  /**
   * Batas ukuran cadangan di localStorage. Kuotanya sekitar 5 MB sementara
   * IndexedDB boleh sampai 10 MB, dan base64 membengkakkan isi ±1,4x — jadi
   * menyalin seluruh basis data apa adanya PASTI gagal begitu data menumpuk,
   * dan dulu gagalnya diam-diam di dalam catch. Sekarang isinya dipangkas
   * lebih dulu (yang sudah terkirim dibuang duluan, karena salinannya sudah
   * ada di server) dan kegagalannya dilaporkan ke layar Pengaturan.
   */
  const BACKUP_MAKS_BYTES = 3 * 1024 * 1024;

  let dbPromise = null;
  let cryptoKey = null;
  let encryptionEnabled = true;

  /* ---------------------- Enkripsi ---------------------- */
  const canCrypto = () => !!(global.crypto && global.crypto.subtle && global.isSecureContext !== false);

  /**
   * Kunci disimpan di DUA tempat: localStorage dan object store `meta` di
   * IndexedDB yang sama dengan datanya.
   *
   * Penilaian ada di IndexedDB, sedangkan dulu kuncinya hanya di localStorage.
   * Keduanya bisa dibersihkan browser secara terpisah — begitu localStorage
   * hilang, kunci baru dibuat dan SELURUH penilaian lama berubah menjadi
   * "(data rusak)" walau isinya sebenarnya masih utuh. Menyimpan salinan kunci
   * berdampingan dengan datanya membuat keduanya hidup dan mati bersama.
   */
  async function bacaKunciTersimpan() {
    let jwk = null;
    try {
      const saved = localStorage.getItem(KEY_STORAGE);
      if (saved) jwk = JSON.parse(saved);
    } catch { jwk = null; }

    if (jwk) {
      await simpanKunciKeMeta(jwk);         // pastikan salinan cadangan ada
      return jwk;
    }

    // localStorage kosong — coba salinan yang berdampingan dengan data
    try {
      const rec = await tx('readonly', s => wrap(s.get('cryptoKey')), META);
      if (rec && rec.v) {
        try { localStorage.setItem(KEY_STORAGE, JSON.stringify(rec.v)); } catch {}
        console.warn('[db] kunci enkripsi dipulihkan dari IndexedDB');
        return rec.v;
      }
    } catch (e) { console.warn('[db] gagal membaca kunci cadangan', e); }

    return null;
  }

  async function simpanKunciKeMeta(jwk) {
    try { await tx('readwrite', s => wrap(s.put({ k: 'cryptoKey', v: jwk })), META); }
    catch (e) { console.warn('[db] gagal menyimpan kunci cadangan', e); }
  }

  async function getKey() {
    if (cryptoKey) return cryptoKey;
    if (!canCrypto()) return null;
    try {
      const jwk = await bacaKunciTersimpan();
      if (jwk) {
        cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
      } else {
        cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const baru = await crypto.subtle.exportKey('jwk', cryptoKey);
        try { localStorage.setItem(KEY_STORAGE, JSON.stringify(baru)); } catch {}
        await simpanKunciKeMeta(baru);
      }
      return cryptoKey;
    } catch (e) {
      console.warn('[db] enkripsi tidak tersedia:', e);
      return null;
    }
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function encryptObject(obj) {
    const key = encryptionEnabled ? await getKey() : null;
    if (!key) return { enc: false, payload: obj };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { enc: true, iv: b64(iv), payload: b64(data) };
  }

  async function decryptObject(rec) {
    if (!rec.enc) return rec.payload;
    const key = await getKey();
    if (!key) throw new Error('Kunci enkripsi hilang');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.payload)
    );
    return JSON.parse(dec.decode(plain));
  }

  /* ---------------------- IndexedDB ---------------------- */
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('IndexedDB tidak didukung'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'evaluationId' });
          os.createIndex('syncState', 'syncState');   // 0 = pending, 1 = synced
          os.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(mode, fn, storeName = STORE) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      try { result = fn(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  const wrap = req => { const o = { __req: req }; return o; };

  /* ---------------------- API publik ---------------------- */
  // Harus SAMA dengan JEDA_TOLAK_MENIT di server (00_Konstanta.gs). Kalau
  // aplikasi lebih longgar, staff baru tahu kirimannya ditolak setelah formulir
  // terlanjur diisi; kalau lebih ketat, ia menahan penilaian yang sah.
  const JEDA_TOLAK_MENIT = 15;

  // Ambang peringatan hanya hidup di aplikasi — server TIDAK menegakkannya.
  // Di rentang ini petugas yang memutuskan: pengantaran berikutnya diteruskan,
  // salah pencet dibetulkan.
  const JEDA_PERINGATAN_MENIT = 60;

  const DB = {
    STORAGE_LIMIT_BYTES,
    MAKS_TOLAKAN,

    setEncryption(on) { encryptionEnabled = !!on; },
    isEncryptionActive() { return encryptionEnabled && canCrypto(); },

    /** Simpan satu penilaian (status awal pending). */
    async save(evaluation) {
      const packed = await encryptObject(evaluation);
      const record = {
        evaluationId: evaluation.evaluationId,
        timestamp: evaluation.timestamp,
        pos: evaluation.pos,
        syncState: 0,
        attempts: 0,
        tolakan: 0,
        buntu: false,
        // Penilaian ini sudah dibetulkan oleh penilaian lain. Barisnya tetap
        // disimpan (append-only, sama seperti di spreadsheet) tapi tidak lagi
        // ikut rekap maupun pemeriksaan penilaian ganda.
        diganti: false,
        digantikanOleh: null,
        koreksiDari: evaluation.koreksiDari || null,
        lastError: null,
        ...packed,
      };
      await tx('readwrite', s => wrap(s.put(record)));
      DB.scheduleBackup();
      return record;
    },

    /** Satu entri (didekripsi), atau null. */
    async get(evaluationId) {
      const r = await tx('readonly', s => wrap(s.get(evaluationId)));
      if (!r) return null;
      try {
        const data = await decryptObject(r);
        return { ...data, synced: r.syncState === 1, buntu: !!r.buntu && r.syncState !== 1,
                 diganti: !!r.diganti, digantikanOleh: r.digantikanOleh || null,
                 koreksiDari: r.koreksiDari || null, lastError: r.lastError || null };
      } catch { return null; }
    },

    /**
     * Sebagian entri terbaru untuk layar Riwayat. Penyaringan memakai kolom
     * polos (status, waktu), jadi hanya `batas` entri yang didekripsi —
     * Riwayat dengan 3.000 entri tetap terbuka cepat (ATR-FL-12).
     * @param {number} batas
     * @param {(r:Object)=>boolean} saring menerima {synced, buntu, diganti}
     * @return {Promise<{items:Array, total:number, semua:Array}>}
     */
    async halaman(batas, saring) {
      const mentah = (await DB._mentah(false)).map(r => ({ r, synced: r.syncState === 1,
        buntu: !!r.buntu && r.syncState !== 1, diganti: !!r.diganti }));
      const cocok = mentah.filter(x => !saring || saring(x))
        .sort((a, b) => String(b.r.timestamp).localeCompare(String(a.r.timestamp)));
      const items = [];
      for (const { r } of cocok.slice(0, batas)) {
        try {
          const data = await decryptObject(r);
          items.push({ ...data, synced: r.syncState === 1, attempts: r.attempts || 0,
                       tolakan: r.tolakan || 0, buntu: !!r.buntu && r.syncState !== 1,
                       diganti: !!r.diganti, digantikanOleh: r.digantikanOleh || null,
                       koreksiDari: r.koreksiDari || null, lastError: r.lastError || null });
        } catch {
          items.push({ evaluationId: r.evaluationId, timestamp: r.timestamp, pos: r.pos,
                       guideName: '(data rusak)', guideId: '-', criteria: {}, corrupt: true,
                       buntu: !!r.buntu && r.syncState !== 1, lastError: r.lastError || null,
                       synced: r.syncState === 1 });
        }
      }
      return { items, total: cocok.length, jmlDitahan: mentah.filter(x => x.buntu).length };
    },

    /** Ambil semua entri, terurut terbaru dulu. */
    async all() {
      const records = await tx('readonly', s => wrap(s.getAll()));
      const out = [];
      for (const r of records || []) {
        try {
          const data = await decryptObject(r);
          out.push({ ...data, synced: r.syncState === 1, attempts: r.attempts || 0,
                     tolakan: r.tolakan || 0, buntu: !!r.buntu && r.syncState !== 1,
                     diganti: !!r.diganti, digantikanOleh: r.digantikanOleh || null,
                     koreksiDari: r.koreksiDari || null,
                     lastError: r.lastError || null });
        } catch (e) {
          console.warn('[db] gagal membuka entri', r.evaluationId, e);
          out.push({ evaluationId: r.evaluationId, timestamp: r.timestamp, pos: r.pos,
                     guideName: '(data rusak)', guideId: '-', criteria: {}, corrupt: true,
                     buntu: !!r.buntu && r.syncState !== 1, lastError: r.lastError || null,
                     synced: r.syncState === 1 });
        }
      }
      return out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    },

    /**
     * Record MENTAH (belum didekripsi). `syncState`, `timestamp`, `pos` dan
     * `buntu` disimpan di luar payload terenkripsi, jadi penghitungan dan
     * penyaringan bisa dilakukan tanpa membuka satu pun isi entri.
     *
     * @param {boolean} hanyaPending true = ambil lewat index `syncState`,
     *   sehingga entri yang sudah terkirim tidak ikut dibaca sama sekali.
     */
    async _mentah(hanyaPending) {
      if (!hanyaPending) return (await tx('readonly', s => wrap(s.getAll()))) || [];
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).index('syncState').getAll(IDBKeyRange.only(0));
        req.onsuccess = () => resolve(req.result || []);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    },

    /**
     * Entri yang menunggu dikirim.
     *
     * Dulu ini memanggil all(), yang mendekripsi SELURUH basis data — padahal
     * pending() dijalankan tiap 60 detik oleh pemicu otomatis. Sekarang hanya
     * record dengan syncState = 0 yang dibaca, dan hanya itu yang didekripsi.
     *
     * Entri yang buntu (ditolak server berkali-kali) sengaja tidak ikut: ia
     * menunggu tombol "Coba lagi" di layar Riwayat.
     */
    async pending() {
      const out = [];
      for (const r of await DB._mentah(true)) {
        if (r.buntu) continue;
        try {
          const data = await decryptObject(r);
          out.push({ ...data, synced: false, attempts: r.attempts || 0,
                     tolakan: r.tolakan || 0, koreksiDari: r.koreksiDari || null,
                     lastError: r.lastError || null });
        } catch (e) {
          // Isinya tidak terbaca di perangkat ini, jadi tidak ada yang bisa
          // dikirim. Entrinya tetap ada dan tetap terlihat di Riwayat.
          console.warn('[db] entri pending tidak terbaca', r.evaluationId, e);
        }
      }
      return out.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    },

    /** Entri yang berhenti dicoba otomatis karena ditolak server berkali-kali. */
    async daftarBuntu() {
      const out = [];
      for (const r of await DB._mentah(true)) {
        if (!r.buntu) continue;
        try {
          const data = await decryptObject(r);
          out.push({ ...data, synced: false, buntu: true,
                     tolakan: r.tolakan || 0, lastError: r.lastError || null });
        } catch {
          out.push({ evaluationId: r.evaluationId, timestamp: r.timestamp, pos: r.pos,
                     guideName: '(data rusak)', guideId: '-', criteria: {}, corrupt: true,
                     synced: false, buntu: true, lastError: r.lastError || null });
        }
      }
      return out;
    },

    /**
     * Cari penilaian atas guide yang sama, di pos yang sama, pada hari yang
     * sama — dipakai untuk memperingatkan penilaian ganda. Satu pos hanya
     * bernilai satu kehadiran, jadi penilaian kedua tidak menambah apa pun
     * kecuali memang dimaksudkan sebagai koreksi.
     *
     * Hanya melihat riwayat perangkat ini. Itu memadai karena penilaian ganda
     * di pos yang sama umumnya berasal dari perangkat yang sama juga; server
     * sengaja tidak menyediakan cara membaca kembali daftar penilaian.
     */
    /**
     * Penilaian atas guide & pos yang sama yang jaraknya lebih dekat dari jeda
     * minimum server.
     *
     * Dulu pemeriksaannya "sudah dinilai hari ini?", karena satu pos hanya
     * boleh menilai sekali sehari. Sejak penilaian dihitung per pengantaran,
     * guide yang sama boleh dinilai berkali-kali sehari di pos yang sama —
     * yang tersisa hanya pengaman salah pencet, dan batasnya harus sama persis
     * dengan yang ditegakkan server, kalau tidak aplikasi menakut-nakuti staff
     * untuk kiriman yang sebenarnya akan diterima.
     */
    JEDA_TOLAK_MENIT,
    JEDA_PERINGATAN_MENIT,

    async penilaianKembar(guideId, pos, iso) {
      const batas = JEDA_PERINGATAN_MENIT * 60000;
      const ms = new Date(iso).getTime();
      // Saring dulu memakai kolom polos (pos, waktu, status) supaya hanya
      // segelintir entri yang perlu didekripsi — simpan tetap ≤ 200 ms walau HP
      // menyimpan ribuan entri.
      const calon = [];
      for (const r of await DB._mentah(false)) {
        if (Number(r.pos) !== Number(pos) || r.diganti || (r.buntu && r.syncState !== 1)) continue;
        if (Math.abs(new Date(r.timestamp).getTime() - ms) >= batas) continue;
        try { calon.push({ ...(await decryptObject(r)), diganti: false, buntu: false }); } catch {}
      }
      const cocok = calon.filter(e =>
        !e.corrupt &&
        // Yang sudah dibetulkan tidak lagi menghalangi: penilaian penggantinya
        // yang berlaku, dan itu memang satu-satunya untuk pos & hari itu.
        !e.diganti &&
        // Entri yang ditahan juga tidak menghalangi. Menurut definisinya ia
        // TIDAK ada di server — ditolak berkali-kali lalu berhenti dicoba.
        // Kalau ia ikut dihitung, tombol "Betulkan penilaian itu" akan
        // menunjuk kiriman yang gagal, bukan penilaian yang benar-benar
        // tercatat di spreadsheet.
        !e.buntu &&
        e.guideId === guideId &&
        Number(e.pos) === Number(pos) &&
        // Selisih MUTLAK: entri offline bisa bercap waktu lebih awal.
        Math.abs(new Date(e.timestamp).getTime() - ms) < batas);
      if (!cocok.length) return null;
      // Yang TERDEKAT, bukan yang pertama ketemu. Pesannya menyebut selisih
      // menit, dan menyebut entri yang lebih jauh akan membingungkan petugas.
      const jarak = (e) => Math.abs(new Date(e.timestamp).getTime() - ms);
      return cocok.reduce((a, b) => (jarak(b) < jarak(a) ? b : a));
    },

    /**
     * Tanggal setempat (bukan UTC) dari sebuah timestamp ISO.
     * Bali ada di UTC+8: memotong 10 huruf pertama dari ISO membuat penilaian
     * pukul 00.00–08.00 WITA terhitung sebagai "kemarin", sehingga angka
     * "Total Hari Ini" di layar utama ikut salah sepanjang pagi.
     */
    /**
     * Selisih jam perangkat vs server (ms). Disimpan di localStorage supaya
     * tetap berlaku setelah aplikasi ditutup — justru saat offline-lah koreksi
     * ini paling dibutuhkan.
     */
    setSelisihJam(ms) {
      const n = Number(ms);
      if (!isFinite(n)) return;
      try { localStorage.setItem(JAM_KEY, JSON.stringify({ ms: Math.round(n), at: Date.now() })); }
      catch {}
    },
    selisihJam() {
      try {
        const raw = JSON.parse(localStorage.getItem(JAM_KEY) || 'null');
        return raw && isFinite(raw.ms) ? raw.ms : 0;
      } catch { return 0; }
    },
    /** True bila melesetnya sudah pantas diberitahukan ke staff. */
    jamMencurigakan() { return Math.abs(DB.selisihJam()) >= JAM_MENCURIGAKAN_MS; },

    /**
     * Waktu sekarang yang SUDAH dikoreksi. Dipakai untuk cap waktu penilaian,
     * pemeriksaan penilaian ganda, dan hitungan "hari ini" — semuanya harus
     * memakai jam yang sama, kalau tidak angkanya saling bertentangan.
     */
    sekarangISO() {
      const selisih = DB.selisihJam();
      const ms = Date.now() + (Math.abs(selisih) >= TOLERANSI_JAM_MS ? selisih : 0);
      return new Date(ms).toISOString();
    },

    tanggalLokal(iso) {
      const d = iso ? new Date(iso) : new Date(DB.sekarangISO());
      if (isNaN(d)) return String(iso || '').slice(0, 10);
      const p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },

    /**
     * Angka untuk layar Beranda. Membaca field cleartext saja — tidak satu pun
     * entri didekripsi, padahal fungsi ini dipanggil setiap kali layar
     * disegarkan dan setiap kali sync selesai.
     */
    async counts() {
      const today = DB.tanggalLokal();
      let total = 0, pending = 0, synced = 0, buntu = 0, hariIni = 0;
      for (const r of await DB._mentah(false)) {
        total++;
        if (r.syncState === 1) synced++;
        else if (r.buntu) buntu++;
        else pending++;
        if (DB.tanggalLokal(r.timestamp) === today) hariIni++;
      }
      return { total, pending, synced, buntu, today: hariIni };
    },

    async markSynced(evaluationId) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        const g = s.get(evaluationId);
        g.onsuccess = () => {
          const rec = g.result;
          if (!rec) return;
          rec.syncState = 1; rec.lastError = null; rec.syncedAt = new Date().toISOString();
          rec.buntu = false; rec.tolakan = 0;
          s.put(rec);
        };
        t.oncomplete = resolve; t.onerror = () => reject(t.error);
      });
    },

    /**
     * Catat kegagalan pengiriman satu entri.
     *
     * @param {string} evaluationId
     * @param {string} message alasan yang akan dibaca staff di layar Riwayat.
     * @param {{ditolak?: boolean}=} opsi `ditolak: true` HANYA bila server yang
     *   menolak (HTTP 400 atau masuk daftar `rejected`). Gagal jaringan,
     *   timeout, dan server sibuk TIDAK boleh diberi tanda ini: perangkat bisa
     *   berminggu-minggu di luar jangkauan, dan itu bukan alasan menyerah.
     *
     * Setelah MAKS_TOLAKAN penolakan, entri ditandai `buntu`: ia keluar dari
     * antrean otomatis (berhenti memutar percobaan tiap 60 detik selamanya)
     * tetapi TIDAK dibuang — datanya tetap utuh, alasannya tampil di Riwayat,
     * dan tombol "Coba lagi" mengembalikannya ke antrean.
     * @return {Promise<{buntu: boolean, tolakan: number}>}
     */
    async markFailed(evaluationId, message, opsi) {
      const ditolak = !!(opsi && opsi.ditolak);
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        const g = s.get(evaluationId);
        let hasil = { buntu: false, tolakan: 0 };
        g.onsuccess = () => {
          const rec = g.result;
          if (!rec) return;
          rec.attempts = (rec.attempts || 0) + 1;
          rec.lastError = String(message).slice(0, 200);
          if (ditolak) {
            rec.tolakan = (rec.tolakan || 0) + 1;
            if (rec.tolakan >= MAKS_TOLAKAN) rec.buntu = true;
          }
          hasil = { buntu: !!rec.buntu, tolakan: rec.tolakan || 0 };
          s.put(rec);
        };
        t.oncomplete = () => resolve(hasil);
        t.onerror = () => reject(t.error);
      });
    },

    /**
     * Kembalikan entri buntu ke antrean — dipakai tombol "Coba lagi" di layar
     * Riwayat, mis. setelah admin menambahkan guide-nya di tab Guides.
     * Penghitung penolakan di-nol-kan supaya ia mendapat kesempatan penuh lagi.
     */
    async cobaLagi(evaluationId) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        const g = s.get(evaluationId);
        let ada = false;
        g.onsuccess = () => {
          const rec = g.result;
          if (!rec) return;
          ada = true;
          rec.buntu = false;
          rec.tolakan = 0;
          rec.lastError = null;
          s.put(rec);
        };
        t.oncomplete = () => resolve(ada);
        t.onerror = () => reject(t.error);
      });
    },

    /**
     * Timpa isi satu penilaian yang BELUM pernah terkirim.
     *
     * Dipakai untuk membetulkan salah pencet yang ketahuan sebelum entrinya
     * sampai ke server: tidak perlu jejak koreksi di spreadsheet, karena
     * angka yang salah memang belum pernah ada di sana. evaluationId sengaja
     * dipertahankan — tidak ada yang bisa bingung soal idempotensi terhadap
     * sesuatu yang belum pernah dikirim.
     */
    async gantiIsi(evaluationId, isiBaru) {
      const db = await openDB();
      const lama = await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const g = t.objectStore(STORE).get(evaluationId);
        g.onsuccess = () => resolve(g.result || null);
        t.onerror = () => reject(t.error);
      });
      if (!lama) return false;
      if (lama.syncState === 1) throw new Error('penilaian ini sudah terkirim');

      const packed = await encryptObject({ ...isiBaru, evaluationId });
      const record = {
        ...lama,
        timestamp: isiBaru.timestamp,
        pos: isiBaru.pos,
        syncState: 0, attempts: 0, tolakan: 0, buntu: false, lastError: null,
        ...packed,
      };
      await tx('readwrite', s => wrap(s.put(record)));
      DB.scheduleBackup();
      return true;
    },

    /**
     * Tandai penilaian lama sebagai sudah dibetulkan oleh penilaian baru.
     * Entrinya TIDAK dihapus — riwayat tetap menunjukkan apa yang sempat
     * tercatat, sama seperti baris 'diganti' di tab Evaluations.
     */
    async tandaiDiganti(idLama, idBaru) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        const g = s.get(idLama);
        let ada = false;
        g.onsuccess = () => {
          const rec = g.result;
          if (!rec) return;
          ada = true;
          rec.diganti = true;
          rec.digantikanOleh = String(idBaru);
          s.put(rec);
        };
        t.oncomplete = () => resolve(ada);
        t.onerror = () => reject(t.error);
      });
    },

    /**
     * Batalkan tanda "sudah dibetulkan" pada penilaian lama.
     *
     * Dipakai bila penilaian PENGGANTI-nya ternyata ditolak server secara
     * permanen. Tanpa ini, perangkat menganggap yang lama sudah tidak berlaku
     * sementara di spreadsheet ia masih aktif — rekap CSV perangkat lalu
     * berbeda dengan tab Rekap, dan justru cross-check itulah gunanya.
     */
    async batalkanDiganti(idLama) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        const g = s.get(idLama);
        let ada = false;
        g.onsuccess = () => {
          const rec = g.result;
          if (!rec || !rec.diganti) return;
          ada = true;
          rec.diganti = false;
          rec.digantikanOleh = null;
          s.put(rec);
        };
        t.oncomplete = () => resolve(ada);
        t.onerror = () => reject(t.error);
      });
    },

    /** Kembalikan SEMUA entri buntu ke antrean sekaligus. */
    async cobaLagiSemua() {
      const daftar = await DB.daftarBuntu();
      for (const e of daftar) await DB.cobaLagi(e.evaluationId);
      return daftar.length;
    },

    async clearSynced() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const s = t.objectStore(STORE);
        let n = 0;
        const cur = s.index('syncState').openCursor(IDBKeyRange.only(1));
        cur.onsuccess = e => {
          const c = e.target.result;
          if (c) { c.delete(); n++; c.continue(); }
        };
        // Cadangan HARUS ikut diperbarui di sini. Kalau tidak, penghapusan bisa
        // membatalkan dirinya sendiri: store menjadi kosong sementara cadangan
        // masih memuat seluruh data, lalu restoreIfEmpty() memulihkannya saat
        // aplikasi dibuka lagi. `beforeunload` tidak bisa diandalkan di ponsel.
        t.oncomplete = () => { DB.backupNow().then(() => resolve(n), () => resolve(n)); };
        t.onerror = () => reject(t.error);
      });
    },

    /* ---- Tautan pos (token dari pengelola kunjungan) ----
       Satu tautan per pos. Menyimpan tautan baru untuk pos yang sama
       menggantikan yang lama dan menghapus tanda "dicabut", sehingga antrean
       pos itu langsung berlanjut (ATR-FL-07). */
    async bacaTautan() {
      try {
        const rec = await tx('readonly', s => wrap(s.get(TAUTAN_KEY)), META);
        return rec && Array.isArray(rec.v) ? rec.v : [];
      } catch { return []; }
    },
    async simpanTautan(link) {
      const daftar = (await DB.bacaTautan()).filter(l => l.pos !== link.pos);
      daftar.push({ token: link.token, pos: link.pos, label: link.label, disimpan: new Date().toISOString(), dicabut: false });
      daftar.sort((a, b) => a.pos - b.pos);
      await tx('readwrite', s => wrap(s.put({ k: TAUTAN_KEY, v: daftar })), META);
      return daftar;
    },
    async tandaiTautanDicabut(token) {
      const daftar = await DB.bacaTautan();
      let ada = false;
      for (const l of daftar) if (l.token === token && !l.dicabut) { l.dicabut = true; ada = true; }
      if (ada) await tx('readwrite', s => wrap(s.put({ k: TAUTAN_KEY, v: daftar })), META);
      return ada;
    },
    async hapusTautan(pos) {
      const daftar = (await DB.bacaTautan()).filter(l => l.pos !== Number(pos));
      await tx('readwrite', s => wrap(s.put({ k: TAUTAN_KEY, v: daftar })), META);
      return daftar;
    },

    /** Hapus entri terkirim yang lebih tua dari SIMPAN_TERKIRIM_HARI. */
    async pangkasTerkirim() {
      const batas = new Date(Date.now() - SIMPAN_TERKIRIM_HARI * 86400000).toISOString();
      const db = await openDB();
      const n = await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        let hapus = 0;
        const cur = t.objectStore(STORE).index('syncState').openCursor(IDBKeyRange.only(1));
        cur.onsuccess = e => {
          const c = e.target.result;
          if (!c) return;
          if (String(c.value.timestamp) < batas) { c.delete(); hapus++; }
          c.continue();
        };
        t.oncomplete = () => resolve(hapus);
        t.onerror = () => reject(t.error);
      });
      if (n) await DB.backupNow();
      return n;
    },

    /* ---- Cache daftar guide (dari tautan pos, tidak ada salinan bawaan) ---- */
    async setGuides(list) {
      localStorage.setItem(GUIDES_KEY, JSON.stringify({ at: Date.now(), list }));
    },
    getGuides() {
      try {
        const raw = JSON.parse(localStorage.getItem(GUIDES_KEY) || 'null');
        return raw && Array.isArray(raw.list) ? raw : null;
      } catch { return null; }
    },
    setPenilaian(konteks) {
      try { localStorage.setItem(PENILAIAN_KEY, JSON.stringify({ at: Date.now(), konteks })); } catch {}
    },
    getPenilaian() {
      try {
        const raw = JSON.parse(localStorage.getItem(PENILAIAN_KEY) || 'null');
        return raw && raw.konteks && Array.isArray(raw.konteks.teguran) ? raw.konteks : null;
      } catch { return null; }
    },

    /* ---- Backup ke localStorage (§10) ---- */
    _backupTimer: null,
    scheduleBackup() {
      if (DB._backupTimer) return;
      DB._backupTimer = setTimeout(() => { DB._backupTimer = null; DB.backupNow(); }, 3000);
    },
    /**
     * Cadangkan isi IndexedDB ke localStorage.
     *
     * Dulu ini menyalin SELURUH record apa adanya di dalam satu try/catch tanpa
     * pesan apa pun. localStorage hanya ±5 MB sementara IndexedDB boleh 10 MB
     * dan base64 membengkakkan isi ±1,4x, jadi begitu data menumpuk cadangan
     * berhenti diperbarui tanpa ada yang tahu — dan cadangan basi itulah yang
     * dipakai restoreIfEmpty() kalau IndexedDB rusak.
     *
     * Sekarang: entri yang BELUM terkirim selalu diprioritaskan (salinannya
     * tidak ada di mana pun selain di perangkat ini), entri yang sudah terkirim
     * diikutkan sebanyak yang masih muat dari yang terbaru, dan hasilnya
     * dilaporkan ke layar Pengaturan lewat statusCadangan().
     */
    async backupNow() {
      let semua = [];
      try {
        semua = (await tx('readonly', s => wrap(s.getAll()))) || [];
      } catch (e) {
        DB._catatStatusCadangan({ gagal: true, pesan: 'Data lokal tidak terbaca: ' + e.message });
        return false;
      }

      const belum = semua.filter(r => r.syncState !== 1);
      const sudah = semua.filter(r => r.syncState === 1)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

      // Susun dari yang wajib ikut, lalu tambahkan yang sudah terkirim selama
      // masih di bawah batas. Ukuran dihitung per record SEKALI (linear): dulu
      // seluruh larik di-stringify ulang tiap penambahan, sehingga 2.000 entri
      // membekukan layar lebih dari 10 detik (NG-S2).
      const ukuran = r => (JSON.stringify(r).length + 1) * 2;
      const records = belum.slice();
      let terpakai = 64 + records.reduce((n, r) => n + ukuran(r), 0);
      for (const r of sudah) {
        const u = ukuran(r);
        if (terpakai + u > BACKUP_MAKS_BYTES) break;
        records.push(r); terpakai += u;
      }

      // Percobaan berjenjang: lengkap → hanya yang belum terkirim → menyerah.
      const percobaan = [records];
      if (records.length !== belum.length) percobaan.push(belum);
      for (let i = 0; i < percobaan.length; i++) {
        const isi = percobaan[i];
        try {
          localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), records: isi }));
          DB._catatStatusCadangan({
            gagal: false,
            disimpan: isi.length,
            total: semua.length,
            belum: belum.length,
            sebagian: isi.length < semua.length,
          });
          return true;
        } catch (e) {
          console.warn('[db] cadangan tidak muat, memangkas', isi.length, e);
        }
      }

      DB._catatStatusCadangan({
        gagal: true,
        total: semua.length,
        belum: belum.length,
        pesan: belum.length
          ? `Penyimpanan penuh — ${belum.length} penilaian yang belum terkirim tidak bisa dicadangkan. Segera tekan "Kirim Sekarang", lalu "Hapus Data Terkirim".`
          : 'Penyimpanan penuh — tekan "Hapus Data Terkirim" di layar ini.',
      });
      return false;
    },

    _catatStatusCadangan(info) {
      try {
        localStorage.setItem(STATUS_BACKUP_KEY, JSON.stringify({ at: Date.now(), ...info }));
      } catch { /* kalau ini pun gagal, memang tidak ada ruang tersisa */ }
    },

    /** Keadaan cadangan terakhir — dibaca layar Pengaturan. */
    statusCadangan() {
      try {
        const raw = JSON.parse(localStorage.getItem(STATUS_BACKUP_KEY) || 'null');
        return raw && typeof raw === 'object' ? raw : null;
      } catch { return null; }
    },
    /** Pulihkan dari backup bila object store kosong tapi backup ada. */
    async restoreIfEmpty() {
      try {
        const existing = await tx('readonly', s => wrap(s.count()));
        if (existing > 0) return 0;
        const raw = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
        if (!raw || !raw.records || !raw.records.length) return 0;
        await tx('readwrite', s => { raw.records.forEach(r => s.put(r)); });
        return raw.records.length;
      } catch { return 0; }
    },

    /** Estimasi pemakaian penyimpanan. */
    async storageInfo() {
      let used = 0, quota = STORAGE_LIMIT_BYTES;
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const est = await navigator.storage.estimate();
          used = est.usage || 0;
          quota = Math.min(est.quota || STORAGE_LIMIT_BYTES, STORAGE_LIMIT_BYTES);
        } else {
          used = (localStorage.getItem(BACKUP_KEY) || '').length * 2;
        }
      } catch {}
      return { used, quota, ratio: quota ? Math.min(used / quota, 1) : 0 };
    },

    /* ---- Draft formulir (§5: jangan lebih longgar dari datanya) ----
       Draft memuat nama guide dan nilai yang sedang diisi — isi yang sama
       dengan penilaiannya. Dulu ia ditulis polos ke localStorage sementara
       penilaiannya dienkripsi, jadi perlindungannya bocor lewat pintu samping.
       Sekarang dibungkus kunci yang sama. Penulisannya ditunda sejenak karena
       saveDraft() dipanggil pada setiap ketikan. */
    _draftTimer: null,
    _draftTerakhir: null,

    simpanDraft(obj) {
      DB._draftTerakhir = obj;
      if (DB._draftTimer) return;
      DB._draftTimer = setTimeout(() => {
        DB._draftTimer = null;
        DB.simpanDraftSegera(DB._draftTerakhir);
      }, 400);
    },

    async simpanDraftSegera(obj) {
      if (!obj) return;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(await encryptObject(obj)));
      } catch (e) { console.warn('[db] draft gagal disimpan', e); }
    },

    async bacaDraft() {
      let raw;
      try { raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); }
      catch { return null; }
      if (!raw || typeof raw !== 'object') return null;

      // Draft polos dari versi sebelumnya: dibaca sekali lalu langsung ditulis
      // ulang dalam bentuk terenkripsi, jadi tidak ada yang hilang saat
      // aplikasi diperbarui.
      if (raw.enc === undefined) {
        DB.simpanDraftSegera(raw);
        return raw;
      }
      try { return await decryptObject(raw); }
      catch (e) { console.warn('[db] draft tidak terbaca', e); return null; }
    },

    hapusDraft() {
      clearTimeout(DB._draftTimer);
      DB._draftTimer = null;
      DB._draftTerakhir = null;
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
    },

    async exportJson() {
      return JSON.stringify({ exportedAt: new Date().toISOString(), evaluations: await DB.all() }, null, 2);
    },
  };

  // Backup berkala tiap 5 menit
  setInterval(() => DB.backupNow(), BACKUP_INTERVAL_MS);

  global.DB = DB;
})(window);
