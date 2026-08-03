/**
 * Tampilan pantauan lelang.
 *
 * Modul ini hanya menyusun tampilan dan mengatur tindakan. Penarikan komentar
 * dan perhitungan jam tutup diserahkan lewat `deps`, supaya mesin yang sudah
 * dipakai halaman analisis tidak perlu disalin ke sini.
 */

import * as P from './pantau.js';
import { analyze, parseBid, fmtRupiah } from './analysis.js';
import { fmtDateTime, fmtTime, fmtDate, fmtDuration } from './time.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let deps = null;
let detak = null;

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
    case 'ics':
      deps.unduh(`lelang-${item.id}.ics`, P.buatIcs([item]), 'text/calendar;charset=utf-8');
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

function kartu(it, tz) {
  const sisa = it.closeAt != null ? sisaWaktu(it.closeAt) : null;
  const aktif = it.status === 'aktif';

  const nada = !aktif ? '' : sisa?.lewat ? 'lewat' : sisa?.mendesak ? 'mendesak' : '';

  const baris = [];
  if (it.closeAt != null) {
    baris.push(`<div><span class="pl">Tutup</span>` +
      `<b>${fmtTime(it.closeAt, tz)}</b> <span class="dim">${fmtDate(it.closeAt, tz)}</span></div>`);
  } else {
    baris.push('<div><span class="pl">Tutup</span><span class="dim">tidak terbaca dari caption</span></div>');
  }
  if (it.openBid != null) {
    baris.push(`<div><span class="pl">Pembukaan</span>Rp${fmtRupiah(it.openBid)}` +
      (it.increment != null ? ` <span class="dim">kelipatan Rp${fmtRupiah(it.increment)}</span>` : '') +
      '</div>');
  }
  if (it.topBid != null) {
    baris.push(`<div><span class="pl">Tertinggi</span>Rp${fmtRupiah(it.topBid)}` +
      ` <span class="dim">oleh @${esc(it.topUser || '?')}</span></div>`);
  }
  if (it.myBid != null) {
    baris.push(`<div><span class="pl">Tawaranku</span>Rp${fmtRupiah(it.myBid)}</div>`);
  }
  if (it.lastCheckedAt) {
    baris.push(`<div><span class="pl">Dicek</span><span class="dim">${fmtDateTime(it.lastCheckedAt, tz)}</span></div>`);
  }

  const status = Object.entries(P.STATUS).map(([k, v]) =>
    `<option value="${k}"${it.status === k ? ' selected' : ''}>${v}</option>`).join('');

  return `<article class="pcard-item ${nada}" data-id="${esc(it.id)}">
    <header>
      <div class="pjudul">
        <h3>${esc(it.title || it.id)}</h3>
        <p class="dim">${it.owner ? '@' + esc(it.owner) : 'penjual tidak diketahui'}</p>
      </div>
      ${aktif && sisa ? `<div class="psisa ${nada}">${esc(sisa.teks)}</div>` : ''}
      ${it.memimpin ? '<span class="tag win">memimpin</span>' : ''}
    </header>

    <div class="pinfo">${baris.join('')}</div>

    <div class="paksi">
      <button class="btn sm" data-aksi="cek">Cek posisi</button>
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
