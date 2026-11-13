/* =========================================================
   Export CSV rekap perangkat
   Berkas 6 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Rangkum penilaian yang tersimpan di perangkat ini lalu susun CSV.
   LARANGAN : Hanya membaca data lokal — bukan pengganti rekap di spreadsheet.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { jamLokal, nilaiUniform, caraBaru, temuanDari, SERAGAM_LABEL } = App;

  /**
   * Rangkuman penilaian yang tersimpan di PERANGKAT INI, untuk dicocokkan dengan
   * Dashboard Kunjungan di portal. Tiap penilaian = satu PENGANTARAN. Yang dihitung
   * adalah TEMUAN (tanpa ID, seragam kurang lengkap, tidak berseragam, teguran),
   * dengan pemetaan yang sama seperti portal untuk penilaian cara lama. Nilai
   * pengantaran (100 − potongan) tidak dihitung di HP: bobotnya ditetapkan portal.
   */
  App.rangkumPerangkat = function rangkumPerangkat(list) {
    const harian = new Map(), perPos = new Map(), perTgl = new Map();
    const tambah = (t, f) => { t.antar++; t.tanpaId += f.tanpaId; t.kurang += f.kurang; t.tidak += f.tidak; t.teguran += f.teguran; };

    for (const e of list) {
      const f = temuanDari(e.criteria);
      const tgl = DB.tanggalLokal(e.timestamp);
      const pos = Number(e.pos) || 0;

      const kunci = `${e.guideId}|${tgl}`;
      let h = harian.get(kunci);
      if (!h) { h = { tgl, guideId: e.guideId, guideName: e.guideName, antar: 0, tanpaId: 0, kurang: 0, tidak: 0, teguran: 0, berat: 0, apresiasi: 0, pos: new Set() }; harian.set(kunci, h); }
      tambah(h, f); h.pos.add(pos);
      if (e.criteria?.berat) h.berat++;
      if (e.criteria?.apresiasi) h.apresiasi++;

      let p = perPos.get(pos);
      if (!p) { p = { pos, antar: 0, tanpaId: 0, kurang: 0, tidak: 0, teguran: 0 }; perPos.set(pos, p); }
      tambah(p, f);

      const t = perTgl.get(tgl) || { tgl, jml: 0, guides: new Set(), hadir: 0 };
      t.jml++; t.hadir++; t.guides.add(e.guideId);
      perTgl.set(tgl, t);
    }

    const urutTgl = (a, b) => String(a.tgl).localeCompare(String(b.tgl));
    return {
      harian: [...harian.values()].sort((a, b) =>
        urutTgl(a, b) || String(a.guideName).localeCompare(String(b.guideName))),
      perPos: [...perPos.values()].sort((a, b) => a.pos - b.pos),
      perTgl: [...perTgl.values()].sort(urutTgl),
    };
  }

  // Pemisah titik koma. Excel berbahasa Indonesia memakai ';' sebagai pemisah
  // daftar, sehingga berkas ber-koma menumpuk jadi satu kolom saat dibuka.
  // Baris "sep=;" di paling atas membuat Excel membacanya benar di semua bahasa.
  const SEP = ';';

  const sel = v => {
    const s = String(v ?? '');
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const barisCsv = arr => arr.map(sel).join(SEP);

  /** Kode regu apa adanya ("A1, D1") agar mudah dicocokkan dengan tab rekap. */
  const reguGuide = gid => {
    const g = App.state.guides.find(x => x.guideId === gid);
    return g ? String(g.regu || '-') : '-';
  };

  App.exportCsv = async function exportCsv() {
    const all = await DB.all();
    if (!all.length) { App.toast('Belum ada data untuk diexport', 'warn', '⚠️'); return; }

    // Entri yang gagal dibuka dipisahkan: nilainya TIDAK diketahui, jadi
    // memasukkannya ke rekap sebagai 0 akan memalsukan angka.
    const rusak = all.filter(e => e.corrupt);
    // Entri yang sudah dibetulkan TIDAK ikut rekap — sama persis dengan baris
    // berstatus 'diganti' di spreadsheet. Kalau ikut, angkanya akan berbeda
    // dengan tab Rekap dan cross-check-nya jadi tidak ada gunanya.
    const diganti = all.filter(e => !e.corrupt && e.diganti);
    const baik = all.filter(e => !e.corrupt && !e.diganti);
    const { harian, perPos, perTgl } = App.rangkumPerangkat(baik);

    const out = [];
    const judul = t => { out.push(''); out.push(barisCsv([t])); };

    out.push('sep=' + SEP);
    out.push(barisCsv(['REKAP PENILAIAN GUIDE — DARI PERANGKAT INI']));
    out.push(barisCsv(['Diexport', `${new Date().toLocaleDateString('id-ID')} ${jamLokal(DB.sekarangISO())}`]));
    out.push(barisCsv(['Pos tersimpan', App.state.tautan.map(l => l.label).join(' + ') || '—']));
    out.push(barisCsv(['Total penilaian', all.length]));
    out.push(barisCsv(['Sudah terkirim', all.filter(e => e.synced).length]));
    out.push(barisCsv(['Masih menunggu', all.filter(e => !e.synced).length]));
    if (rusak.length) out.push(barisCsv(['Tidak terbaca di perangkat', rusak.length]));
    if (diganti.length) out.push(barisCsv(['Dibetulkan lewat koreksi (tidak ikut rekap)', diganti.length]));

    judul('REKAP HARIAN PER GUIDE — cocokkan dengan Dashboard Kunjungan di portal');
    out.push(barisCsv(['(Tiap penilaian = satu PENGANTARAN. Angka harian adalah JUMLAH temuan pada seluruh pengantaran hari itu)']));
    out.push(barisCsv(['(Nilai pengantaran = 100 − potongan dihitung di portal; bobot potongan tidak ada di HP)']));
    out.push(barisCsv(['(Penilaian cara lama: ID 0 = tanpa ID, Uniform −1 = tidak berseragam, Etika minus dengan seragam sesuai = 1 teguran)']));
    out.push(barisCsv(['(Pelanggaran berat dan apresiasi baru berlaku setelah diverifikasi Pengelola Kunjungan)']));
    out.push(barisCsv(['Tanggal', 'Nama Guide', 'guideId', 'Regu', 'ANTAR', 'TANPA ID', 'KURANG LENGKAP',
                       'TIDAK BERSERAGAM', 'TEGURAN', 'LAPORAN BERAT', 'APRESIASI', 'Dinilai di Pos']));
    harian.forEach(h => out.push(barisCsv([
      h.tgl, h.guideName, h.guideId, reguGuide(h.guideId),
      h.antar, h.tanpaId, h.kurang, h.tidak, h.teguran, h.berat, h.apresiasi,
      [...h.pos].sort().join(' & '),
    ])));

    judul('REKAP PER POS PEMERIKSAAN');
    out.push(barisCsv(['(Antar = jumlah pengantaran yang dinilai di pos itu)']));
    out.push(barisCsv(['Pos', 'Antar', 'Tanpa ID', 'Kurang lengkap', 'Tidak berseragam', 'Teguran']));
    perPos.forEach(p => out.push(barisCsv([p.pos, p.antar, p.tanpaId, p.kurang, p.tidak, p.teguran])));

    judul('REKAP PER TANGGAL');
    out.push(barisCsv(['Tanggal', 'Total Pengantaran', 'Guide Berbeda', 'Jumlah Penilaian']));
    perTgl.forEach(t => out.push(barisCsv([t.tgl, t.hadir, t.guides.size, t.jml])));

    // Satu baris per penilaian; kolom cara baru dan cara lama berdampingan.
    const rincian = e => {
      const c = e.criteria || {}, baru = caraBaru(c);
      return [
        baru ? (SERAGAM_LABEL[c.seragam] || c.seragam) : '',
        (c.teguran || []).join(', '), c.berat || '', c.apresiasi || '', e.petugasNama || '',
        baru ? '' : nilaiUniform(c.uniform), baru ? '' : (Number(c.etika) || 0),
      ];
    };
    judul('RINCIAN SEMUA PENILAIAN');
    out.push(barisCsv(['Tanggal', 'Jam', 'Pos', 'guideId', 'Nama Guide', 'ID-Card', 'Seragam', 'Teguran',
                       'Pelanggaran berat', 'Apresiasi', 'Petugas', 'Uniform (cara lama)', 'Etika (cara lama)',
                       'Catatan', 'Status', 'Waktu (UTC, sama dgn portal)', 'evaluationId']));
    baik.forEach(e => out.push(barisCsv([
      DB.tanggalLokal(e.timestamp), jamLokal(e.timestamp), e.pos, e.guideId, e.guideName,
      e.criteria?.idCard ? 1 : 0, ...rincian(e),
      e.catatan || '', e.synced ? 'Terkirim' : 'Menunggu',
      e.timestamp, e.evaluationId,
    ])));

    if (diganti.length) {
      judul('PENILAIAN YANG SUDAH DIBETULKAN — tidak ikut rekap di atas');
      out.push(barisCsv(['Angka di bawah ini sempat tercatat lalu dibetulkan. Di portal barisnya berstatus "diganti".']));
      out.push(barisCsv(['Tanggal', 'Jam', 'Pos', 'guideId', 'Nama Guide', 'ID-Card', 'Seragam', 'Teguran',
                         'Pelanggaran berat', 'Apresiasi', 'Petugas', 'Uniform (cara lama)', 'Etika (cara lama)',
                         'Digantikan oleh', 'evaluationId']));
      diganti.forEach(e => out.push(barisCsv([
        DB.tanggalLokal(e.timestamp), jamLokal(e.timestamp), e.pos, e.guideId, e.guideName,
        e.criteria?.idCard ? 1 : 0, ...rincian(e),
        e.digantikanOleh || '', e.evaluationId,
      ])));
    }

    if (rusak.length) {
      judul('DATA TIDAK TERBACA DI PERANGKAT INI');
      out.push(barisCsv(['Nilainya tidak bisa dibuka di HP/tablet ini, tetapi baris dengan evaluationId berikut tetap ada di portal.']));
      out.push(barisCsv(['Tanggal', 'Jam', 'Pos', 'Status', 'Waktu (UTC, sama dgn portal)', 'evaluationId']));
      rusak.forEach(e => out.push(barisCsv([
        DB.tanggalLokal(e.timestamp), jamLokal(e.timestamp), e.pos,
        e.synced ? 'Terkirim' : 'Menunggu', e.timestamp, e.evaluationId,
      ])));
    }

    const csv = '﻿' + out.join('\r\n');
    App.download(`rekap-penilaian-${DB.tanggalLokal()}.csv`, csv, 'text/csv;charset=utf-8');
    App.toast(`Rekap ${baik.length} penilaian diunduh`, 'ok', '📄');
  }
})();
