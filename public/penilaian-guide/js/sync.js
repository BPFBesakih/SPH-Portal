/* =========================================================
   sync.js — Sinkronisasi offline → SPH-Portal
   1. Deteksi jaringan  2. Antrean per pos  3. Coba ulang dengan jeda bertambah
   4. Append-only (tanpa konflik)

   Satu-satunya tujuan kirim: POST /api/guide-form/{context,submit} di origin
   yang sama. Pos penilaian ditentukan TAUTAN POS (token di fragmen URL), bukan
   pilihan petugas. Satu HP boleh menyimpan tautan Pos 1 dan Pos 3 sekaligus;
   setiap penilaian dikirim dengan token pos-nya sendiri.
   ========================================================= */
(function (global) {
  'use strict';

  const SETTINGS_KEY = 'bpb.pg.settings';
  const MAX_ATTEMPTS = 6;
  const BASE_DELAY = 2000;      // 2s, 4s, 8s, 16s, 32s, 64s
  const MAX_DELAY = 5 * 60_000;
  const AUTO_INTERVAL = 60_000; // cek berkala tiap 1 menit
  const BATCH = 20;             // batas kiriman portal per permintaan
  const TIMEOUT_MS = 35_000;    // di atas batas Pages→Edge (32 detik)
  const GUIDE_REFRESH_MS = 10 * 60_000;

  const listeners = new Set();
  let running = false;
  let retryTimer = null;
  let backoffStep = 0;

  const defaults = {
    forceOffline: false, encrypt: true, haptic: true, pos: null,
    filterKategori: '', filterRegu: '',
  };

  const Settings = {
    get() {
      try { return { ...defaults, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }; }
      catch { return { ...defaults }; }
    },
    set(patch) {
      const next = { ...Settings.get(), ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    },
  };

  function emit(state, detail) {
    listeners.forEach(fn => { try { fn(state, detail || {}); } catch (e) { console.warn(e); } });
  }

  function isOnline() {
    return navigator.onLine !== false && !Settings.get().forceOffline;
  }

  /** Ambil token 64 huruf heksadesimal dari tautan pos atau dari fragmen saja. */
  function tokenDari(teks) {
    const s = String(teks || '').trim();
    const m = s.match(/#([a-f0-9]{64})(?:$|[&?])/i) || s.match(/^([a-f0-9]{64})$/i);
    return m ? m[1].toLowerCase() : null;
  }

  async function post(action, body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`/api/guide-form/${action}`, {
        method: 'POST', cache: 'no-store', credentials: 'omit', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    } finally { clearTimeout(t); }
  }

  /**
   * Catat seberapa meleset jam perangkat dari jam server.
   * serverTime diambil di tengah-tengah permintaan, jadi patokannya titik
   * tengah antara sebelum dan sesudah.
   */
  function catatWaktuServer(body, t0, t1) {
    if (!body || !body.serverTime) return;
    const server = Date.parse(body.serverTime);
    if (!isFinite(server)) return;
    DB.setSelisihJam(server - (t0 + t1) / 2);
  }

  const galat = (status, data) => (data && data.error) || `HTTP ${status}`;

  /**
   * Periksa satu token ke portal dan simpan tautannya. Dipakai saat tautan pos
   * pertama kali dibuka, saat ditempel, dan untuk memperbarui daftar guide.
   * @return {Promise<{pos:number,label:string,guides:Array}>}
   */
  async function bukaTautan(token) {
    const t0 = Date.now();
    const { status, data } = await post('context', { token });
    if (status === 404) {
      await DB.tandaiTautanDicabut(token);
      const e = new Error(galat(status, data)); e.dicabut = true; throw e;
    }
    if (status !== 200 || !data || !Array.isArray(data.guides)) {
      const e = new Error(galat(status, data)); e.status = status; throw e;
    }
    catatWaktuServer(data, t0, Date.now());
    await DB.simpanTautan({ token, pos: Number(data.pos), label: String(data.label || `Pos ${data.pos}`) });
    if (data.guides.length) await DB.setGuides(data.guides);
    if (!Settings.get().pos) Settings.set({ pos: Number(data.pos) });
    emit('tautan', { pos: Number(data.pos) });
    return data;
  }

  /**
   * Perbarui daftar guide dari tautan yang masih aktif, paling sering sekali
   * per 10 menit kecuali dipaksa. Aman dipanggil offline: daftar tersimpan dipakai.
   */
  async function refreshGuides(opts = {}) {
    const cached = DB.getGuides();
    const tautan = (await DB.bacaTautan()).filter(l => !l.dicabut);
    if (!tautan.length) return cached ? cached.list : [];
    if (!opts.force && cached && Date.now() - cached.at < GUIDE_REFRESH_MS) return cached.list;
    if (!isOnline()) return cached ? cached.list : [];
    const utama = tautan.find(l => l.pos === Number(Settings.get().pos)) || tautan[0];
    try {
      const data = await bukaTautan(utama.token);
      return data.guides;
    } catch (e) {
      if (cached && !e.dicabut) return cached.list;
      throw e;
    }
  }

  /** Tes koneksi: periksa semua tautan tersimpan sekaligus memperbarui daftar guide. */
  async function ping() {
    const tautan = await DB.bacaTautan();
    if (!tautan.length) throw new Error('Belum ada tautan pos di HP ini');
    let hasil = null;
    for (const l of tautan) {
      try { const d = await bukaTautan(l.token); hasil = hasil || d; }
      catch (e) { if (!e.dicabut) throw e; }
    }
    if (!hasil) throw new Error('Semua tautan pos di HP ini sudah tidak aktif');
    return hasil;
  }

  const payloadDari = item => {
    const p = {
      evaluationId: item.evaluationId,
      guideId: item.guideId,
      guideName: item.guideName,
      pos: Number(item.pos),
      timestamp: item.timestamp,
      criteria: {
        idCard: !!item.criteria.idCard,
        uniform: App.nilaiUniform(item.criteria.uniform),
        etika: Math.min(5, Math.max(-5, Math.round(Number(item.criteria.etika) || 0))),
      },
      catatan: String(item.catatan || '').slice(0, 500),
    };
    // Hanya disertakan bila entri ini memang koreksi.
    if (item.koreksiDari) p.koreksiDari = String(item.koreksiDari);
    return p;
  };

  /**
   * Kirim semua entri pending, dikelompokkan per pos, paling banyak 20 per
   * permintaan (append-only, idempoten berdasarkan evaluationId).
   */
  async function syncNow(opts = {}) {
    if (running) return { skipped: 'sedang berjalan' };
    if (!opts.force && !isOnline()) { emit('offline'); return { skipped: 'offline' }; }
    running = true;
    // try/finally: penanda `running` selalu dilepas walau IndexedDB melempar galat (NG-R3).
    try { return await kirimAntrean(); }
    finally { running = false; }
  }

  async function kirimAntrean() {
    const queue = await DB.pending();
    if (!queue.length) { emit('idle', { pending: 0 }); return { sent: 0, failed: 0 }; }
    emit('syncing', { pending: queue.length });

    const tautan = await DB.bacaTautan();
    const perPos = new Map();
    for (const item of queue) {
      const pos = Number(item.pos);
      if (!perPos.has(pos)) perPos.set(pos, []);
      perPos.get(pos).push(item);
    }

    // Backoff hanya mengikuti masalah JARINGAN. Penolakan server bukan alasan
    // memperlambat: entri yang ditolak berhenti sendiri setelah DB.MAKS_TOLAKAN kali.
    let sent = 0, failed = 0, ditolakJml = 0, ditahanJml = 0, gagalJaringan = 0;
    let lastError = null, alasanTerakhir = null;
    const tanpaTautan = [];

    for (const [pos, items] of perPos) {
      const link = tautan.find(l => l.pos === pos && !l.dicabut);
      // Tautan pos sudah diganti/dicabut: antreannya MENUNGGU tautan baru, tidak
      // dihitung sebagai penolakan (ATR-FL-07).
      if (!link) { tanpaTautan.push(pos); continue; }
      let putus = false;
      for (let i = 0; i < items.length && !putus; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const t0 = Date.now();
        let res;
        try {
          res = await post('submit', { token: link.token, evaluations: batch.map(payloadDari) });
        } catch (err) {
          lastError = err.name === 'AbortError' ? 'Waktu habis menunggu server' : (err.message || String(err));
          for (const it of batch) await DB.markFailed(it.evaluationId, lastError);
          gagalJaringan++; failed += batch.length; putus = true; break;
        }
        const { status, data } = res;
        catatWaktuServer(data, t0, Date.now());

        if (status === 404) {
          await DB.tandaiTautanDicabut(link.token);
          tanpaTautan.push(pos); putus = true; break;
        }
        if (status === 429 || status >= 500 || status === 403 || status === 0) {
          // Sibuk / batas frekuensi / jalur belum siap: coba lagi nanti.
          lastError = galat(status, data);
          for (const it of batch) await DB.markFailed(it.evaluationId, lastError);
          gagalJaringan++; failed += batch.length; putus = true; break;
        }
        if (status !== 200) {
          // Kiriman utuh ditolak (bentuknya salah): hitung sebagai penolakan tiap entri.
          const alasan = galat(status, data);
          for (const it of batch) {
            const tanda = await DB.markFailed(it.evaluationId, alasan, { ditolak: true });
            ditolakJml++; failed++; alasanTerakhir = alasan;
            if (tanda && tanda.buntu) { await tahan(it); ditahanJml++; }
          }
          continue;
        }

        const diterima = new Set((data && Array.isArray(data.accepted) ? data.accepted : [])
          .filter(a => a && a.evaluationId).map(a => a.evaluationId));
        const ditolakPeta = new Map((data && Array.isArray(data.rejected) ? data.rejected : [])
          .filter(r => r && r.evaluationId).map(r => [r.evaluationId, r]));
        for (const it of batch) {
          // ✅ hanya bila evaluationId ini benar-benar ada di `accepted` (ATR-NL-09).
          if (diterima.has(it.evaluationId)) {
            await DB.markSynced(it.evaluationId); sent++;
            continue;
          }
          const r = ditolakPeta.get(it.evaluationId);
          if (r) {
            const alasan = Array.isArray(r.errors) && r.errors.length ? r.errors.join('; ') : 'Ditolak server';
            const tanda = await DB.markFailed(it.evaluationId, alasan, { ditolak: true });
            ditolakJml++; failed++; alasanTerakhir = alasan;
            if (tanda && tanda.buntu) { await tahan(it); ditahanJml++; }
            continue;
          }
          // Tidak disebut sama sekali: anggap belum pasti, kirim ulang nanti.
          await DB.markFailed(it.evaluationId, 'Server tidak mengonfirmasi penyimpanan');
          failed++; lastError = 'Server tidak mengonfirmasi penyimpanan';
        }
        emit('progress', { sent, total: queue.length });
      }
      if (putus && gagalJaringan) break;
    }

    if (tanpaTautan.length) emit('tautanDicabut', { pos: [...new Set(tanpaTautan)] });
    if (gagalJaringan > 0) {
      backoffStep = Math.min(backoffStep + 1, MAX_ATTEMPTS);
      scheduleRetry();
      emit('error', { sent, failed, ditolak: ditolakJml, ditahan: ditahanJml, message: lastError });
    } else if (ditolakJml > 0) {
      backoffStep = 0;
      emit('ditolak', { sent, failed, ditolak: ditolakJml, ditahan: ditahanJml, message: alasanTerakhir });
    } else {
      backoffStep = 0;
      emit('done', { sent });
    }
    return { sent, failed, ditolak: ditolakJml, ditahan: ditahanJml, lastError: lastError || alasanTerakhir };
  }

  // Koreksi yang ditolak permanen: penilaian lamanya kembali berlaku di HP,
  // supaya isi HP dan spreadsheet tidak berbeda.
  async function tahan(item) {
    if (!item.koreksiDari) return;
    try { await DB.batalkanDiganti(item.koreksiDari); }
    catch (e) { console.warn('[sync] gagal membatalkan tanda diganti', e); }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    const delay = Math.min(BASE_DELAY * Math.pow(2, backoffStep - 1), MAX_DELAY);
    retryTimer = setTimeout(() => { if (isOnline()) syncNow(); }, delay);
  }

  /* ------------------ Pemicu otomatis ------------------ */
  function start() {
    global.addEventListener('online', () => { backoffStep = 0; emit('online'); setTimeout(() => syncNow(), 800); });
    global.addEventListener('offline', () => emit('offline'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && isOnline()) syncNow(); });
    setInterval(() => { if (isOnline()) syncNow(); }, AUTO_INTERVAL);
    if (isOnline()) setTimeout(() => syncNow(), 1500);
  }

  global.Sync = {
    Settings, tokenDari, bukaTautan, isOnline, syncNow, refreshGuides, ping, start,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get isRunning() { return running; },
  };
})(window);
