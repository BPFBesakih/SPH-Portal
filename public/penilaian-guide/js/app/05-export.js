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
  const { jamLokal, nilaiUniform } = App;

  /**
   * Rangkuman penilaian yang tersimpan di PERANGKAT INI.
   *
   * Aturan penggabungannya sengaja disamakan persis dengan rekap di spreadsheet
   * (`bangunRekap` pada server-gas/Code.gs): bila satu guide dinilai beberapa
   * kali pada hari yang sama, UNI FORM, ID dan ETIKA diambil yang paling
   * buruk (nilai terendah). Dengan begitu angka di berkas ini
   * bisa langsung disandingkan dengan tab "Rekap ..." untuk cross-check —
   * kalau berbeda, berarti memang ada yang tidak sampai ke server.
   */
  App.rangkumPerangkat = function rangkumPerangkat(list) {
    const harian = new Map(), perPosHari = new Map(), perTgl = new Map();

    for (const e of list) {
      const c = e.criteria || {};
      const u = nilaiUniform(c.uniform);
      const patuh = u >= 1 ? 1 : 0;
      const i = c.idCard ? 1 : 0;
      const et = Math.min(5, Math.max(-5, Number(c.etika) || 0));
      const tgl = DB.tanggalLokal(e.timestamp);
      const pos = Number(e.pos) || 0;

      const kunci = `${e.guideId}|${tgl}`;
      // Tiap penilaian adalah satu PENGANTARAN tersendiri. Dulu nilai dalam
      // sehari digabung dan diambil yang terburuk, karena penilaian kedua pasti
      // koreksi — sekarang keduanya sah, jadi dijumlahkan.
      const h = harian.get(kunci);
      if (!h) {
        harian.set(kunci, { tgl, guideId: e.guideId, guideName: e.guideName,
                            uniform: u, patuh, idCard: i, etika: et,
                            pos: new Set([pos]), jml: 1 });
      } else {
        h.uniform += u;
        h.patuh += patuh;
        h.idCard += i;
        h.etika += et;
        h.pos.add(pos);
        h.jml++;
      }

      const kp = `${e.guideId}|${pos}|${tgl}`;
      const ph = perPosHari.get(kp);
      if (!ph) perPosHari.set(kp, { pos, uniform: u, patuh, idCard: i, etika: et, antar: 1 });
      else {
        ph.uniform += u;
        ph.patuh += patuh;
        ph.idCard += i;
        ph.etika += et;
        ph.antar++;
      }

      const t = perTgl.get(tgl) || { tgl, jml: 0, guides: new Set(), hadir: 0 };
      t.jml++; t.guides.add(e.guideId);
      perTgl.set(tgl, t);
    }

    const perPos = new Map();
    for (const ph of perPosHari.values()) {
      const p = perPos.get(ph.pos) || { pos: ph.pos, hadir: 0, uniform: 0, patuh: 0, idCard: 0, etika: 0 };
      p.hadir += ph.antar; p.uniform += ph.uniform; p.patuh += ph.patuh;
      p.idCard += ph.idCard; p.etika += ph.etika;
      perPos.set(ph.pos, p);
    }
    for (const h of harian.values()) {
      const t = perTgl.get(h.tgl);
      if (t) t.hadir += h.jml;
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

    judul('REKAP HARIAN PER GUIDE — cocokkan dengan tab Rekap A1/A2/D1/D2 di spreadsheet');
    out.push(barisCsv(['(Tiap penilaian = satu PENGANTARAN. Angka harian adalah JUMLAH seluruh pengantaran hari itu)']));
    out.push(barisCsv(['(UNI FORM bernilai -1 tidak sesuai, +1 sesuai, +2 penampilan bagus — jadi jumlahnya bisa minus)']));
    out.push(barisCsv(['(SERAGAM SESUAI = berapa pengantaran yang bernilai +1 atau +2)']));
    out.push(barisCsv(['(Kolom REVIEW tidak ada di sini karena tidak diisi lewat aplikasi — lihat tab Rekap di spreadsheet)']));
    out.push(barisCsv(['Tanggal', 'Nama Guide', 'guideId', 'Regu', 'UNI FORM', 'SERAGAM SESUAI',
                       'ID', 'ETIKA', 'ANTAR', 'Dinilai di Pos']));
    harian.forEach(h => out.push(barisCsv([
      h.tgl, h.guideName, h.guideId, reguGuide(h.guideId),
      h.uniform, h.patuh, h.idCard, h.etika,
      h.jml, [...h.pos].sort().join(' & '),
    ])));

    judul('REKAP PER POS PEMERIKSAAN');
    out.push(barisCsv(['(Antar = jumlah pengantaran yang dinilai di pos itu)']));
    out.push(barisCsv(['Pos', 'Antar', 'Uniform (jumlah nilai)', 'Seragam Sesuai', 'ID Sesuai', 'Total Etika']));
    perPos.forEach(p => out.push(barisCsv([p.pos, p.hadir, p.uniform, p.patuh, p.idCard, p.etika])));

    judul('REKAP PER TANGGAL');
    out.push(barisCsv(['Tanggal', 'Total Pengantaran', 'Guide Berbeda', 'Jumlah Penilaian']));
    perTgl.forEach(t => out.push(barisCsv([t.tgl, t.hadir, t.guides.size, t.jml])));

    judul('RINCIAN SEMUA PENILAIAN');
    out.push(barisCsv(['Tanggal', 'Jam', 'Pos', 'guideId', 'Nama Guide', 'Uniform', 'ID-Card',
                       'Etika', 'Catatan', 'Status', 'Waktu (UTC, sama dgn spreadsheet)', 'evaluationId']));
    baik.forEach(e => out.push(barisCsv([
      DB.tanggalLokal(e.timestamp), jamLokal(e.timestamp), e.pos, e.guideId, e.guideName,
      nilaiUniform(e.criteria?.uniform),
      e.criteria?.idCard ? 1 : 0,
      Number(e.criteria?.etika) || 0,
      e.catatan || '', e.synced ? 'Terkirim' : 'Menunggu',
      e.timestamp, e.evaluationId,
    ])));

    if (diganti.length) {
      judul('PENILAIAN YANG SUDAH DIBETULKAN — tidak ikut rekap di atas');
      out.push(barisCsv(['Angka di bawah ini sempat tercatat lalu dibetulkan. Di spreadsheet barisnya berstatus "diganti".']));
      out.push(barisCsv(['Tanggal', 'Jam', 'Pos', 'guideId', 'Nama Guide', 'Uniform', 'ID-Card',
                         'Etika', 'Digantikan oleh', 'evaluationId']));
      diganti.forEach(e => out.push(barisCsv([
        DB.tanggalLokal(e.timestamp), jamLokal(e.timestamp), e.pos, e.guideId, e.guideName,
        nilaiUniform(e.criteria?.uniform), e.criteria?.idCard ? 1 : 0, Number(e.criteria?.etika) || 0,
        e.digantikanOleh || '', e.evaluationId,
      ])));
    }

    if (rusak.length) {
      judul('DATA TIDAK TERBACA DI PERANGKAT INI');
      out.push(barisCsv(['Nilainya tidak bisa dibuka di HP/tablet ini, tetapi baris dengan evaluationId berikut tetap ada di spreadsheet.']));
      out.push(barisCsv(['Tanggal', 'Jam', 'Pos', 'Status', 'Waktu (UTC, sama dgn spreadsheet)', 'evaluationId']));
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
