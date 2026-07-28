/**
 * Kartu bukti sebagai gambar.
 *
 * Digambar sendiri di kanvas, bukan tangkapan layar halaman. Alasannya:
 * tangkapan layar ikut membawa tombol, kotak isian, dan potongan tabel yang
 * terpotong sembarang — sementara yang dikirim ke penyelenggara sebaiknya
 * hanya keterangan yang dibutuhkan, lengkap dan urut.
 *
 * Tanpa pustaka luar. Huruf memakai yang sudah dimuat halaman.
 */

import { fmtRupiah } from './analysis.js';
import { fmtDateTime, fmtTime, fmtDate, fmtDuration } from './time.js';

const L = 1080;                 // lebar gambar
const PAD = 56;
const SANS = '"Plus Jakarta Sans", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const WARNA = {
  kertas: '#FFFFFF',
  tinta: '#15171B',
  lembut: '#4B505A',
  redup: '#6B7079',
  garis: '#E9ECF0',
  garis2: '#D6DAE0',
  hijau: '#0E8A5F',
  merah: '#C0432F',
  merahMuda: '#FBEDEB',
  kuning: '#B4690E',
  kuningMuda: '#FDF5E8'
};

/** Pembungkus kanvas dengan penempatan berurut dari atas ke bawah. */
function kanvas() {
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  let y = 0;

  const api = {
    ctx: x,
    get y() { return y; },
    set y(v) { y = v; },

    ukur(teks, font) { x.font = font; return x.measureText(teks).width; },

    tulis(teks, { font = `400 15px ${SANS}`, warna = WARNA.tinta, kiri = PAD, kanan = null, baseline = 'alphabetic' } = {}) {
      x.font = font;
      x.fillStyle = warna;
      x.textBaseline = baseline;
      if (kanan != null) x.fillText(teks, kanan - x.measureText(teks).width, y);
      else x.fillText(teks, kiri, y);
    },

    /** Tulis dengan pemenggalan baris; kembalikan tinggi yang terpakai. */
    paragraf(teks, { font = `400 15px ${SANS}`, warna = WARNA.lembut, kiri = PAD, lebar = L - PAD * 2, tinggiBaris = 22 } = {}) {
      x.font = font;
      x.fillStyle = warna;
      x.textBaseline = 'alphabetic';
      const kata = String(teks).split(/\s+/);
      let baris = '';
      let dipakai = 0;
      for (const w of kata) {
        const coba = baris ? baris + ' ' + w : w;
        if (x.measureText(coba).width > lebar && baris) {
          x.fillText(baris, kiri, y + dipakai);
          dipakai += tinggiBaris;
          baris = w;
        } else baris = coba;
      }
      if (baris) { x.fillText(baris, kiri, y + dipakai); dipakai += tinggiBaris; }
      return dipakai;
    },

    garis(warna = WARNA.garis, tebal = 1) {
      x.fillStyle = warna;
      x.fillRect(PAD, y, L - PAD * 2, tebal);
    },

    kotak(tinggi, isi, tepiKiri = null) {
      x.fillStyle = isi;
      x.fillRect(PAD, y, L - PAD * 2, tinggi);
      if (tepiKiri) { x.fillStyle = tepiKiri; x.fillRect(PAD, y, 3, tinggi); }
    }
  };
  return { c, api };
}

/** Potong teks agar muat dalam lebar tertentu. */
function potong(api, teks, font, lebar) {
  const s = String(teks ?? '');
  if (api.ukur(s, font) <= lebar) return s;
  let hasil = s;
  while (hasil.length > 1 && api.ukur(hasil + '…', font) > lebar) hasil = hasil.slice(0, -1);
  return hasil + '…';
}

/**
 * @param model {result, primary, tz, tzShort, hash, sniperMin}
 * @returns {Promise<Blob>}
 */
export async function gambarBukti(model) {
  const { result, primary, tz, hash, sniperMin } = model;
  const s = result.summary;
  const src = primary.source || {};
  const w = s.winner;

  // Baris yang ditampilkan: seluruh tawaran, dibatasi agar gambar tidak
  // menjadi terlalu panjang untuk dikirim lewat pesan.
  const semua = result.rows.filter((r) => !r.isOwner && !r.isAnnouncement);
  const BATAS = 18;
  const dipotong = Math.max(0, semua.length - BATAS);
  const baris = semua.slice(-BATAS).reverse();          // terbaru di atas

  const { c, api } = kanvas();
  const ctx = api.ctx;

  // --- ukur tinggi lebih dulu, supaya kanvasnya pas
  const tinggiTemuan = 34;
  const tinggiBaris = 34;
  let tinggi = PAD;
  tinggi += 26 + 18;                                    // kepala
  tinggi += 28;                                         // sumber
  tinggi += 40 + 52 + 26 + (w && w.text ? 26 : 0);      // blok pemenang
  const temuan = daftarTemuan(model);
  tinggi += 30 + temuan.length * tinggiTemuan;
  tinggi += 34 + 26 + baris.length * tinggiBaris + (dipotong ? 26 : 0);
  if (s.cutoff != null) tinggi += 30;                   // garis penutupan
  if (s.sniper && s.sniper.aktif) tinggi += 30;
  tinggi += 30 + 60 + PAD;                              // kaki

  const dpr = 2;
  c.width = L * dpr;
  c.height = Math.ceil(tinggi) * dpr;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = WARNA.kertas;
  ctx.fillRect(0, 0, L, tinggi);

  // --- kepala
  api.y = PAD + 6;
  api.tulis('Lelang', { font: `800 22px ${SANS}` });
  const lebarLelang = api.ukur('Lelang', `800 22px ${SANS}`);
  api.tulis('Insta', { font: `800 22px ${SANS}`, warna: WARNA.hijau, kiri: PAD + lebarLelang });
  api.tulis(`Dibuat ${fmtDateTime(Math.floor(Date.now() / 1000), tz)} ${model.tzShort}`, {
    font: `400 12px ${MONO}`, warna: WARNA.redup, kanan: L - PAD
  });

  api.y += 16;
  api.garis(WARNA.tinta, 2);
  api.y += 26;

  // --- sumber
  const sumber = [
    src.owner_username ? '@' + src.owner_username : null,
    src.shortcode ? 'instagram.com/p/' + src.shortcode : null
  ].filter(Boolean).join('  ·  ');
  api.tulis(potong(api, sumber, `400 13px ${MONO}`, L - PAD * 2), {
    font: `400 13px ${MONO}`, warna: WARNA.redup
  });
  api.y += 34;

  // --- pemenang
  api.tulis('TAWARAN TERTINGGI YANG SAH', {
    font: `500 11px ${MONO}`, warna: WARNA.redup
  });
  api.y += 46;

  if (w) {
    const nama = '@' + (w.username || 'tidak diketahui');
    api.tulis(potong(api, nama, `800 34px ${SANS}`, 620), { font: `800 34px ${SANS}` });
    api.tulis('Rp' + fmtRupiah(w.bid), {
      font: `600 30px ${MONO}`, warna: WARNA.hijau, kanan: L - PAD
    });
    api.y += 30;
    const rel = s.cutoff != null && w.created_at <= s.cutoff
      ? `  ·  ${fmtDuration(s.cutoff - w.created_at)} sebelum tutup` : '';
    api.tulis(`${fmtDateTime(w.created_at, tz)} ${model.tzShort}${rel}`, {
      font: `400 14px ${MONO}`, warna: WARNA.lembut
    });
    api.y += 24;
    if (w.text) {
      api.tulis(potong(api, '“' + w.text.replace(/\s+/g, ' ') + '”', `400 14px ${SANS}`, L - PAD * 2), {
        font: `400 14px ${SANS}`, warna: WARNA.redup
      });
      api.y += 26;
    }
  } else {
    api.tulis('Tidak ada tawaran yang terbaca', { font: `600 22px ${SANS}`, warna: WARNA.redup });
    api.y += 30;
  }

  api.y += 6;
  api.garis();
  api.y += 30;

  // --- temuan
  for (const t of temuan) {
    api.kotak(tinggiTemuan - 8, t.nada === 'bad' ? WARNA.merahMuda : t.nada === 'warn' ? WARNA.kuningMuda : '#EDF7F2',
      t.nada === 'bad' ? WARNA.merah : t.nada === 'warn' ? WARNA.kuning : WARNA.hijau);
    api.y += 18;
    api.tulis(potong(api, t.teks, `600 14px ${SANS}`, L - PAD * 2 - 28),
      { font: `600 14px ${SANS}`, warna: t.nada === 'bad' ? WARNA.merah : t.nada === 'warn' ? WARNA.kuning : WARNA.hijau, kiri: PAD + 14 });
    api.y += tinggiTemuan - 18;
  }

  api.y += 12;

  // --- tabel
  api.tulis('URUTAN TAWARAN', { font: `500 11px ${MONO}`, warna: WARNA.redup });
  api.y += 22;
  api.garis(WARNA.garis2);
  api.y += 22;

  const KOL = { jam: PAD, akun: PAD + 130, nilai: PAD + 470, tanda: PAD + 660 };
  api.tulis('JAM', { font: `500 10px ${MONO}`, warna: WARNA.redup, kiri: KOL.jam });
  api.tulis('AKUN', { font: `500 10px ${MONO}`, warna: WARNA.redup, kiri: KOL.akun });
  api.tulis('NILAI', { font: `500 10px ${MONO}`, warna: WARNA.redup, kiri: KOL.nilai });
  api.tulis('CATATAN', { font: `500 10px ${MONO}`, warna: WARNA.redup, kiri: KOL.tanda });
  api.y += 16;

  const sn = s.sniper;
  let garisTutupDitulis = false;
  let garisZonaDitulis = false;

  for (const r of baris) {
    // garis penutupan dan zona disisipkan sesuai urutan terbaru-di-atas
    if (!garisTutupDitulis && s.cutoff != null && r.created_at <= s.cutoff) {
      api.kotak(26, WARNA.merahMuda, WARNA.merah);
      api.y += 17;
      api.tulis(`LELANG DITUTUP ${fmtTime(s.cutoff, tz)} ${model.tzShort}`,
        { font: `500 11px ${MONO}`, warna: WARNA.merah, kiri: PAD + 14 });
      api.y += 13;
      garisTutupDitulis = true;
    }
    if (!garisZonaDitulis && sn && sn.aktif && r.created_at < sn.mulai) {
      api.kotak(26, WARNA.kuningMuda, WARNA.kuning);
      api.y += 17;
      api.tulis(`SNIPER ZONE MULAI ${fmtTime(sn.mulai, tz)}`,
        { font: `500 11px ${MONO}`, warna: WARNA.kuning, kiri: PAD + 14 });
      api.y += 13;
      garisZonaDitulis = true;
    }

    const telat = r.flags.includes('lewat-cutoff');
    const ilegal = r.sniperIlegal;
    if (telat || ilegal) { api.kotak(tinggiBaris - 6, WARNA.merahMuda); }
    if (w && r.pk === w.pk) { api.kotak(tinggiBaris - 6, '#EDF7F2'); }

    api.y += 20;
    api.tulis(fmtTime(r.created_at, tz), { font: `500 13px ${MONO}`, kiri: KOL.jam });
    api.tulis(potong(api, r.username || '—', `600 13px ${SANS}`, 320),
      { font: `600 13px ${SANS}`, kiri: KOL.akun });
    api.tulis(r.bid != null ? 'Rp' + fmtRupiah(r.bid) : '—',
      { font: `500 13px ${MONO}`, kiri: KOL.nilai, warna: r.bid != null ? WARNA.tinta : WARNA.redup });

    const catatan = ilegal ? 'sniper zone — tidak berhak'
      : telat ? `telat ${fmtDuration(r.late)}`
      : (w && r.pk === w.pk) ? 'pemenang' : '';
    if (catatan) {
      api.tulis(potong(api, catatan, `500 12px ${SANS}`, L - PAD - KOL.tanda), {
        font: `500 12px ${SANS}`,
        warna: ilegal || telat ? WARNA.merah : WARNA.hijau,
        kiri: KOL.tanda
      });
    }
    api.y += tinggiBaris - 20;
    api.garis();
  }

  if (dipotong) {
    api.y += 20;
    api.tulis(`(${dipotong} tawaran lebih awal tidak ditampilkan — ada lengkap di berkas ekspor)`, {
      font: `400 12px ${SANS}`, warna: WARNA.redup
    });
    api.y += 6;
  }

  // --- kaki
  api.y += 26;
  api.garis(WARNA.garis2);
  api.y += 22;

  const kaki = [
    `${s.total} komentar · ${s.users} peserta`,
    s.cutoff != null ? `ditutup ${fmtTime(s.cutoff, tz)} ${model.tzShort} tanggal ${fmtDate(s.cutoff, tz)}` : null,
    sn && sn.aktif ? `sniper zone ${sniperMin} menit` : null
  ].filter(Boolean).join('  ·  ');
  api.tulis(kaki, { font: `400 12px ${MONO}`, warna: WARNA.lembut });
  api.y += 20;

  if (hash) {
    api.tulis(potong(api, `SHA-256 berkas data: ${hash}`, `400 11px ${MONO}`, L - PAD * 2), {
      font: `400 11px ${MONO}`, warna: WARNA.redup
    });
    api.y += 18;
  }
  api.paragraf(
    'Jam diambil dari catatan waktu asli Instagram (epoch UTC) dan tidak pernah diubah. ' +
    'Instagram hanya menyimpan ketelitian sampai detik; tawaran pada detik yang sama diurutkan ' +
    'memakai nomor komentar Instagram yang selalu naik.',
    { font: `400 11px ${SANS}`, warna: WARNA.redup, tinggiBaris: 16 }
  );

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

function daftarTemuan(model) {
  const s = model.result.summary;
  const out = [];

  if (s.cutoff == null) {
    out.push({ nada: 'warn', teks: 'Jam tutup lelang belum diisi — tawaran telat tidak bisa dinilai.' });
  } else if (s.lateBids > 0) {
    const worst = Math.max(...model.result.rows
      .filter((r) => r.flags.includes('lewat-cutoff') && r.bid != null).map((r) => r.late));
    out.push({ nada: 'bad', teks: `${s.lateBids} tawaran masuk setelah lelang ditutup — terparah lewat ${fmtDuration(worst)}.` });
  }
  if (s.sniperIlegal > 0) {
    out.push({ nada: 'bad', teks: `${s.sniperIlegal} tawaran masuk di sniper zone tanpa pernah menawar sebelumnya.` });
  }
  if (model.diff && model.diff.deleted.length) {
    out.push({ nada: 'bad', teks: `${model.diff.deleted.length} komentar dihapus di antara dua penarikan.` });
  }
  if (s.tieGroups > 0) {
    out.push({ nada: 'warn', teks: `${s.tieRows} tawaran jatuh pada detik yang sama persis.` });
  }
  if (s.bidDown > 0) {
    out.push({ nada: 'warn', teks: `${s.bidDown} tawaran nilainya lebih rendah dari tawaran tertinggi saat itu.` });
  }
  if (!out.length) {
    out.push({ nada: 'good', teks: 'Tidak ditemukan kejanggalan.' });
  }
  return out;
}
