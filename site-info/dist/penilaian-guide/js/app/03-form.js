/* =========================================================
   Formulir penilaian
   Berkas 4 dari 8 — lapisan UI Penilaian Guide Besakih

   TUGAS    : Isi formulir, draf otomatis, tombol kriteria, kirim penilaian.
   LARANGAN : Tidak menulis IndexedDB langsung — selalu lewat DB.*.

   Seluruh berkas di js/app/ berbagi satu objek window.App dan dimuat
   berurutan oleh index.html. State yang berubah hanya hidup di App.state;
   fungsi lintas berkas dipanggil lewat App.nama().
   ========================================================= */
(function () {
  'use strict';

  const App = window.App;
  const { $, $$, uuid, fmtTime, esc, jamLokal, ETIKA_MIN, ETIKA_MAKS, TEGURAN_MAKS, PETUGAS_JAM,
          ringkasKriteria, kritKosong } = App;

  /**
   * Daftar bawaan = contoh di usulan rumus, sama dengan isi awal migrasi portal.
   * Dipakai hanya bila HP belum pernah menerima daftar dari portal (mis. baru
   * diperbarui saat offline). Kodenya pasti dikenal portal: jenis tidak pernah dihapus.
   */
  const PENILAIAN_BAWAAN = {
    versi: 2, teguranMaks: 2, catatanMin: 3, petugas: [], petunjuk: { idCard: '', seragam: '' },
    teguran: [
      { kode: 'tamu-tanpa-kain', label: 'Tamu tidak memakai kain/selendang', perluCatatan: false },
      { kode: 'merokok-hp', label: 'Merokok atau bermain HP saat memandu', perluCatatan: false },
      { kode: 'meninggalkan-tamu', label: 'Meninggalkan tamu', perluCatatan: false },
      { kode: 'antrean', label: 'Tidak tertib antrean/giliran', perluCatatan: false },
      { kode: 'teguran-lain', label: 'Teguran lain (tulis di catatan)', perluCatatan: true },
    ],
    berat: [
      { kode: 'pungutan', label: 'Meminta uang di luar tarif resmi atau memaksa donasi', perluCatatan: true },
      { kode: 'area-terlarang', label: 'Membawa tamu ke area terlarang', perluCatatan: true },
      { kode: 'kasar', label: 'Berkata kasar atau mengancam', perluCatatan: true },
      { kode: 'alkohol', label: 'Dalam pengaruh alkohol', perluCatatan: true },
      { kode: 'berat-lain', label: 'Pelanggaran berat lain (tulis di catatan)', perluCatatan: true },
    ],
    apresiasi: [
      { kode: 'dipuji', label: 'Dipuji wisatawan di depan petugas', perluCatatan: true },
      { kode: 'menolong', label: 'Membantu wisatawan yang sakit atau tersesat', perluCatatan: true },
      { kode: 'apresiasi-lain', label: 'Apresiasi lain (tulis di catatan)', perluCatatan: true },
    ],
  };

  /** Bahan formulir terakhir dari portal, atau daftar bawaan. */
  App.konteksPenilaian = function konteksPenilaian() {
    return DB.getPenilaian() || PENILAIAN_BAWAAN;
  };

  /** Label jenis temuan dari kodenya (juga untuk kode yang kini tidak aktif). */
  App.labelTemuan = function labelTemuan(jenis, kode) {
    const k = App.konteksPenilaian();
    const cari = list => (list || []).find(t => t.kode === kode);
    const t = cari(k[jenis]) || cari(PENILAIAN_BAWAAN[jenis]);
    return t ? t.label : kode;
  };

  /* ---------------- Petugas penilai (sekali per shift) ---------------- */

  /** Pilihan petugas yang masih berlaku (≤ PETUGAS_JAM jam), atau null. */
  App.petugasAktif = function petugasAktif() {
    const p = Sync.Settings.get().petugas;
    if (!p || !p.id || !p.at || Date.now() - p.at > PETUGAS_JAM * 3600000) return null;
    // Petugas yang dinonaktifkan pengelola tidak bisa dipakai lagi.
    const daftar = App.konteksPenilaian().petugas || [];
    return daftar.some(x => x.id === p.id) ? p : null;
  };

  App.pilihPetugas = function pilihPetugas(id) {
    const p = (App.konteksPenilaian().petugas || []).find(x => x.id === id);
    Sync.Settings.set({ petugas: p ? { id: p.id, nama: p.nama, at: Date.now() } : null });
    App.tampilkanPetugas();
  };

  App.tampilkanPetugas = function tampilkanPetugas() {
    const box = $('#petugasBox');
    if (!box) return;
    const daftar = App.konteksPenilaian().petugas || [];
    // Tanpa daftar dari pengelola, penilaian tetap bisa disimpan tanpa nama petugas.
    if (!daftar.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const aktif = App.petugasAktif();
    if (aktif && !box.dataset.ganti) {
      const sampai = jamLokal(new Date(aktif.at + PETUGAS_JAM * 3600000).toISOString());
      box.innerHTML = `<span>👤 <strong>${esc(aktif.nama)}</strong> <small>· berlaku sampai ${esc(sampai)}</small></span>` +
        `<button type="button" class="chip" data-ganti-petugas="1">Ganti petugas</button>`;
      return;
    }
    box.innerHTML = `<label class="sublbl" for="petugasSelect">Nama petugas yang menilai (sekali per shift)</label>` +
      `<select id="petugasSelect" class="bigselect"><option value="">Pilih nama Anda…</option>` +
      daftar.map(p => `<option value="${esc(p.id)}"${aktif && aktif.id === p.id ? ' selected' : ''}>${esc(p.nama)}${p.keterangan ? ' — ' + esc(p.keterangan) : ''}</option>`).join('') +
      `</select>`;
  };

  /* ---------------- Daftar pilihan dari portal ---------------- */

  /** Gambar chip teguran, pilihan pelanggaran berat/apresiasi, dan petunjuk. */
  App.renderPenilaianForm = function renderPenilaianForm() {
    const k = App.konteksPenilaian();
    const list = $('#teguranList');
    if (list) {
      const dipilih = App.state.form.crit.teguran || [];
      // Kode yang sudah dipilih (mis. dari draf) tetap tampil walau kini tidak aktif.
      const jenis = [...k.teguran, ...dipilih.filter(kode => !k.teguran.some(t => t.kode === kode)).map(kode => ({ kode, label: App.labelTemuan('teguran', kode) }))];
      list.innerHTML = jenis.map(t => `<button type="button" class="chip" data-teguran="${esc(t.kode)}" aria-pressed="false">${esc(t.label)}</button>`).join('');
    }
    for (const [sel, jenis] of [['#beratSelect', 'berat'], ['#apresiasiSelect', 'apresiasi']]) {
      const el = $(sel);
      if (el) el.innerHTML = `<option value="">Tidak ada</option>` + (k[jenis] || []).map(t => `<option value="${esc(t.kode)}">${esc(t.label)}</option>`).join('');
    }
    const pid = $('#petunjukId'), pseragam = $('#petunjukSeragam');
    if (pid) { pid.textContent = k.petunjuk?.idCard || ''; pid.hidden = !pid.textContent; }
    if (pseragam) { pseragam.textContent = k.petunjuk?.seragam || ''; pseragam.hidden = !pseragam.textContent; }
    App.tampilkanPetugas();
    App.applyCritUI();
  };

  /** Catatan wajib bila ada pelanggaran berat, apresiasi, atau teguran "lain". */
  App.catatanWajib = function catatanWajib(crit = App.state.form.crit) {
    if (crit.berat || crit.apresiasi) return true;
    const k = App.konteksPenilaian();
    return (crit.teguran || []).some(kode => (k.teguran.find(t => t.kode === kode) || {}).perluCatatan);
  };

  App.resetForm = function resetForm(keepPos = true) {
    const pos = keepPos ? App.state.form.pos : App.posBawaan();
    App.state.form = { pos, guide: null, crit: kritKosong(), catatan: '', lanjutJeda: null };
    App.tampilkanPos();
    $('#guideInput').value = '';
    // Kotak kosong: daftar saran tertutup dan keterangannya kembali ke petunjuk
    // awal. Dijaga: selama pembaruan, HP bisa sesaat memuat 02-guide.js lama.
    if (App.tampilkanSaran) App.tampilkanSaran();
    $('#catatan').value = '';
    $('#guidePicked').classList.add('hidden');
    App.tampilkanKandidat(null);
    $$('.seg').forEach(b => b.classList.remove('on'));
    const laporan = $('#laporanBox');
    if (laporan) laporan.open = false;
    App.applyCritUI();
    App.saveDraft();
  }

  // Draft ikut dienkripsi (lihat DB.simpanDraft). Isinya sama dengan isi
  // penilaian — nama guide dan nilainya — jadi tidak masuk akal kalau
  // penilaiannya dikunci sementara draftnya tergeletak polos.
  App.saveDraft = function saveDraft() {
    DB.simpanDraft(App.state.form);
  }

  App.loadDraft = async function loadDraft() {
    try {
      const d = await DB.bacaDraft();
      if (!d) return;
      const form = App.state.form;
      // Draf dari versi sebelum 2.2.0 berisi Uniform/Etika: hanya ID-Card yang dipakai.
      const lama = d.crit || {};
      const crit = { ...kritKosong(), idCard: typeof lama.idCard === 'boolean' ? lama.idCard : null,
                     seragam: ['lengkap', 'kurang', 'tidak'].includes(lama.seragam) ? lama.seragam : null,
                     teguran: Array.isArray(lama.teguran) ? lama.teguran.slice(0, TEGURAN_MAKS) : [],
                     berat: typeof lama.berat === 'string' ? lama.berat : '', apresiasi: typeof lama.apresiasi === 'string' ? lama.apresiasi : '' };
      App.state.form = { ...form, ...d, crit };
      // Draf dari pos yang tautannya sudah dihapus tidak boleh mengunci formulir.
      if (!App.state.tautan.some(l => l.pos === Number(App.state.form.pos))) App.state.form.pos = App.posBawaan();
      // Guide di draf dicocokkan ulang ke daftar terbaru lewat guideId.
      if (App.state.form.guide) App.state.form.guide = App.findGuideById(App.state.form.guide.guideId) || App.state.form.guide;
      App.tampilkanPos();
      $('#guideInput').value = App.state.form.guide ? App.state.form.guide.guideName : '';
      $('#catatan').value = App.state.form.catatan || '';
      App.renderPenilaianForm();
      if (App.state.form.guide) App.showPicked(App.state.form.guide);
      if (App.state.form.guide || !App.kriteriaKosong()) $('#draftNote').hidden = false;
    } catch {}
  }

  /** Tampilkan nilai etika dengan tanda: -3, 0, +2. */
  App.nilaiEtika = function nilaiEtika(v) {
    const n = Math.min(ETIKA_MAKS, Math.max(ETIKA_MIN, Number(v) || 0));
    return n > 0 ? '+' + n : String(n);
  }

  /** True bila belum ada satu pun isian penilaian. */
  App.kriteriaKosong = function kriteriaKosong() {
    const c = App.state.form.crit;
    return c.idCard === null && c.seragam === null && !(c.teguran || []).length && !c.berat && !c.apresiasi;
  };

  App.applyCritUI = function applyCritUI() {
    const c = App.state.form.crit;
    $$('.criterion').forEach(el => {
      const k = el.dataset.crit;
      if (k === 'idCard') {
        el.classList.toggle('unset', c.idCard === null);
        el.querySelectorAll('.seg').forEach(b => b.classList.toggle('on', c.idCard !== null && (b.dataset.val === '1') === c.idCard));
      } else if (k === 'seragam') {
        el.classList.toggle('unset', c.seragam === null);
        el.querySelectorAll('.seg').forEach(b => b.classList.toggle('on', b.dataset.val === c.seragam));
      }
    });
    const dipilih = c.teguran || [];
    $$('[data-teguran]').forEach(b => {
      const on = dipilih.includes(b.dataset.teguran);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      // Paling banyak 2 teguran per pengantaran: chip lain dikunci setelah 2 dipilih.
      b.toggleAttribute('disabled', !on && dipilih.length >= TEGURAN_MAKS);
    });
    const berat = $('#beratSelect'), apresiasi = $('#apresiasiSelect');
    if (berat) berat.value = c.berat || '';
    if (apresiasi) apresiasi.value = c.apresiasi || '';
    const laporan = $('#laporanBox');
    if (laporan && (c.berat || c.apresiasi)) laporan.open = true;
    const wajib = $('#catatanWajib');
    if (wajib) wajib.textContent = App.catatanWajib(c) ? '(wajib diisi)' : '(boleh kosong)';
  }

  App.showPicked = function showPicked(g) {
    const el = $('#guidePicked');
    el.dataset.guideId = g.guideId;
    el.innerHTML = `✓ ${esc(g.guideName)} · ${esc(g.guideId)} · ${esc(App.labelRegu(g.regu))}`;
    el.classList.remove('hidden');
    App.tandaiKembar(g);
  }

  /**
   * Beri tahu sedini mungkin bila guide ini sudah dinilai di pos yang sama
   * hari ini — supaya staff tidak terlanjur mengisi formulir untuk kehadiran
   * yang toh tetap dihitung satu.
   */
  App.tandaiKembar = async function tandaiKembar(g) {
    const el = $('#guidePicked');
    const pos = Number(App.state.form.pos);
    let kembar = null;
    try { kembar = await DB.penilaianKembar(g.guideId, pos, DB.sekarangISO()); }
    catch { return; }
    // Guide sudah diganti selagi menunggu — jangan timpa keterangannya
    if (!kembar || el.dataset.guideId !== g.guideId) return;
    el.innerHTML += `<br><small>⚠️ Sudah dinilai di Pos ${pos} pukul ` +
                    `${esc(fmtTime(kembar.timestamp).split(' ').pop())}. ` +
                    `Kalau ini pengantaran berikutnya, lanjutkan saja.</small>`;
  }

  /** Tawarkan nama-nama yang mungkin dimaksud saat ketikan masih ambigu. */
  App.tampilkanKandidat = function tampilkanKandidat(kandidat) {
    const el = $('#guideAmbigu');
    if (!el) return;
    if (!kandidat || !kandidat.length) { el.hidden = true; el.textContent = ''; return; }
    const tampil = kandidat.slice(0, 6);
    el.innerHTML = 'Maksud Anda: ' + tampil.map(g =>
      `<button type="button" class="chip" data-guide="${esc(g.guideName)}" data-guide-id="${esc(g.guideId)}">` +
      `${esc(g.guideName)} <small>· ${esc(g.guideId)} · ${esc(App.labelRegu(g.regu))}</small></button>`
    ).join(' ') + (kandidat.length > tampil.length
      ? ` <small>(+${kandidat.length - tampil.length} lainnya — ketik lebih lengkap)</small>` : '');
    el.hidden = false;
  }

  App.submitEval = async function submitEval(e) {
    e.preventDefault();
    // Pilihan eksplisit lewat kartu/chip/koreksi sudah membawa guideId, dan itu
    // menang atas pencocokan ulang dari nama: dua orang boleh bernama sama
    // persis, sehingga nama saja tidak cukup untuk menentukan siapa yang dinilai.
    const dipilih = App.state.form.guide;
    const ketikan = String($('#guideInput').value || '').trim().toLowerCase();
    const pilihan = (dipilih && String(dipilih.guideName).toLowerCase() === ketikan)
      ? { guide: dipilih }
      : App.guideUntukSimpan($('#guideInput').value);
    if (!pilihan.guide) {
      App.toast(pilihan.error, 'warn', '⚠️');
      App.tampilkanKandidat(pilihan.kandidat);
      $('#guideInput').focus();
      return;
    }
    const g = pilihan.guide;
    // ID-Card dan Seragam wajib dipilih: nilai 100 berarti "sudah dicek dan bersih",
    // bukan "tidak diisi". Teguran boleh kosong.
    const crit = App.state.form.crit;
    if (crit.idCard === null || crit.seragam === null) { App.toast('Pilih ID-Card dan Seragam dulu', 'warn', '⚠️'); return; }
    const k = App.konteksPenilaian();
    if ((crit.teguran || []).length > TEGURAN_MAKS) { App.toast(`Paling banyak ${TEGURAN_MAKS} teguran per pengantaran`, 'warn', '⚠️'); return; }
    const catatanIsi = $('#catatan').value.trim();
    if (App.catatanWajib(crit) && catatanIsi.length < (k.catatanMin || 3)) {
      App.toast('Tulis catatan singkat untuk laporan ini', 'warn', '📝'); $('#catatan').focus(); return;
    }
    const petugas = App.petugasAktif();
    if ((k.petugas || []).length && !petugas) {
      App.toast('Pilih nama petugas dulu (sekali per shift)', 'warn', '👤');
      App.tampilkanPetugas(); const sel = $('#petugasSelect'); if (sel) sel.focus();
      return;
    }

    // Dalam mode koreksi, pos-nya dikunci ke penilaian yang sedang dibetulkan.
    const pos = App.state.koreksi ? Number(App.state.koreksi.pos) : Number(App.state.form.pos);
    if (!App.state.tautan.some(l => l.pos === pos)) { App.toast('Simpan tautan pos dulu', 'warn', '🔗'); App.go('tautan'); return; }

    // DUA LAPIS pengaman salah pencet. Guide yang sama boleh dinilai berkali-
    // kali sehari di pos yang sama — itu memang pengantaran berbeda — jadi yang
    // dijaga hanya jaraknya:
    //   < JEDA_TOLAK       : server pasti menolak. Ditahan di sini supaya staff
    //                        tidak mengisi formulir yang sudah pasti gagal.
    //   < JEDA_PERINGATAN  : mencurigakan tapi mungkin sah. Petugas yang tahu
    //                        keadaan di lapangan, jadi dia yang memutuskan.
    // Pos LAIN tidak pernah terkena — jedanya per guide DAN per pos.
    // Saat sedang mengoreksi, penilaian "kembar" itu justru yang dibetulkan.
    const kembar = App.state.koreksi ? null : await DB.penilaianKembar(g.guideId, pos, DB.sekarangISO());
    if (kembar) {
      const c = kembar.criteria || {};
      const selisih = Math.max(0, Math.round(
        Math.abs(new Date(kembar.timestamp).getTime() - new Date(DB.sekarangISO()).getTime()) / 60000));
      const pastiDitolak = selisih < DB.JEDA_TOLAK_MENIT;
      // Persetujuan berlaku untuk SATU penilaian sebelumnya saja. Kalau
      // sementara itu muncul entri lain yang lebih dekat, petugas ditanya lagi.
      const sudahDiyakinkan = App.state.form.lanjutJeda === kembar.evaluationId;

      if (pastiDitolak || !sudahDiyakinkan) {
        const jam = esc(fmtTime(kembar.timestamp).split(' ').pop());
        const rincian = ringkasKriteria(c);
        const perbaiki = `<button type="button" class="chip retrybtn" ` +
                         `data-fix="${esc(kembar.evaluationId)}">✏️ Betulkan penilaian itu</button>`;
        App.toast(`${g.guideName} dinilai di Pos ${pos} ${selisih} menit lalu`,
                  'warn', pastiDitolak ? '🚫' : '⚠️');
        const el = $('#guideAmbigu');
        if (el) {
          el.innerHTML = pastiDitolak
            ? `🚫 <strong>${esc(g.guideName)}</strong> baru dinilai di Pos ${pos} pukul ${jam} ` +
              `(${selisih} menit lalu) — ${esc(rincian)}.<br>` +
              `Di bawah ${DB.JEDA_TOLAK_MENIT} menit server akan menolaknya sebagai salah pencet. ` +
              `Kalau nilainya yang keliru, betulkan penilaian itu.<br>${perbaiki}`
            : `⚠️ <strong>${esc(g.guideName)}</strong> sudah dinilai di Pos ${pos} pukul ${jam} ` +
              `(${selisih} menit lalu) — ${esc(rincian)}.<br>` +
              `Kalau ini pengantaran berikutnya, lanjutkan. Kalau tadi salah pencet, betulkan yang itu.` +
              `<br><button type="button" class="chip" data-lanjut="${esc(kembar.evaluationId)}">` +
              `✓ Ya, ini pengantaran berikutnya</button> ${perbaiki}`;
          el.hidden = false;
        }
        return;
      }
    }

    const evaluation = {
      evaluationId: uuid(),
      guideId: g.guideId,
      guideName: g.guideName,
      pos,
      // Koreksi memakai cap waktu penilaian ASLINYA. Kunci "satu pos sekali
      // sehari" di server memakai TANGGAL, jadi keduanya wajib jatuh pada hari
      // yang sama — koreksi yang dibuat tepat lewat tengah malam akan ditolak
      // kalau diberi cap waktu baru. Kapan koreksinya benar-benar masuk tetap
      // tercatat server di kolom receivedAt.
      timestamp: App.state.koreksi ? App.state.koreksi.timestamp : DB.sekarangISO(),
      criteria: {
        idCard: !!crit.idCard,
        seragam: crit.seragam,
        teguran: (crit.teguran || []).slice(0, TEGURAN_MAKS),
        berat: crit.berat || '',
        apresiasi: crit.apresiasi || '',
      },
      catatan: catatanIsi,
      synced: false,
    };
    // Nama petugas: pilihan shift ini; dikirim sebagai id, nama diambil portal.
    if (petugas) { evaluation.petugasId = petugas.id; evaluation.petugasNama = petugas.nama; }
    // koreksiDari hanya disertakan bila penilaian lamanya SUDAH ada di server.
    // Kalau belum pernah terkirim, tidak ada yang perlu ditandai di sana.
    if (App.state.koreksi && App.state.koreksi.synced) evaluation.koreksiDari = App.state.koreksi.evaluationId;

    const sedangKoreksi = !!App.state.koreksi;
    // Keadaan penilaian lama dibaca ULANG di sini, bukan dipakai apa adanya
    // dari saat tombol Perbaiki ditekan: sync bisa saja selesai sementara
    // formulir sedang diisi, dan jalur "timpa di perangkat" hanya sah untuk
    // entri yang benar-benar belum terkirim.
    if (App.state.koreksi) {
      const kini = await DB.get(App.state.koreksi.evaluationId);
      if (kini) {
        App.state.koreksi = kini;
        if (kini.synced) evaluation.koreksiDari = kini.evaluationId;
        else delete evaluation.koreksiDari;
      }
    }

    try {
      if (App.state.koreksi && !App.state.koreksi.synced) {
        // Belum pernah sampai ke server → cukup ditimpa di perangkat. Tidak
        // perlu jejak koreksi di spreadsheet: angka yang salah belum pernah
        // ada di sana.
        await DB.gantiIsi(App.state.koreksi.evaluationId,
                          { ...evaluation, evaluationId: App.state.koreksi.evaluationId, koreksiDari: null });
      } else {
        await DB.save(evaluation);
        if (App.state.koreksi) await DB.tandaiDiganti(App.state.koreksi.evaluationId, evaluation.evaluationId);
      }
    } catch (err) {
      App.toast('Gagal menyimpan: ' + err.message, 'err', '❌');
      return;
    }

    App.state.koreksi = null;
    App.tampilkanBarKoreksi();
    App.haptic([30, 40, 30]);
    App.toast(sedangKoreksi ? 'Penilaian dibetulkan' : 'Penilaian tersimpan', 'ok',
          sedangKoreksi ? '✏️' : '💾');
    App.state.form.pos = evaluation.pos;
    DB.hapusDraft();
    $('#draftNote').hidden = true;
    App.resetForm(true);
    App.refreshStats();
    // Versi baru menunggu sampai formulir kosong (ATR-FL-14). Simpanan sudah di
    // IndexedDB, jadi memuat ulang sekarang aman.
    if (App.state.versiBaruSiap) { location.reload(); return; }
    App.go('home');
    if (Sync.isOnline()) Sync.syncNow();
  }

  /** Pos bawaan: pos terakhir dipakai bila tautannya masih ada, selain itu tautan pertama. */
  App.posBawaan = function posBawaan() {
    const terakhir = Number(Sync.Settings.get().pos);
    if (App.state.tautan.some(l => l.pos === terakhir)) return terakhir;
    return App.state.tautan.length ? App.state.tautan[0].pos : null;
  }

  /** Kop pos di Beranda dan di formulir; pemilih hanya bila ada lebih dari satu tautan. */
  App.tampilkanPos = function tampilkanPos() {
    const pos = App.state.koreksi ? Number(App.state.koreksi.pos) : App.state.form.pos;
    const label = pos ? App.labelPos(pos) : 'Belum ada tautan pos';
    $('#posLabel').textContent = label;
    $('#posFormLabel').textContent = label;
    const sel = $('#homePos');
    const banyak = App.state.tautan.length > 1;
    sel.hidden = !banyak;
    if (banyak) {
      sel.innerHTML = App.state.tautan.map(l =>
        `<option value="${l.pos}">${esc(l.label)}${l.dicabut ? ' (tautan tidak aktif)' : ''}</option>`).join('');
      sel.value = String(pos);
    }
  }

  /** True bila formulir tidak berisi apa pun yang bisa hilang saat dimuat ulang. */
  App.formulirKosong = function formulirKosong() {
    const f = App.state.form;
    return !App.state.koreksi && !f.guide && !String($('#guideInput').value || '').trim() &&
      App.kriteriaKosong() && !String(f.catatan || '').trim();
  }
})();
