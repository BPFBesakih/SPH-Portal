/* =========================================================
   Riwayat & koreksi salah pencet
   Berkas 5 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Daftar riwayat, penyaringan, mulai/batal koreksi, kirim ulang yang
              ditahan.
   LARANGAN : Penilaian tidak pernah dihapus — koreksi selalu berupa entri
              pengganti.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { $, fmtTime, esc, jamLokal, nilaiUniform, labelUniform, caraBaru, ringkasKriteria, SERAGAM_LABEL, kritKosong } = App;

  /**
   * Tiga keadaan, bukan dua:
   *   ⏳ menunggu  — masih di antrean, akan dikirim sendiri
   *   ✅ terkirim  — server sudah mengonfirmasi
   *   🚫 ditahan   — ditolak server DB.MAKS_TOLAKAN kali, berhenti dicoba
   *                  otomatis. Datanya utuh; tombol "Coba lagi" mengembalikan
   *                  entri ini ke antrean (mis. setelah admin menambahkan
   *                  guide-nya di tab Guides).
   */
  const cocokFilterRiwayat = (e) => {
    if (App.state.historyFilter === 'all') return true;
    if (App.state.historyFilter === 'ditahan') return !!e.buntu;
    if (App.state.historyFilter === 'pending') return !e.synced && !e.buntu;
    return !!e.synced;
  };

  App.renderHistory = async function renderHistory() {
    // Hanya entri terbaru yang didekripsi dan digambar (ATR-FL-12).
    const { items: list, total, jmlDitahan } = await DB.halaman(App.state.riwayatBatas, cocokFilterRiwayat);
    const box = $('#historyList');
    const lagi = $('#btnMoreHistory');
    if (lagi) {
      lagi.hidden = total <= list.length;
      $('#historyMoreHint').textContent = `Menampilkan ${list.length} dari ${total}`;
    }

    // Spanduk "ada yang ditahan" ditampilkan pada filter mana pun — kalau
    // hanya muncul di filternya sendiri, staff tidak akan pernah tahu ia ada.
    const bar = $('#ditahanBar');
    if (bar) {
      bar.hidden = jmlDitahan === 0;
      if (jmlDitahan) {
        bar.innerHTML =
          `<strong>🚫 ${jmlDitahan} penilaian ditahan</strong>` +
          `<p>Server menolaknya ${DB.MAKS_TOLAKAN}&times; berturut-turut, jadi pengiriman otomatis dihentikan. ` +
          `Datanya tidak hilang. Setelah penyebabnya dibereskan (mis. guide-nya ditambahkan di tab Guides), ` +
          `tekan tombol di bawah.</p>` +
          `<button type="button" class="chip retrybtn" data-retry="semua">🔄 Coba kirim lagi semua</button>`;
      }
    }

    if (!list.length) {
      box.innerHTML = `<div class="empty"><span class="big">🗂️</span>Belum ada data pada filter ini.</div>`;
      return;
    }
    box.innerHTML = list.map(e => {
      const c = e.criteria || {};
      const b = (label, val) => `<span class="badge ${val ? '' : 'bad'}">${label} ${val ? '✓' : '✕'}</span>`;
      // Entri rusak TIDAK boleh digambar sebagai "ID ✕ Uniform ✕ Etika 0":
      // nilainya tidak diketahui, bukan nol — menampilkannya sebagai nol sama
      // saja menuduh guide yang bersangkutan tidak patuh.
      const nilai = e.corrupt
        ? '<span class="badge bad">nilai tidak terbaca di perangkat ini</span>'
        : caraBaru(c)
          ? `${b('ID', !!c.idCard)}` +
            `<span class="badge ${c.seragam === 'lengkap' ? '' : 'bad'}">Seragam ${esc(SERAGAM_LABEL[c.seragam] || c.seragam)}</span>` +
            (c.teguran || []).map(k => `<span class="badge bad">Teguran: ${esc(App.labelTemuan('teguran', k))}</span>`).join('') +
            (c.berat ? `<span class="badge bad">⚠️ Berat: ${esc(App.labelTemuan('berat', c.berat))} (diverifikasi pengelola)</span>` : '') +
            (c.apresiasi ? `<span class="badge">⭐ ${esc(App.labelTemuan('apresiasi', c.apresiasi))}</span>` : '')
          : `${b('ID', !!c.idCard)}` +
            `<span class="badge ${nilaiUniform(c.uniform) >= 1 ? '' : 'bad'}">Uniform ${esc(labelUniform(c.uniform))}</span>` +
            `<span class="badge">Etika ${App.nilaiEtika(c.etika)}</span>`;
      const keterangan = e.corrupt
        ? `<span class="cmeta">Sudah tersimpan di portal, kode ${esc(String(e.evaluationId).slice(0, 8))}</span>`
        : '';
      const ikon = e.diganti ? '✏️' : e.buntu ? '🚫' : e.corrupt ? '⚠️' : e.synced ? '✅' : '⏳';
      const status = e.diganti ? 'Sudah dibetulkan — angka ini tidak dipakai'
        : e.synced ? 'Terkirim'
        : e.buntu ? 'Ditahan — tidak dikirim otomatis'
        : 'Menunggu sync';
      // Entri yang ditahan butuh tombol kirim ulang; entri hari ini yang masih
      // berlaku butuh tombol perbaiki. Entri yang sudah diganti tidak butuh
      // apa-apa — ia hanya jejak.
      const tombol = e.buntu
        ? `<button type="button" class="chip retrybtn" data-retry="${esc(e.evaluationId)}">🔄 Coba lagi</button>`
        : bolehDikoreksi(e)
          ? `<button type="button" class="chip retrybtn" data-fix="${esc(e.evaluationId)}">✏️ Perbaiki</button>`
          : '';
      return `<div class="card${e.buntu ? ' ditahan' : ''}${e.diganti ? ' diganti' : ''}">
        <span class="cstat">${ikon}</span>
        <span class="cbody">
          <span class="cname">${esc(e.guideName)}</span>
          <span class="cmeta">${esc(App.labelPos(e.pos))} · ${esc(fmtTime(e.timestamp))} · ${status}${e.petugasNama ? ` · 👤 ${esc(e.petugasNama)}` : ''}</span>
          <span class="badges">${nilai}</span>
          ${keterangan}
          ${e.catatan ? `<span class="cmeta">📝 ${esc(e.catatan)}</span>` : ''}
          ${e.lastError && !e.synced ? `<span class="cmeta">⚠️ ${esc(e.lastError)}</span>` : ''}
          ${tombol}
        </span>
      </div>`;
    }).join('');
  }

  /**
   * Hanya penilaian HARI INI yang boleh dibetulkan dari aplikasi.
   * Kunci "satu pos sekali sehari" di server memakai tanggal, jadi koreksi
   * untuk hari lain pasti ditolak — dan rekap hari-hari sebelumnya biasanya
   * sudah dilaporkan. Untuk hari yang sudah lewat, lewat pengelola kunjungan di portal.
   */
  const bolehDikoreksi = (e) =>
    !e.corrupt && !e.diganti && DB.tanggalLokal(e.timestamp) === DB.tanggalLokal();

  App.mulaiKoreksi = async function mulaiKoreksi(id) {
    const asal = await DB.get(id);
    if (!asal) { App.toast('Penilaian tidak ditemukan', 'err', '❌'); return; }
    if (!bolehDikoreksi(asal)) {
      App.toast('Hanya penilaian hari ini yang bisa dibetulkan dari aplikasi', 'warn', '⚠️');
      return;
    }
    const g = App.state.guides.find(x => x.guideId === asal.guideId);
    if (!g) { App.toast('Guide tidak ada di daftar perangkat ini', 'warn', '⚠️'); return; }

    App.state.koreksi = asal;
    const c = asal.criteria || {};
    // Penilaian cara lama dibuka dengan pemetaannya: Uniform −1 = tidak berseragam,
    // selain itu lengkap. Teguran dari Etika lama tidak bisa ditebak jenisnya.
    const crit = caraBaru(c)
      ? { ...kritKosong(), idCard: !!c.idCard, seragam: c.seragam, teguran: [...(c.teguran || [])], berat: c.berat || '', apresiasi: c.apresiasi || '' }
      : { ...kritKosong(), idCard: !!c.idCard, seragam: nilaiUniform(c.uniform) >= 1 ? 'lengkap' : 'tidak' };
    App.state.form = { pos: Number(asal.pos), guide: g, crit, catatan: asal.catatan || '', lanjutJeda: null };
    App.tampilkanPos();
    $('#guideInput').value = g.guideName;
    $('#catatan').value = App.state.form.catatan;
    App.renderPenilaianForm();
    App.showPicked(g);
    App.tampilkanKandidat(null);
    App.tampilkanBarKoreksi();
    App.go('nilai');
  }

  App.tampilkanBarKoreksi = function tampilkanBarKoreksi() {
    const bar = $('#koreksiBar');
    if (!bar) return;
    // Guide & pos dikunci: server hanya menerima koreksi untuk guide, pos, dan
    // tanggal yang SAMA. Kalau dibiarkan bisa diubah, staff akan menyusun
    // kiriman yang sudah pasti ditolak.
    ['#homePos', '#guideInput', '#filterKategori', '#filterRegu'].forEach(sel => {
      const el = $(sel);
      if (el) el.toggleAttribute('disabled', !!App.state.koreksi);
    });
    if (!App.state.koreksi) { bar.hidden = true; bar.innerHTML = ''; return; }
    const c = App.state.koreksi.criteria || {};
    bar.hidden = false;
    bar.innerHTML =
      `<strong>✏️ Membetulkan penilaian ${esc(App.state.koreksi.guideName)}</strong>` +
      `<p>Tercatat pukul ${esc(jamLokal(App.state.koreksi.timestamp))} di Pos ${esc(App.state.koreksi.pos)}: ` +
      `${esc(ringkasKriteria(c))}. ` +
      `Ubah nilainya lalu tekan SIMPAN. Guide dan pos tidak bisa diganti — ` +
      `${App.state.koreksi.synced ? 'penilaian lama akan ditandai "diganti" di portal, tidak dihapus'
                        : 'penilaian ini belum terkirim, jadi cukup ditimpa di perangkat'}.</p>` +
      `<button type="button" class="chip retrybtn" data-batal-koreksi="1">✖ Batalkan koreksi</button>`;
  }

  App.batalKoreksi = function batalKoreksi(diam) {
    App.state.koreksi = null;
    App.tampilkanBarKoreksi();
    App.resetForm(true);
    if (!diam) App.toast('Koreksi dibatalkan', 'ok', '✖');
  }

  /** Kembalikan entri yang ditahan ke antrean, lalu langsung coba kirim. */
  App.cobaKirimLagi = async function cobaKirimLagi(id) {
    let n = 0;
    try {
      n = id === 'semua' ? await DB.cobaLagiSemua() : (await DB.cobaLagi(id) ? 1 : 0);
    } catch (err) {
      App.toast('Gagal mengembalikan ke antrean: ' + err.message, 'err', '❌');
      return;
    }
    if (!n) { App.toast('Tidak ada yang perlu dikirim ulang', 'warn', 'ℹ️'); return; }
    App.toast(`${n} penilaian dikembalikan ke antrean`, 'ok', '🔄');
    await App.refreshStats();
    await App.renderHistory();
    if (Sync.isOnline()) Sync.syncNow({ force: true });
  }
})();
