/**
 * Tampilan pantauan lelang.
 *
 * Modul ini hanya menyusun tampilan dan mengatur tindakan. Penarikan komentar
 * dan perhitungan jam tutup diserahkan lewat `deps`, supaya mesin yang sudah
 * dipakai halaman analisis tidak perlu disalin ke sini.
 */

import * as P from './pantau.js';
import * as G from './gcal.js';
import * as A from './akun.js';
import { analyze, parseBid, fmtRupiah } from './analysis.js';
import { fmtDateTime, fmtTime, fmtDate, fmtDuration, wallTimeToEpoch } from './time.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let deps = null;
let detak = null;
let pemburu = null;
let sedangDiubah = null;      // id lelang yang sedang disunting
let subTab = 'jalan';         // 'jalan' | 'selesai'

const SELESAI = new Set(['menang', 'kalah', 'batal']);

/**
 * Hasil penarikan terakhir per lelang, hanya selama tab terbuka.
 *
 * Dipakai supaya tombol analisis membuka hasilnya seketika tanpa menarik
 * ulang. Sengaja tidak ikut disimpan: isinya bisa ratusan komentar, dan
 * membengkakkan simpanan browser maupun kiriman ke server.
 */
const dumpTerakhir = new Map();

function simpanDump(id, dump) {
  dumpTerakhir.set(id, dump);
  if (dumpTerakhir.size > 12) dumpTerakhir.delete(dumpTerakhir.keys().next().value);
}

/** "03/08/2026" + "20:30:00" -> epoch, dalam zona waktu yang sedang dipakai. */
function keEpoch(tgl, jam, tz) {
  const t = String(tgl).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!t) return { galat: 'Tanggal harus berbentuk 03/08/2026.' };

  const j = String(jam).trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/);
  if (!j) return { galat: 'Jam harus berbentuk 20:30 atau 20:30:00.' };

  const [h, mi, s] = [+j[1], +j[2], +(j[3] || 0)];
  if (h > 23 || mi > 59 || s > 59) return { galat: 'Jam itu tidak masuk akal.' };

  return { epoch: wallTimeToEpoch(+t[3], +t[2], +t[1], h, mi, s, tz) };
}

export function initPantau(d) {
  deps = d;

  $('paddgo').onclick = tambahDariKotak;
  $('paddlink').addEventListener('keydown', (e) => { if (e.key === 'Enter') tambahDariKotak(); });

  $('pakun').value = P.akunku();
  $('pakun').addEventListener('change', () => {
    P.setAkunku($('pakun').value);
    render();
  });

  $('pics').onclick = () => {
    const aktif = P.semua().filter((x) => x.status === 'aktif' && x.closeAt != null);
    if (!aktif.length) { stat('Belum ada lelang berjalan yang punya jam tutup.', 'bad'); return; }
    deps.unduh('lelang-insta-pantauan.ics', P.buatIcs(aktif), 'text/calendar;charset=utf-8');
    stat(`${aktif.length} lelang diekspor ke kalender. Buka berkasnya di ponsel untuk memasangnya.`, 'ready');
  };

  $('pgcal').onclick = () => G.terhubung() ? putusGoogle() : hubungGoogle();

  $('pekspor').onclick = () =>
    deps.unduh('lelang-insta-pantauan.json', P.eksporSemua(), 'application/json');

  $('pimporfile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const hasil = P.imporSemua(await f.text());
      stat(`${hasil.baru} lelang baru, ${hasil.diperbarui} diperbarui.`, 'ready');
      render();
    } catch (err) {
      stat(err.message, 'bad');
    }
    e.target.value = '';
  };
  $('pimpor').onclick = () => $('pimporfile').click();

  // Satu penangan untuk seluruh daftar; barisnya digambar ulang terus-menerus.
  $('plist').addEventListener('click', tanganiAksi);
  $('plist').addEventListener('change', tanganiUbah);

  $('ptab').addEventListener('click', (e) => {
    const t = e.target.closest('[data-ptab]');
    if (!t) return;
    subTab = t.dataset.ptab;
    sedangDiubah = null;
    render();
  });

  A.keadaan().then((k) => {
    keadaanAkun = k;
    gambarMasuk();
    if (A.sudahMasuk()) samakanServer({ pertamaKali: true });
  });

  tandaiGoogle();
  // Kalau izinnya sudah pernah diberikan, sambungan dipulihkan tanpa jendela.
  if (G.siap()) {
    G.hubungkan({ diam: true })
      .then(() => { tandaiGoogle(); sinkronSekarang({ diam: true }); })
      .catch(() => { /* belum diizinkan; tombolnya menunggu */ });
  }
}

function stat(teks, kelas = '') {
  $('paddstat').className = 'take-stat ' + kelas;
  $('paddstat').innerHTML = teks;
}

// ---------------------------------------------------------------- masuk

let keadaanAkun = { ada: false, terpasang: false };

function gambarMasuk(pesan = '', kelas = '') {
  const kotak = $('pmasuk');

  if (!keadaanAkun.ada) {
    kotak.innerHTML = '';
    return;
  }

  if (A.sudahMasuk()) {
    kotak.innerHTML =
      '<div class="pm-in"><span class="pm-ok">Tersambung ke servermu</span>' +
      '<span class="pm-sub">Daftar ini ikut ke perangkat lain yang kamu masuki dengan sandi yang sama.</span>' +
      '<span class="fill"></span>' +
      '<button class="btn sm quiet" id="pmkeluar">Keluar</button></div>' +
      (pesan ? `<p class="pm-note ${kelas}">${pesan}</p>` : '');
    $('pmkeluar').onclick = async () => {
      $('pmkeluar').disabled = true;
      await A.keluar();
      gambarMasuk('Keluar. Daftarnya tetap ada di browser ini.');
    };
    return;
  }

  const pertama = !keadaanAkun.terpasang;
  kotak.innerHTML =
    `<div class="pm-in"><span class="pm-judul">${pertama
      ? 'Buat kata sandi supaya daftarnya ikut ke HP'
      : 'Masuk supaya daftarnya ikut ke HP'}</span>` +
    '<span class="fill"></span>' +
    `<input type="password" id="pmsandi" placeholder="${pertama ? 'minimal 8 huruf' : 'kata sandi'}" autocomplete="current-password">` +
    `<button class="btn sm solid" id="pmgo">${pertama ? 'Buat' : 'Masuk'}</button></div>` +
    `<p class="pm-note ${kelas}">${pesan || (pertama
      ? 'Kata sandi ini kamu tentukan sendiri sekarang, dan hanya tersimpan di servermu.'
      : 'Kata sandi yang sama seperti di perangkatmu yang lain.')}</p>`;

  const jalan = async () => {
    const sandi = $('pmsandi').value;
    if (!sandi) return gambarMasuk('Kata sandinya belum diisi.', 'bad');
    $('pmgo').disabled = true;
    try {
      if (pertama) await A.pasangSandi(sandi);
      else await A.masuk(sandi);
      keadaanAkun = await A.keadaan();
      gambarMasuk('Menyamakan daftar…');
      await samakanServer({ pertamaKali: true });
    } catch (e) {
      gambarMasuk(e.message, 'bad');
    }
  };
  $('pmgo').onclick = jalan;
  $('pmsandi').addEventListener('keydown', (e) => { if (e.key === 'Enter') jalan(); });
}

/**
 * Samakan daftar di browser ini dengan yang tersimpan di server.
 *
 * Aturannya sederhana karena pemakainya satu orang: yang waktu ubahnya lebih
 * baru menang seluruhnya. Menggabungkan per lelang akan menghidupkan kembali
 * yang sengaja dihapus, dan itu lebih membingungkan daripada menimpa.
 */
async function samakanServer({ pertamaKali = false } = {}) {
  if (!A.sudahMasuk()) return;

  try {
    const jauh = await A.ambilDariServer();
    const waktuJauh = Number(jauh?.updatedAt || 0);
    const waktuLokal = P.waktuUbah();

    if (pertamaKali && waktuJauh > waktuLokal && Array.isArray(jauh.items)) {
      P.timpaSemua(jauh.items, waktuJauh);
      if (jauh.akun && !P.akunku()) P.setAkunku(jauh.akun);
      gambarMasuk(`Daftar dari server dipakai — ${jauh.items.length} lelang.`);
      render();
      return;
    }

    await A.kirimKeServer(P.semua(), P.akunku());
    if (pertamaKali) gambarMasuk('Daftar di browser ini dikirim ke server.');
  } catch (e) {
    if (e.status === 401) {
      A.keluar();
      gambarMasuk('Sesi berakhir. Masuk lagi ya.', 'bad');
      return;
    }
    gambarMasuk('Gagal menyamakan: ' + e.message, 'bad');
  }
}

// ---------------------------------------------------------------- kalender

function tandaiGoogle(pesan, kelas = '') {
  const b = $('pgcal');
  const n = $('pgcalnote');
  if (!G.siap()) {
    b.textContent = 'Sinkron kalender belum disiapkan';
    b.classList.add('quiet');
    n.innerHTML = '<a href="https://github.com/bashideffendi/lelanginstagram/blob/main/PANDUAN-KALENDER.md" ' +
      'target="_blank" rel="noopener noreferrer">Cara menyiapkannya</a> — sekali saja, sekitar lima menit.';
    return;
  }
  b.textContent = G.terhubung() ? 'Putuskan Google Calendar' : 'Hubungkan Google Calendar';
  b.classList.toggle('quiet', G.terhubung());
  n.className = 'pgcal-note ' + kelas;
  n.textContent = pesan || (G.terhubung()
    ? 'Tersambung. Perubahan di sini langsung ikut di kalendermu.'
    : '');
}

async function hubungGoogle() {
  try {
    tandaiGoogle('Menunggu izin dari Google…');
    await G.hubungkan();
    tandaiGoogle('Tersambung. Menyamakan isi kalender…');
    await sinkronSekarang({ diam: false });
  } catch (e) {
    tandaiGoogle(e.message === 'belum_diizinkan'
      ? 'Izin belum diberikan.' : 'Gagal: ' + e.message, 'bad');
  }
}

function putusGoogle() {
  G.putuskan();
  tandaiGoogle('Sambungan diputus. Acara yang sudah ada di kalender tidak dihapus.');
}

/**
 * Samakan kalender dengan daftar pantauan.
 *
 * Dipanggil sesudah setiap perubahan, bukan lewat tombol tersendiri —
 * sinkron yang harus diingat untuk ditekan bukan sinkron namanya.
 */
async function sinkronSekarang({ diam = true } = {}) {
  if (!G.siap()) return;
  if (!G.terhubung()) {
    // Kalau izinnya sudah pernah diberikan, ini berjalan tanpa jendela apa pun.
    try { await G.hubungkan({ diam: true }); } catch { return; }
  }

  try {
    const h = await G.sinkron(P.semua(), deps.tz(), { simpan: P.simpan });
    const bagian = [];
    if (h.dibuat) bagian.push(`${h.dibuat} ditambahkan`);
    if (h.diperbarui) bagian.push(`${h.diperbarui} diperbarui`);
    if (h.dihapus) bagian.push(`${h.dihapus} dihapus`);
    tandaiGoogle(
      h.gagal.length
        ? `${h.gagal.length} gagal disinkronkan: ${h.gagal[0].pesan}`
        : (bagian.length ? 'Kalender disamakan — ' + bagian.join(', ') + '.' : 'Kalender sudah sama.'),
      h.gagal.length ? 'bad' : ''
    );
    if (!diam) render();
  } catch (e) {
    tandaiGoogle('Gagal menyinkronkan: ' + e.message, 'bad');
  }
}

// ---------------------------------------------------------------- tambah

async function tambahDariKotak() {
  const url = $('paddlink').value.trim();
  if (!url) { stat('Tempel dulu link lelangnya.', 'bad'); return; }
  if (!deps.linkSah(url)) {
    stat('Itu bukan link postingan. Bentuknya <code>instagram.com/p/XXXX/</code>.', 'bad');
    return;
  }

  $('paddgo').disabled = true;
  try {
    stat('Menarik keterangan lelang&hellip;');
    const dump = await deps.tarik(url, (p) => {
      if (p.stage === 'comments') stat(`Menarik komentar&hellip; ${p.count} terkumpul`);
    });

    const item = dariDump(dump);
    if (P.ambil(item.id)) stat('Lelang itu sudah ada di pantauan; keterangannya diperbarui.', 'ready');
    else stat('Ditambahkan ke pantauan.', 'ready');

    P.simpan(item);
    $('paddlink').value = '';
    render();
  } catch (e) {
    stat('Gagal: ' + esc(e.message), 'bad');
  } finally {
    $('paddgo').disabled = false;
  }
}

/** Susun catatan pantauan dari hasil penarikan. */
function dariDump(dump) {
  const src = dump.source || {};
  const caption = src.caption || '';
  const tutup = deps.hitungTutup(caption, dump.comments);

  const lama = P.ambil(src.shortcode || src.media_id) || {};
  const hasil = analyze(dump.comments, {
    cutoffEpoch: tutup ? tutup.epoch : null,
    ownerUsername: src.owner_username || null,
    captionText: caption
  });

  return {
    ...lama,
    id: src.shortcode || src.media_id,
    url: src.url || null,
    shortcode: src.shortcode || null,
    owner: src.owner_username || null,
    caption,
    title: P.tebakJudul(caption),
    openBid: hasil.summary.openBid ?? null,
    increment: P.tebakKelipatan(caption, parseBid),
    closeAt: tutup ? tutup.epoch : (lama.closeAt ?? null),
    closeSource: tutup ? 'caption' : (lama.closeSource ?? null),
    sniperMin: lama.sniperMin ?? 0,
    status: lama.status || 'aktif',
    addedAt: lama.addedAt || Math.floor(Date.now() / 1000),
    ...posisiDari(hasil)
  };
}

function posisiDari(hasil) {
  const w = hasil.summary.winner;
  const aku = P.akunku().toLowerCase();
  const punyaku = hasil.rows
    .filter((r) => (r.username || '').toLowerCase() === aku && r.bid != null)
    .sort((a, b) => b.bid - a.bid)[0];

  return {
    lastCheckedAt: Math.floor(Date.now() / 1000),
    topBid: w ? w.bid : null,
    topUser: w ? w.username : null,
    myBid: punyaku ? punyaku.bid : null,
    memimpin: !!(w && aku && (w.username || '').toLowerCase() === aku),
    peserta: hasil.summary.users
  };
}

// ---------------------------------------------------------------- tindakan

async function tanganiAksi(e) {
  const t = e.target.closest('[data-aksi]');
  if (!t) return;
  const id = t.closest('[data-id]')?.dataset.id;
  const item = P.ambil(id);
  if (!item) return;

  switch (t.dataset.aksi) {
    case 'cek': {
      t.disabled = true;
      const semula = t.textContent;
      t.textContent = 'Mengecek…';
      try {
        const dump = await deps.tarik(item.url);
        simpanDump(id, dump);
        P.simpan(dariDump(dump));
        render();
      } catch (err) {
        stat('Gagal mengecek: ' + esc(err.message), 'bad');
        t.disabled = false;
        t.textContent = semula;
      }
      break;
    }
    case 'ubah':
      sedangDiubah = id;
      render();
      break;

    case 'batal':
      sedangDiubah = null;
      render();
      break;

    case 'simpan': {
      const kartu = t.closest('[data-id]');
      const ambil = (f) => kartu.querySelector(`[data-f="${f}"]`)?.value ?? '';
      const catat = (pesan) => {
        const n = kartu.querySelector('#pformnote');
        if (n) { n.textContent = pesan; n.className = 'pform-note bad'; }
      };

      const baru = { ...item };
      baru.title = ambil('title').trim() || null;
      baru.sniperMin = +ambil('sniperMin') || 0;

      const ob = parseBid(ambil('openBid'));
      const inc = parseBid(ambil('increment'));
      baru.openBid = ambil('openBid').trim() ? ob.value : null;
      baru.increment = ambil('increment').trim() ? inc.value : null;

      const jam = ambil('jam').trim();
      const tgl = ambil('tgl').trim();
      if (jam || tgl) {
        const hasil = keEpoch(tgl, jam, deps.tz());
        if (hasil.galat) return catat(hasil.galat);
        baru.closeAt = hasil.epoch;
        baru.closeSource = 'manual';
      } else {
        baru.closeAt = null;
        baru.closeSource = null;
      }

      P.simpan(baru);
      sedangDiubah = null;
      render();
      stat('Keterangan lelang diperbarui.', 'ready');
      break;
    }

    case 'tebakulang': {
      if (!item.caption) { stat('Caption postingannya tidak tersimpan — tarik ulang lewat "Cek posisi".', 'bad'); break; }
      const tutup = deps.hitungTutup(item.caption, []);
      const kartu2 = t.closest('[data-id]');
      const set = (f, v) => { const e = kartu2.querySelector(`[data-f="${f}"]`); if (e) e.value = v; };
      set('title', P.tebakJudul(item.caption) || '');
      set('openBid', '');
      set('increment', '');
      if (tutup) {
        set('jam', fmtTime(tutup.epoch, deps.tz()));
        set('tgl', fmtDate(tutup.epoch, deps.tz()));
      }
      const n = kartu2.querySelector('#pformnote');
      if (n) { n.textContent = 'Ditebak ulang dari caption. Periksa sebelum menyimpan.'; n.className = 'pform-note'; }
      break;
    }

    case 'ics':
      deps.unduh(`lelang-${item.id}.ics`, P.buatIcs([item]), 'text/calendar;charset=utf-8');
      stat('Berkas kalender diunduh. Buka berkasnya di ponsel untuk memasang pengingatnya.', 'ready');
      break;
    case 'buka':
      // Kalau hasil tarikannya masih ada, langsung dipakai — tidak perlu
      // menempel ulang link maupun menunggu penarikan kedua.
      if (dumpTerakhir.has(id)) deps.bukaAnalisis(null, dumpTerakhir.get(id), item);
      else deps.bukaAnalisis(item.url, null, item);
      break;
    case 'hapus':
      if (confirm(`Hapus "${item.title || item.id}" dari pantauan?`)) {
        // Acaranya ikut dihapus dari kalender, bukan ditinggal jadi sampah.
        if (item.gcalId && G.terhubung()) {
          G.hapusAcara(item.gcalId).catch(() => {});
        }
        P.hapus(id);
        render();
      }
      break;
  }
}

function tanganiUbah(e) {
  const el = e.target;

  // Hanya kendali di kartu ringkas yang menyimpan seketika. Kolom di dalam
  // form sunting punya tombol Simpan sendiri; menggambar ulang di sini
  // menghapus yang baru diketik begitu pindah kolom — persis seperti kolomnya
  // tidak bisa diisi.
  const jenis = el.dataset.ubah;
  if (!jenis) return;

  const id = el.closest('[data-id]')?.dataset.id;
  const item = P.ambil(id);
  if (!item) return;

  if (jenis === 'status') {
    P.simpan({ ...item, status: el.value });
    // Kartunya pindah tab, jadi terlihat seperti menghilang. Sebut ke mana.
    const keSelesai = SELESAI.has(el.value);
    if (keSelesai !== (subTab === 'selesai')) {
      stat(`"${esc(item.title || item.id)}" dipindahkan ke tab ` +
        `<b>${keSelesai ? 'Riwayat' : 'Berjalan'}</b>.`, 'ready');
    }
  } else if (jenis === 'final') {
    const v = parseBid(el.value);
    P.simpan({ ...item, finalPrice: v.value });
  } else if (jenis === 'sniper') {
    P.simpan({ ...item, sniperMin: +el.value || 0 });
  }
  render();
}

// ---------------------------------------------------------------- gambar

function sisaWaktu(epoch) {
  const detik = epoch - Math.floor(Date.now() / 1000);
  if (detik <= 0) return { teks: 'sudah tutup', lewat: true, mendesak: false };
  return {
    teks: fmtDuration(detik) + ' lagi',
    lewat: false,
    mendesak: detik <= 3600
  };
}

/** Sidik isi daftar; acara kalender hanya perlu disamakan kalau ini berubah. */
function sidik(daftar) {
  return daftar.map((x) =>
    [x.id, x.status, x.closeAt, x.title, x.openBid, x.increment, x.sniperMin, x.topBid]
      .join('|')).join('||');
}

let sidikTerakhir = null;
let tundaSinkron = null;

export function render() {
  const daftar = P.semua();

  // Sinkron dipicu oleh perubahan isi, bukan oleh tombol. Ditunda sebentar
  // supaya beberapa perubahan beruntun jadi satu putaran saja.
  const s = sidik(daftar);
  if (sidikTerakhir !== null && s !== sidikTerakhir) {
    clearTimeout(tundaSinkron);
    tundaSinkron = setTimeout(() => {
      if (G.siap()) sinkronSekarang({ diam: true });
      if (A.sudahMasuk()) samakanServer();
    }, 700);
  }
  sidikTerakhir = s;

  const jalan = daftar.filter((x) => !SELESAI.has(x.status));
  const selesai = daftar.filter((x) => SELESAI.has(x.status));

  $('c-pantau').textContent = jalan.length || '';
  $('c-jalan').textContent = jalan.length || '';
  $('c-selesai').textContent = selesai.length || '';
  for (const b of $('ptab').querySelectorAll('[data-ptab]')) {
    b.classList.toggle('on', b.dataset.ptab === subTab);
  }

  const tz = deps.tz();
  const riwayatTampil = subTab === 'selesai';
  $('priwayat').classList.toggle('hidden', !riwayatTampil);

  // Yang paling dekat tutup naik ke atas; yang belum punya jam tutup ke bawah.
  // Di riwayat urutannya terbalik — yang paling baru selesai yang dicari.
  const tampil = riwayatTampil
    ? selesai.slice().sort((a, b) => (b.closeAt ?? 0) - (a.closeAt ?? 0))
    : jalan.slice().sort((a, b) => (a.closeAt ?? Infinity) - (b.closeAt ?? Infinity));

  if (!tampil.length) {
    $('plist').innerHTML = `<p class="kosong">${riwayatTampil
      ? 'Belum ada lelang yang ditandai selesai. Tandai <b>menang</b> atau <b>kalah</b> ' +
        'di kartu lelang, dan lelangnya pindah ke sini.'
      : 'Belum ada lelang dipantau. Tempel link lelang di atas, dan jam tutupnya ' +
        'akan dibaca sendiri dari caption postingannya.'}</p>`;
  } else {
    $('plist').innerHTML = tampil.map((it) => kartu(it, tz)).join('');
  }

  $('priwayat').innerHTML = riwayatTampil ? riwayat(tz) : '';
}

/** Hitung mundur ringkas: berdetik saat mepet, berjam saat masih lama. */
function mundur(detik) {
  if (detik <= 0) return 'tutup';
  const j = Math.floor(detik / 3600);
  const m = Math.floor((detik % 3600) / 60);
  const d = detik % 60;
  const p = (n) => String(n).padStart(2, '0');
  if (detik < 3600) return `${m}:${p(d)}`;
  if (detik < 86400) return `${j}:${p(m)}:${p(d)}`;
  return `${Math.floor(detik / 86400)} hari ${j % 24} jam`;
}

/**
 * Warna kartu menandai keadaan, bukan menghias.
 *
 * Semua kartu berwarna sama membuat mata tidak punya pegangan: yang genting
 * dan yang masih berhari-hari lagi terlihat setara. Urutan pemeriksaannya
 * disusun dari yang paling menuntut tindakan.
 */
export function nadaKartu(it) {
  if (it.status === 'menang') return 'menang';
  if (it.status === 'kalah') return 'kalah';
  if (it.status === 'batal') return 'batal';

  const sisa = it.closeAt != null ? sisaWaktu(it.closeAt) : null;
  if (sisa?.lewat) return 'lewat';
  // Tersalip lebih mendesak daripada sekadar mepet waktu: ada yang harus
  // kamu putuskan, bukan sekadar ditunggu.
  if (it.myBid != null && !it.memimpin) return 'tersalip';
  if (sisa?.mendesak) return 'mendesak';
  if (it.memimpin) return 'memimpin';
  return 'jalan';
}

function kartu(it, tz) {
  if (sedangDiubah === it.id) return formUbah(it, tz);

  const sisa = it.closeAt != null ? sisaWaktu(it.closeAt) : null;
  const aktif = it.status === 'aktif';
  const nada = nadaKartu(it);

  const detik = it.closeAt != null ? it.closeAt - Math.floor(Date.now() / 1000) : null;
  const url = it.url || (it.shortcode ? 'https://www.instagram.com/p/' + it.shortcode + '/' : null);

  // Satu angka besar saja: harga tertinggi sekarang. Sisanya keterangan kecil
  // dalam satu baris — daftar berlabel yang dulu membuat tiap kartu terbaca
  // seperti formulir.
  const meta = [];
  if (it.closeAt != null) meta.push(`tutup ${fmtTime(it.closeAt, tz)} &middot; ${fmtDate(it.closeAt, tz)}`);
  if (it.openBid != null) {
    meta.push(`buka Rp${fmtRupiah(it.openBid)}` +
      (it.increment != null ? ` &middot; naik Rp${fmtRupiah(it.increment)}` : ''));
  }
  if (it.sniperMin) meta.push(`sniper ${it.sniperMin} mnt`);
  if (it.peserta) meta.push(`${it.peserta} peserta`);

  const status = Object.entries(P.STATUS).map(([k, v]) =>
    `<option value="${k}"${it.status === k ? ' selected' : ''}>${v}</option>`).join('');

  return `<article class="pcard-item ${nada}" data-id="${esc(it.id)}">
    <div class="pk-atas">
      <div class="pk-judul">
        <h3>${esc(it.title || it.id)}</h3>
        <p>${url
          ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">` +
            `${it.owner ? '@' + esc(it.owner) : 'buka di Instagram'} &#8599;</a>`
          : `<span class="dim">${it.owner ? '@' + esc(it.owner) : 'penjual tidak diketahui'}</span>`}</p>
      </div>
      ${aktif && detik != null
        ? `<div class="pk-mundur ${nada}"><span class="jam">${mundur(detik)}</span>` +
          `<span class="ket">${detik > 0 ? 'lagi' : 'sudah tutup'}</span></div>`
        : `<span class="tag ${it.status === 'menang' ? 'new' : 'same'}">${P.STATUS[it.status]}</span>`}
    </div>

    <div class="pk-harga">
      ${it.topBid != null
        ? `<b>Rp${fmtRupiah(it.topBid)}</b><span class="ket">tertinggi` +
          `${it.topUser ? ' &middot; @' + esc(it.topUser) : ''}</span>`
        : '<b class="dim">belum dicek</b>'}
      ${it.memimpin ? '<span class="tag win">kamu memimpin</span>' : ''}
      ${it.myBid != null && !it.memimpin
        ? `<span class="tag same">tawaranmu Rp${fmtRupiah(it.myBid)}</span>` : ''}
      <span class="fill"></span>
      <span class="pk-segar" data-segar>${it.lastCheckedAt
        ? 'dicek ' + fmtTime(it.lastCheckedAt, tz) : ''}</span>
    </div>

    ${meta.length ? `<p class="pk-meta">${meta.join('  &middot;  ')}</p>` : ''}

    <div class="paksi">
      <button class="btn sm" data-aksi="buka">Lihat urutan tawaran</button>
      ${aktif ? '<button class="btn sm quiet" data-aksi="cek">Cek sekarang</button>' : ''}
      <button class="btn sm quiet" data-aksi="ubah">Ubah</button>
      <select class="psel" data-ubah="status">${status}</select>
      ${it.status === 'menang' || it.status === 'kalah'
        ? `<input class="pharga" data-ubah="final" placeholder="harga akhir"
             value="${it.finalPrice != null ? 'Rp' + fmtRupiah(it.finalPrice) : ''}">`
        : ''}
      <span class="fill"></span>
      ${aktif ? '<button class="btn sm quiet" data-aksi="ics" title="Unduh berkas kalender">Kalender</button>' : ''}
      <button class="btn sm quiet" data-aksi="hapus">Hapus</button>
    </div>
  </article>`;
}

/**
 * Semua isian bisa diperbaiki sendiri.
 *
 * Keterangan lelang ditebak dari caption, dan caption ditulis manusia dengan
 * gaya yang bermacam-macam — tebakan pasti meleset kadang-kadang. Alat yang
 * menebak tapi tidak bisa dikoreksi lebih berbahaya daripada tidak menebak
 * sama sekali, karena kesalahannya diam.
 */
function formUbah(it, tz) {
  const jam = it.closeAt != null ? fmtTime(it.closeAt, tz) : '';
  const tgl = it.closeAt != null ? fmtDate(it.closeAt, tz) : '';
  const rp = (v) => (v != null ? 'Rp' + fmtRupiah(v) : '');

  const sniper = [0, 3, 5, 10, 15, 30, 60].map((m) =>
    `<option value="${m}"${(it.sniperMin || 0) === m ? ' selected' : ''}>` +
    `${m ? m + ' menit terakhir' : 'Tidak ada'}</option>`).join('');

  return `<article class="pcard-item sunting" data-id="${esc(it.id)}">
    <div class="pk-atas"><div class="pk-judul"><h3>Ubah keterangan lelang</h3>
      <p class="dim">Isian di bawah ditebak dari caption. Perbaiki yang salah.</p></div></div>

    <div class="pform">
      <label><span>Barang</span>
        <input data-f="title" value="${esc(it.title || '')}" placeholder="nama barang"></label>

      <label><span>Jam tutup</span>
        <input data-f="jam" value="${esc(jam)}" placeholder="20:30:00" class="mn"></label>

      <label><span>Tanggal tutup</span>
        <input data-f="tgl" value="${esc(tgl)}" placeholder="03/08/2026" class="mn"></label>

      <label><span>Harga pembukaan</span>
        <input data-f="openBid" value="${esc(rp(it.openBid))}" placeholder="750rb atau 750000"></label>

      <label><span>Kelipatan</span>
        <input data-f="increment" value="${esc(rp(it.increment))}" placeholder="50rb"></label>

      <label><span>Sniper zone</span>
        <select data-f="sniperMin">${sniper}</select></label>
    </div>

    <p class="pform-note" id="pformnote"></p>

    <div class="paksi">
      <button class="btn sm solid" data-aksi="simpan">Simpan</button>
      <button class="btn sm" data-aksi="batal">Batal</button>
      <span class="fill"></span>
      <button class="btn sm quiet" data-aksi="tebakulang">Tebak ulang dari caption</button>
    </div>
  </article>`;
}

function riwayat(tz) {
  const r = P.riwayatHarga();
  if (!r.jumlah) return '';

  const baris = r.items.map((x) => `<tr>
    <td data-l="Barang">${esc(x.title || x.id)}</td>
    <td data-l="Tutup" class="clock">${x.closeAt != null ? fmtDate(x.closeAt, tz) : '—'}</td>
    <td data-l="Hasil">${x.status === 'menang'
      ? '<span class="tag new">menang</span>' : '<span class="tag same">kalah</span>'}</td>
    <td data-l="Harga akhir" class="money">Rp${fmtRupiah(x.finalPrice)}</td>
  </tr>`).join('');

  return `<h3 class="psub">Riwayat harga</h3>
    <p class="tabnote">Dari ${r.jumlah} lelang yang sudah selesai dan kamu catat harganya.
      Berguna menentukan batas atas sebelum ikut lelang berikutnya.</p>
    <div class="chips">
      ${chip(r.jumlah, 'Tercatat')}
      ${chip(r.menang, 'Menang', r.menang ? 'good' : '')}
      ${chip('Rp' + fmtRupiah(r.tengah), 'Harga tengah', 'on')}
      ${chip('Rp' + fmtRupiah(r.terendah) + '–' + fmtRupiah(r.tertinggi), 'Rentang')}
    </div>
    <div class="sheet"><table><thead><tr>
      <th class="nosort">Barang</th><th class="nosort">Tutup</th>
      <th class="nosort">Hasil</th><th class="nosort">Harga akhir</th>
    </tr></thead><tbody>${baris}</tbody></table></div>`;
}

function chip(n, k, cls = '') {
  return `<div class="chip ${cls}"><div class="n">${n}</div><div class="k">${k}</div></div>`;
}

/** Hitung mundur diperbarui tiap detik, tapi hanya saat halamannya terlihat. */
export function mulaiDetak(aktif) {
  clearInterval(detak);
  clearInterval(pemburu);
  if (!aktif) return;

  detak = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const el of document.querySelectorAll('#plist [data-id]')) {
      const it = P.ambil(el.dataset.id);
      if (!it || it.status !== 'aktif' || it.closeAt == null) continue;

      const kotak = el.querySelector('.pk-mundur .jam');
      if (!kotak) continue;                       // kartu sedang disunting

      // Warnanya ikut berubah sendiri saat lelang masuk jam genting, tanpa
      // menunggu penarikan berikutnya.
      const nada = nadaKartu(it);
      kotak.textContent = mundur(it.closeAt - now);
      el.querySelector('.pk-mundur').className = 'pk-mundur ' + nada;
      el.className = 'pcard-item ' + nada;
    }
  }, 1000);

  // Posisi diperbarui sendiri. Alat ini ada supaya kamu tidak perlu ingat;
  // menuntut klik "Cek posisi" mengembalikan beban yang mau dihilangkan.
  pemburu = setInterval(perbaruiYangJatuhTempo, 20000);
  perbaruiYangJatuhTempo();
}

/**
 * Seberapa sering satu lelang perlu diperiksa.
 *
 * Makin dekat penutupan makin sering, karena di situlah harga berubah cepat.
 * Yang masih berhari-hari lagi cukup sesekali — server punya batas laju, dan
 * memboroskannya pada lelang yang belum bergerak berarti lelang yang genting
 * kehabisan jatah.
 */
function jarakCek(detikTersisa) {
  if (detikTersisa <= 0) return null;
  if (detikTersisa < 600) return 45;
  if (detikTersisa < 3600) return 120;
  if (detikTersisa < 6 * 3600) return 600;
  return 1800;
}

let sedangCek = false;

async function perbaruiYangJatuhTempo() {
  if (sedangCek || document.hidden) return;
  if (deps.tampilPantau && !deps.tampilPantau()) return;
  // Menggambar ulang di tengah penyuntingan menghapus ketikan yang belum
  // disimpan. Pemeriksaannya bisa menunggu; ketikan yang hilang tidak.
  if (sedangDiubah) return;

  const now = Math.floor(Date.now() / 1000);
  const antre = P.semua().filter((it) => {
    if (it.status !== 'aktif' || !it.url || it.closeAt == null) return false;
    const jarak = jarakCek(it.closeAt - now);
    if (jarak == null) return false;
    return now - (it.lastCheckedAt || 0) >= jarak;
  });
  if (!antre.length) return;

  // Satu per satu, bukan sekaligus: penarikan serempak paling cepat memicu
  // pembatasan dari Instagram.
  sedangCek = true;
  try {
    const it = antre.sort((a, b) => a.closeAt - b.closeAt)[0];
    tandaiSegar(it.id, 'memeriksa…');
    const dump = await deps.tarik(it.url);
    simpanDump(it.id, dump);
    P.simpan(dariDump(dump));
    render();
  } catch {
    // Gagal sesekali itu wajar — dicoba lagi pada putaran berikutnya.
  } finally {
    sedangCek = false;
  }
}

function tandaiSegar(id, teks) {
  const el = document.querySelector(`#plist [data-id="${CSS.escape(id)}"] [data-segar]`);
  if (el) el.textContent = teks;
}
