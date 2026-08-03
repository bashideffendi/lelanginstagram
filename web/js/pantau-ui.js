/**
 * Tampilan pantauan lelang.
 *
 * Modul ini hanya menyusun tampilan dan mengatur tindakan. Penarikan komentar
 * dan perhitungan jam tutup diserahkan lewat `deps`, supaya mesin yang sudah
 * dipakai halaman analisis tidak perlu disalin ke sini.
 */

import * as P from './pantau.js';
import { analyze, parseBid, fmtRupiah } from './analysis.js';
import { fmtDateTime, fmtTime, fmtDate, fmtDuration, wallTimeToEpoch } from './time.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let deps = null;
let detak = null;
let sedangDiubah = null;      // id lelang yang sedang disunting

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
}

function stat(teks, kelas = '') {
  $('paddstat').className = 'take-stat ' + kelas;
  $('paddstat').innerHTML = teks;
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
      deps.bukaAnalisis(item.url);
      break;
    case 'hapus':
      if (confirm(`Hapus "${item.title || item.id}" dari pantauan?`)) {
        P.hapus(id);
        render();
      }
      break;
  }
}

function tanganiUbah(e) {
  const el = e.target;
  const id = el.closest('[data-id]')?.dataset.id;
  const item = P.ambil(id);
  if (!item) return;

  if (el.dataset.ubah === 'status') {
    P.simpan({ ...item, status: el.value });
  } else if (el.dataset.ubah === 'final') {
    const v = parseBid(el.value);
    P.simpan({ ...item, finalPrice: v.value });
  } else if (el.dataset.ubah === 'sniper') {
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

export function render() {
  const daftar = P.semua();
  $('c-pantau').textContent = daftar.filter((x) => x.status === 'aktif').length || '';

  if (!daftar.length) {
    $('plist').innerHTML =
      '<p class="kosong">Belum ada lelang dipantau. Tempel link lelang di atas, ' +
      'dan jam tutupnya akan dibaca sendiri dari caption postingannya.</p>';
    $('priwayat').innerHTML = '';
    return;
  }

  const tz = deps.tz();
  $('plist').innerHTML = daftar.map((it) => kartu(it, tz)).join('');
  $('priwayat').innerHTML = riwayat(tz);
}

function isi(label, nilai, sub) {
  return `<div class="pit"><span class="pl">${label}</span>` +
    `<span class="pv">${nilai}${sub ? ` <span class="dim">${sub}</span>` : ''}</span></div>`;
}

function kartu(it, tz) {
  if (sedangDiubah === it.id) return formUbah(it, tz);

  const sisa = it.closeAt != null ? sisaWaktu(it.closeAt) : null;
  const aktif = it.status === 'aktif';
  const nada = !aktif ? '' : sisa?.lewat ? 'lewat' : sisa?.mendesak ? 'mendesak' : '';

  const baris = [];
  baris.push(isi('Tutup',
    it.closeAt != null
      ? `<b>${fmtTime(it.closeAt, tz)}</b>`
      : '<span class="dim">belum diisi</span>',
    it.closeAt != null ? fmtDate(it.closeAt, tz) : ''));

  baris.push(isi('Pembukaan',
    it.openBid != null ? 'Rp' + fmtRupiah(it.openBid) : '<span class="dim">—</span>',
    it.increment != null ? 'kelipatan Rp' + fmtRupiah(it.increment) : ''));

  if (it.topBid != null) {
    baris.push(isi('Tertinggi', 'Rp' + fmtRupiah(it.topBid), '@' + esc(it.topUser || '?')));
  }
  if (it.myBid != null) baris.push(isi('Tawaranku', 'Rp' + fmtRupiah(it.myBid)));
  if (it.sniperMin) baris.push(isi('Sniper zone', it.sniperMin + ' menit terakhir'));
  if (it.lastCheckedAt) {
    baris.push(isi('Dicek', `<span class="dim">${fmtDateTime(it.lastCheckedAt, tz)}</span>`));
  }

  const status = Object.entries(P.STATUS).map(([k, v]) =>
    `<option value="${k}"${it.status === k ? ' selected' : ''}>${v}</option>`).join('');

  return `<article class="pcard-item ${nada}" data-id="${esc(it.id)}">
    <header>
      <div class="pjudul">
        <h3>${esc(it.title || it.id)}</h3>
        <p class="dim">${it.owner ? '@' + esc(it.owner) : 'penjual tidak diketahui'}</p>
      </div>
      <div class="pkanan">
        ${aktif && sisa ? `<div class="psisa ${nada}">${esc(sisa.teks)}</div>` : ''}
        ${it.memimpin ? '<span class="tag win">memimpin</span>' : ''}
      </div>
    </header>

    <div class="pinfo">${baris.join('')}</div>

    <div class="paksi">
      <button class="btn sm" data-aksi="cek">Cek posisi</button>
      <button class="btn sm" data-aksi="ubah">Ubah</button>
      <button class="btn sm" data-aksi="ics">Ingatkan</button>
      <button class="btn sm" data-aksi="buka">Analisis</button>
      <select class="psel" data-ubah="status">${status}</select>
      ${it.status === 'menang' || it.status === 'kalah'
        ? `<input class="pharga" data-ubah="final" placeholder="harga akhir"
             value="${it.finalPrice != null ? 'Rp' + fmtRupiah(it.finalPrice) : ''}">`
        : ''}
      <span class="fill"></span>
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
    <header><div class="pjudul"><h3>Ubah keterangan lelang</h3>
      <p class="dim">Isian di bawah ditebak dari caption. Perbaiki yang salah.</p></div></header>

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
  if (!aktif) return;
  detak = setInterval(() => {
    const tz = deps.tz();
    for (const el of document.querySelectorAll('#plist [data-id]')) {
      const it = P.ambil(el.dataset.id);
      if (!it || it.status !== 'aktif' || it.closeAt == null) continue;
      const s = sisaWaktu(it.closeAt);
      const box = el.querySelector('.psisa');
      if (box) {
        box.textContent = s.teks;
        box.className = 'psisa ' + (s.lewat ? 'lewat' : s.mendesak ? 'mendesak' : '');
        el.className = 'pcard-item ' + (s.lewat ? 'lewat' : s.mendesak ? 'mendesak' : '');
      }
    }
  }, 1000);
}
