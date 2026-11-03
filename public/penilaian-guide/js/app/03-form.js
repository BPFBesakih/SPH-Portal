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
  const { $, $$, uuid, fmtTime, esc, ETIKA_MIN, ETIKA_MAKS, KRIT_ANGKA,
          nilaiUniform, labelUniform } = App;

  App.resetForm = function resetForm(keepPos = true) {
    const pos = keepPos ? App.state.form.pos : App.posBawaan();
    App.state.form = { pos, guide: null, crit: { idCard: null, uniform: null, etika: 0 },
                       catatan: '', lanjutJeda: null };
    App.tampilkanPos();
    $('#guideInput').value = '';
    // Dijaga: selama pembaruan, HP bisa sesaat memuat 02-guide.js lama dari cache.
    if (App.tutupSaran) App.tutupSaran();
    $('#catatan').value = '';
    $('#guidePicked').classList.add('hidden');
    App.tampilkanKandidat(null);
    $$('.seg').forEach(b => b.classList.remove('on'));
    $$('.criterion').forEach(c => {
      if (!KRIT_ANGKA[c.dataset.crit]) c.classList.add('unset');
    });
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
      App.state.form = { ...form, ...d, crit: { ...form.crit, ...(d.crit || {}) } };
      // Draf dari pos yang tautannya sudah dihapus tidak boleh mengunci formulir.
      if (!App.state.tautan.some(l => l.pos === Number(App.state.form.pos))) App.state.form.pos = App.posBawaan();
      // Guide di draf dicocokkan ulang ke daftar terbaru lewat guideId.
      if (App.state.form.guide) App.state.form.guide = App.findGuideById(App.state.form.guide.guideId) || App.state.form.guide;
      App.tampilkanPos();
      $('#guideInput').value = App.state.form.guide ? App.state.form.guide.guideName : '';
      $('#catatan').value = App.state.form.catatan || '';
      App.applyCritUI();
      if (App.state.form.guide) App.showPicked(App.state.form.guide);
      if (App.state.form.guide || Object.values(App.state.form.crit).some(v => v !== null)) $('#draftNote').hidden = false;
    } catch {}
  }

  /** Tampilkan nilai etika dengan tanda: -3, 0, +2. */
  App.nilaiEtika = function nilaiEtika(v) {
    const n = Math.min(ETIKA_MAKS, Math.max(ETIKA_MIN, Number(v) || 0));
    return n > 0 ? '+' + n : String(n);
  }

  App.applyCritUI = function applyCritUI() {
    $$('.criterion').forEach(c => {
      const k = c.dataset.crit;
      const v = App.state.form.crit[k];
      if (KRIT_ANGKA[k]) {
        const n = Math.min(ETIKA_MAKS, Math.max(ETIKA_MIN, Number(v) || 0));
        const el = $(KRIT_ANGKA[k]);
        // Nilai positif diberi tanda + agar bedanya dengan minus terbaca jelas
        if (el) el.textContent = n > 0 ? '+' + n : String(n);
        c.classList.remove('unset');            // 0 sudah merupakan jawaban sah
        const kurang = c.querySelector('[data-step="-1"]');
        const tambah = c.querySelector('[data-step="1"]');
        if (kurang) kurang.toggleAttribute('disabled', n <= ETIKA_MIN);
        if (tambah) tambah.toggleAttribute('disabled', n >= ETIKA_MAKS);
        return;
      }
      c.classList.toggle('unset', v === null);
      c.querySelectorAll('.seg').forEach(b => b.classList.toggle('on', v !== null && String(+b.dataset.val) === String(+v)));
    });
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
    // Etika boleh 0; yang wajib dipilih hanya Uniform dan ID-Card
    const missing = ['idCard', 'uniform'].filter(k => App.state.form.crit[k] === null);
    if (missing.length) { App.toast('Pilih Ya/Tidak untuk ID-Card dan Uniform', 'warn', '⚠️'); return; }

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
        const rincian = `Uniform ${labelUniform(c.uniform)}, ` +
                        `ID ${c.idCard ? 'Ya' : 'Tidak'}, Etika ${App.nilaiEtika(c.etika)}`;
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
        idCard: !!App.state.form.crit.idCard,
        uniform: nilaiUniform(App.state.form.crit.uniform),
        etika: Math.min(ETIKA_MAKS, Math.max(ETIKA_MIN, Number(App.state.form.crit.etika) || 0)),
      },
      catatan: $('#catatan').value.trim(),
      synced: false,
    };
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
      f.crit.idCard === null && f.crit.uniform === null && !Number(f.crit.etika) && !String(f.catatan || '').trim();
  }
})();
