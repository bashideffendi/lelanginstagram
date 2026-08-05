/**
 * Uji pembaca tawaran.
 *
 * Alat ini dipakai menuduh orang curang. Kesalahan di sini tidak membuatnya
 * rusak — ia membuatnya menghasilkan tuduhan yang KELIHATAN benar padahal
 * salah, dan tuduhan begitu tidak akan tertangkap oleh mata siapa pun sebelum
 * dikirim ke penyelenggara.
 *
 * Karena itu isinya bukan kasus karangan, melainkan kasus yang benar-benar
 * pernah salah di alat ini. Tiap uji di bawah pernah menjadi bug sungguhan.
 *
 *   node --test test/
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBid, analyze, cariOpenBid, tebakOpenBid, hitungSkala,
  isAnnouncement, terapkanSniperZone, fmtRupiah, skalaSatuan
} from '../web/js/analysis.js';

/** terapkanSniperZone menerima DETIK, bukan menit. */
const menit = (m) => m * 60;

/** Komentar sudah dalam bentuk yang dipakai analyze(): username datar. */
let urut = 0;
const k = (username, text, detik = 0) => ({
  pk: String(++urut).padStart(12, '0'),
  created_at: 1785800000 + detik,
  username, text
});

// ---------------------------------------------------------------- parseBid

test('kode model tidak dibaca sebagai harga', () => {
  // "SKX007K" pernah terbaca Rp7.000 karena "007K" dianggap angka bersatuan.
  assert.equal(parseBid('SKX007K').value, null);
  assert.equal(parseBid('SRPD55K1').value, null);
  assert.equal(parseBid('43-5170').value, null);
});

test('kode model tidak menenggelamkan tawaran asli di komentar yang sama', () => {
  // Ini bagian yang paling berbahaya: bukan sekadar salah baca, tapi angka
  // palsu mengalahkan angka benar di kalimat yang sama.
  assert.equal(parseBid('SKX007K 850rb').value, 850000);
  assert.equal(parseBid('bid SRPD55 900rb').value, 900000);
});

test('titik ribuan tidak memotong angka', () => {
  // "Rp2.500.000" pernah terbaca 500.000 — yang berakhir ".000" malah hilang.
  assert.equal(parseBid('Rp2.500.000').value, 2500000);
  assert.equal(parseBid('Rp 2.500.000').value, 2500000);
  assert.equal(parseBid('1.250.000').value, 1250000);
});

test('nomor telepon tidak jadi tawaran', () => {
  // Deret panjang tanpa satuan dan tanpa Rp hampir pasti nomor.
  assert.equal(parseBid('wa 081234567890').value, null);
  assert.equal(parseBid('0812-3456-7890').value, null);
});

test('satuan dibaca sebagaimana orang menulisnya', () => {
  for (const [teks, nilai] of [
    ['750rb', 750000], ['750 ribu', 750000], ['750k', 750000],
    ['1jt', 1000000], ['1,5jt', 1500000], ['2 juta', 2000000],
    ['Rp850.000', 850000]
  ]) {
    assert.equal(parseBid(teks).value, nilai, `"${teks}"`);
  }
});

test('yang bersatuan menang atas angka telanjang di kalimat yang sama', () => {
  assert.equal(parseBid('naik dari 700 jadi 850rb').value, 850000);
});

// ---------------------------------------------------- skala angka telanjang

test('angka telanjang dikalibrasi dari angka bersatuan', () => {
  // Tanpa acuan, angka telanjang di bawah 10.000 berarti ribuan.
  assert.equal(hitungSkala([], [750, 800, 850]), 1000);
  // Dengan acuan ratusan ribu, angka telanjang ratusan juga ribuan.
  assert.equal(hitungSkala([750000, 800000], [750, 800]), 1000);
  // Kalau angka telanjangnya memang sudah besar, jangan dikali lagi.
  assert.equal(hitungSkala([750000], [800000, 850000]), 1);
});

test('"750" di komentar berarti Rp750.000', () => {
  const h = analyze([
    k('a', 'OB', 10), k('b', '750', 20), k('c', '800', 30), k('d', '850', 40)
  ], { captionText: 'Open bid 750rb', cutoffEpoch: null, ownerUsername: null });

  assert.equal(h.summary.winner.bid, 850000);
  assert.equal(h.summary.bidScale, 1000);
});

// ------------------------------------------------------------- harga buka

test('OB telanjang tidak dianggap acuan kuat', () => {
  // Pernah begini: "OB 100" masuk kumpulan acuan, median acuan jadi 100,
  // kalibrasi menyimpulkan skala 1, lalu SELURUH tawaran terbaca ratusan
  // rupiah. Kartunya memajang "buka Rp100" dan salahnya tidak kentara.
  const ob = cariOpenBid('OB 100');
  assert.equal(ob.value, 100);
  assert.equal(ob.kuat, false, 'angka telanjang tidak boleh dianggap kuat');

  const kuat = cariOpenBid('OB 750rb');
  assert.equal(kuat.value, 750000);
  assert.equal(kuat.kuat, true);
});

test('harga buka telanjang tetap jadi ribuan walau tak ada acuan', () => {
  // Semua tawaran di komentar bersatuan, jadi kalibrasi tidak punya bahan.
  const h = analyze([k('a', '800rb', 10), k('b', '850rb', 20)], {
    captionText: 'OB 100\nkelipatan 50', cutoffEpoch: null, ownerUsername: null
  });
  assert.equal(h.summary.openBid, 100000, 'tidak ada lelang jam seharga Rp100');
});

test('tebakOpenBid dari caption saja', () => {
  for (const [teks, nilai] of [
    ['OB 50', 50000], ['OB 100', 100000], ['ob 900', 900000],
    ['Open bid 750rb', 750000], ['OB 25000', 25000], ['OB 1.500.000', 1500000]
  ]) {
    assert.equal(tebakOpenBid(teks), nilai, `"${teks}"`);
  }
  assert.equal(tebakOpenBid('tidak ada harga di sini'), null);
});

test('komentar "OB" berarti menawar di harga pembukaan', () => {
  const h = analyze([k('a', 'OB', 10), k('b', '800rb', 20)], {
    captionText: 'OB 750rb', cutoffEpoch: null, ownerUsername: null
  });
  const baris = h.rows.find((r) => r.username === 'a');
  assert.equal(baris.bid, 750000);
});

// ------------------------------------------------------------ pengumuman

test('aturan lelang dikenali sebagai pengumuman, bukan tawaran', () => {
  // Sengaja menuntut teks panjang: tawaran sungguhan selalu pendek, dan
  // menurunkan ambangnya berarti komentar biasa yang kebetulan menyebut
  // "kelipatan" ikut dibuang dari perhitungan.
  const aturan = [
    'ATURAN LELANG',
    'OB : 750rb',
    'Kelipatan 50rb',
    'Close jam 21.00 WIB, no cancel, wajib bayar maksimal 1x24 jam',
    'Pembayaran ke rekening yang tertera, DM setelah menang'
  ].join('\n');
  assert.ok(aturan.length >= 90, 'contohnya harus sepanjang pengumuman sungguhan');
  assert.equal(isAnnouncement(aturan), true);

  const bergaris = '========================\nRules lelang jam tangan seiko original\n' +
    'Open bid tertera di caption, kelipatan bebas asal naik\n========================';
  assert.equal(isAnnouncement(bergaris), true);

  assert.equal(isAnnouncement('850rb'), false);
  assert.equal(isAnnouncement('ikut 900'), false);
  assert.equal(isAnnouncement('naik 950rb bang, semoga dapet'), false);
});

// ------------------------------------------------------------ sniper zone

test('sniper zone hanya menjerat yang belum pernah menawar', () => {
  const tutup = 1785800000 + 3600;
  const rows = [
    { username: 'lama', bid: 800000, created_at: tutup - 1800 },
    { username: 'lama', bid: 900000, created_at: tutup - 120 },
    { username: 'baru', bid: 950000, created_at: tutup - 100 }
  ];
  const z = terapkanSniperZone(rows, tutup, menit(5));

  assert.equal(z.aktif, true);
  assert.equal(z.mulai, tutup - menit(5));
  assert.deepEqual(z.pelanggar.map((r) => r.username), ['baru'],
    'yang sudah menawar sebelum zona dibuka boleh menawar di dalamnya');
  assert.equal(rows[1].diZonaSniper, true);
  assert.equal(rows[1].sniperIlegal, undefined);
  assert.equal(rows[2].sniperIlegal, true);
});

test('tanpa sniper zone tidak ada yang dilanggar', () => {
  const tutup = 1785800000 + 3600;
  const rows = [{ username: 'x', bid: 900000, created_at: tutup - 10 }];
  assert.equal(terapkanSniperZone(rows, tutup, 0).aktif, false);
  assert.equal(rows[0].sniperIlegal, undefined);
});

// ------------------------------------------------------- urutan & pemenang

test('tawaran pada detik yang sama diurutkan dengan ID komentar', () => {
  // Instagram hanya menyimpan detik. Dua tawaran di detik yang sama dibedakan
  // dengan pk, yang naik monoton — itulah satu-satunya urutan yang bisa
  // dipertanggungjawabkan sebagai bukti.
  const a = { pk: '000000000100', created_at: 1785800000, username: 'a', text: '900rb' };
  const b = { pk: '000000000101', created_at: 1785800000, username: 'b', text: '950rb' };
  const h = analyze([b, a], { captionText: '', cutoffEpoch: null, ownerUsername: null });
  assert.deepEqual(h.rows.map((r) => r.username), ['a', 'b'], 'yang pk-nya kecil lebih dulu');
});

test('tawaran sesudah jam tutup tidak menang', () => {
  const tutup = 1785800000 + 100;
  const h = analyze([
    k('sah', '900rb', 50),
    k('telat', '1jt', 150)
  ], { captionText: '', cutoffEpoch: tutup, ownerUsername: null });

  assert.equal(h.summary.winner.username, 'sah');
  assert.equal(h.summary.winner.bid, 900000);
});

test('penyelenggara tidak ikut jadi pemenang', () => {
  const h = analyze([
    k('penjual', 'sudah 1jt ya', 10),
    k('peserta', '900rb', 20)
  ], { captionText: '', cutoffEpoch: null, ownerUsername: 'penjual' });

  assert.equal(h.summary.winner.username, 'peserta');
});

// ------------------------------------------------------------------ rupiah

test('rupiah ditulis dengan pemisah ribuan Indonesia', () => {
  assert.equal(fmtRupiah(750000), '750.000');
  assert.equal(fmtRupiah(1500000), '1.500.000');
  assert.equal(fmtRupiah(0), '0');
});

// ---------------------------------------------- temuan audit 2026-08-05

test('tangga yang menyeberang ke notasi juta tetap terbaca benar', () => {
  // Tangga paling lazim di lelang Indonesia. Skala tunggal untuk seluruh
  // lelang memaksa "1", "1,05", "1,1" memakai pengali yang sama dengan "800",
  // jadi tiga tawaran TERTINGGI terbaca Rp1.000-an, ketiganya dicap turun, dan
  // pemenang sebenarnya lenyap dari berkas bukti.
  const h = analyze(['800', '850', '900', '950', '1', '1,05', '1,1']
    .map((t, i) => k('u' + i, t, i * 10)), { captionText: '', cutoffEpoch: null, ownerUsername: null });

  assert.deepEqual(h.rows.map((r) => r.bid),
    [800000, 850000, 900000, 950000, 1000000, 1050000, 1100000]);
  assert.equal(h.summary.winner.bid, 1100000);
  assert.equal(h.summary.bidDown, 0, 'tidak ada tawaran sah yang dicap turun');
});

test('komentar bertahun tidak jadi tawaran dan tidak jadi pemenang', () => {
  // "ini keluaran tahun 2020 ya om?" pernah terbaca Rp2.020.000 dan
  // menobatkan penanya sebagai pemenang di berkas sanggahan.
  assert.equal(parseBid('ini keluaran tahun 2020 ya om?').value, null);
  assert.equal(parseBid('seri 1978').value, null);
  assert.equal(parseBid('diameter 40 mm').value, null);
  assert.equal(parseBid('berat 120 gram').value, null);

  const h = analyze([
    k('a', '800rb', 10), k('b', '850rb', 20),
    k('c', 'ini keluaran tahun 2020 ya om?', 30), k('d', '900rb', 40)
  ], { captionText: '', cutoffEpoch: null, ownerUsername: null });

  assert.equal(h.summary.winner.username, 'd');
  assert.equal(h.summary.winner.bid, 900000);
  assert.equal(h.summary.bidDown, 0);
});

test('bid relatif ditandai, tidak dihitung, dan tidak menang', () => {
  // "naik 50" itu kenaikan, bukan harga penuh. Nilainya sengaja TIDAK
  // dikarang jadi prevHigh + 50rb — alat ini dipakai menuduh, dan
  // menghitungkan tawaran yang tidak pernah ditulis lebih berbahaya daripada
  // kehilangannya.
  assert.equal(parseBid('naik 50').relatif, true);
  assert.equal(parseBid('up 100').relatif, true);
  assert.equal(parseBid('naik 50rb').relatif, false, 'yang bersatuan bukan relatif');

  const h = analyze([k('a', '800rb', 10), k('b', 'naik 50', 20), k('c', 'up 100', 30)],
    { captionText: '', cutoffEpoch: null, ownerUsername: null });

  assert.equal(h.summary.winner.username, 'a');
  assert.equal(h.summary.bidDown, 0, 'bid relatif tidak boleh mencap tawaran lain turun');
  assert.ok(h.rows[1].flags.includes('bid-relatif'));
});

test('skalaSatuan memilih pengali terhadap acuan berjalan', () => {
  assert.equal(skalaSatuan(950, 900000), 1000);
  assert.equal(skalaSatuan(1.1, 950000), 1e6);
  assert.equal(skalaSatuan(850000, 900000), 1);
  assert.equal(skalaSatuan(750, null), 1000, 'tanpa acuan, di bawah 10 ribu berarti ribuan');
});
