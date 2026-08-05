/**
 * Uji pembaca jam, pengingat, dan tebakan caption.
 *
 * Sama seperti uji pembaca tawaran: isinya kasus yang benar-benar pernah salah
 * di alat ini, bukan kasus karangan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseClock, maskClock, fmtClock, fmtTime, fmtDate, fmtHari, fmtIsoDate,
  wallTimeToEpoch, fmtDuration
} from '../web/js/time.js';

import { pengingat, tebakKelipatan, buatIcs, bersihkanJudulTebakan } from '../web/js/pantau.js';
import { parseBid } from '../web/js/analysis.js';

const WIB = 'Asia/Jakarta';

// -------------------------------------------------------------- baca jam

test('jam diterima seperti orang menuliskannya', () => {
  for (const [teks, h, mi, s] of [
    ['21', 21, 0, 0], ['2100', 21, 0, 0], ['21.00', 21, 0, 0], ['21:00', 21, 0, 0],
    ['9.30', 9, 30, 0], ['930', 9, 30, 0], ['203400', 20, 34, 0], ['21:45:30', 21, 45, 30]
  ]) {
    const c = parseClock(teks);
    assert.deepEqual([c.h, c.mi, c.sec], [h, mi, s], `"${teks}"`);
  }
});

test('jam yang tidak masuk akal ditolak', () => {
  for (const teks of ['25:00', '21:70', '21:00:99', 'abc', '', '1234567']) {
    assert.equal(parseClock(teks), null, `"${teks}"`);
  }
});

test('titik dua disisipkan sambil diketik', () => {
  // "215059" pernah berhenti di "21:50" — dua angka terakhir hilang tanpa
  // jejak, jadi jam tutup meleset lima puluh sembilan detik tanpa terlihat.
  assert.equal(maskClock('215059'), '21:50:59');
  assert.equal(maskClock('203400'), '20:34:00');
  assert.equal(maskClock('2030'), '20:30');
  assert.equal(maskClock('9'), '9');
  // Pengelompokan yang diketik sendiri dihormati: "9:30" bukan "93:0".
  assert.equal(maskClock('9:30'), '9:30');
  assert.equal(maskClock('9:3059'), '9:30:59');
});

test('jam selalu ditulis sampai detik', () => {
  // Alat ini menjual ketelitian detik; menyembunyikan ":00" membuat orang
  // mengira ketelitiannya berhenti di menit.
  assert.equal(fmtClock(21, 0, 0), '21:00:00');
  assert.equal(fmtClock(9, 5, 7), '09:05:07');
});

// ------------------------------------------------------------ zona waktu

test('jam dinding diubah ke epoch menurut zona yang dipakai', () => {
  // 21:00:00 WIB = 14:00:00 UTC.
  const e = wallTimeToEpoch(2026, 8, 10, 21, 0, 0, WIB);
  assert.equal(new Date(e * 1000).toISOString(), '2026-08-10T14:00:00.000Z');

  // Bolak-balik harus kembali ke angka yang sama.
  assert.equal(fmtTime(e, WIB), '21:00:00');
  assert.equal(fmtDate(e, WIB), '10/08/2026');
  assert.equal(fmtIsoDate(e, WIB), '2026-08-10');
  assert.equal(fmtHari(e, WIB), 'Sen');
});

test('zona waktu hanya mengubah tampilan, bukan momennya', () => {
  const e = wallTimeToEpoch(2026, 8, 10, 21, 0, 0, WIB);
  assert.equal(fmtTime(e, 'UTC'), '14:00:00');
  assert.equal(fmtTime(e, 'Asia/Jayapura'), '23:00:00');   // WIT = UTC+9
});

test('lama waktu ditulis dalam bahasa manusia', () => {
  assert.equal(fmtDuration(0), '0 detik');
  assert.equal(fmtDuration(59), '59 detik');
  assert.equal(fmtDuration(3600), '1 jam');
});

// ------------------------------------------------------------- pengingat

test('tanpa sniper zone: ingatkan 5 dan 3 menit sebelum tutup', () => {
  const p = pengingat({ sniperMin: 0 });
  assert.deepEqual(p.map((x) => x.menit), [5, 3]);
});

test('dengan sniper zone: ingatkan sebelum ZONA dibuka, bukan sebelum tutup', () => {
  // Tenggat yang menentukan bukan jam tutup melainkan saat zona dibuka:
  // yang belum pernah menawar sebelum itu tidak boleh ikut lagi. Diingatkan
  // saat zona sudah terbuka berarti diingatkan setelah gugur.
  assert.deepEqual(pengingat({ sniperMin: 5 }).map((x) => x.menit), [8, 5, 3]);
  assert.deepEqual(pengingat({ sniperMin: 30 }).map((x) => x.menit), [33, 5, 3]);

  const zona = pengingat({ sniperMin: 5 })[0];
  assert.match(zona.teks, /sniper zone/i);
});

test('pengingat yang bentrok tidak digandakan', () => {
  // Sniper 2 menit -> 2+3 = 5, bertabrakan dengan pengingat 5 menit.
  const p = pengingat({ sniperMin: 2 });
  assert.deepEqual(p.map((x) => x.menit), [5, 3]);
  assert.match(p[0].teks, /sniper zone/i, 'yang menyebut zona lebih berguna');
});

// ------------------------------------------------------------------ ICS

test('berkas kalender punya durasi, bukan nol menit', () => {
  // Google menerima acara berdurasi nol lewat API dan menjawab "berhasil
  // dibuat", tapi bendanya tidak punya tinggi di tampilan kalender — persis
  // terlihat seperti tidak ada yang tersimpan.
  const tutup = wallTimeToEpoch(2026, 8, 10, 21, 0, 0, WIB);
  const ics = buatIcs([{ id: 'A', title: 'Seiko', owner: 'penjual', closeAt: tutup, sniperMin: 5 }]);

  const mulai = ics.match(/DTSTART:(\d{8}T\d{6}Z)/)[1];
  const selesai = ics.match(/DTEND:(\d{8}T\d{6}Z)/)[1];
  assert.equal(mulai, '20260810T140000Z');
  assert.equal(selesai, '20260810T141500Z', 'panjangnya 15 menit');

  const alarm = [...ics.matchAll(/TRIGGER:-PT(\d+)M/g)].map((m) => +m[1]);
  assert.deepEqual(alarm, [8, 5, 3]);
});

test('baris ICS dilipat pada batas yang diterima aplikasi kalender', () => {
  const tutup = wallTimeToEpoch(2026, 8, 10, 21, 0, 0, WIB);
  const ics = buatIcs([{
    id: 'B', owner: 'penjual', closeAt: tutup,
    title: 'Seiko Tank 43-5170 Blue Chessboard Dial Kondisi Mulus Sekali Lengkap Box Buku Garansi'
  }]);
  for (const baris of ics.split('\r\n')) {
    assert.ok(Buffer.byteLength(baris) <= 75, `baris terlalu panjang: ${baris.slice(0, 40)}…`);
  }
});

// -------------------------------------------------------------- kelipatan

test('kelipatan telanjang berarti ribuan', () => {
  for (const [caption, nilai] of [
    ['kelipatan 50', 50000], ['kelipatan 100', 100000], ['naik 25', 25000],
    ['kelipatan 50rb', 50000], ['kelipatan 50.000', 50000], ['kelipatan 25000', 25000],
    ['Open bid 750rb (+50rb)', 50000], ['min bid 100', 100000]
  ]) {
    assert.equal(tebakKelipatan(caption, parseBid), nilai, `"${caption}"`);
  }
});

test('caption sungguhan @jamsekensingapur: aturan bertanda tambah', () => {
  // Kasus nyata. "+1 menit tidak sah" tertangkap lebih dulu daripada
  // "Bid kelipatan : 25 rb" karena letaknya di atas, lalu kelipatannya
  // terbaca Rp1.000 — cukup kecil untuk membuat tawaran otomatis menaikkan
  // harga seribu rupiah sekali jalan, dan kalah sambil terlihat bekerja.
  const cap = [
    '- Bid Yang Sah Akan Di Like (Agar Kelihatan Rapi)',
    '- Pemenang SAH di menit paling terakhir, +1 menit tidak sah.',
    '- SNIPER BID (15 Menit Sebelum Waktu Berakhir) WAJIB SUDAH PERNAH BID',
    '- Comment hanya untuk bidder, tanya2 via DM atau WA 081322801805',
    'Open Bid : 850',
    'Bid kelipatan : 25 rb (angka langsung ditambah dengan BID sebelumnya)'
  ].join('\n');

  assert.equal(tebakKelipatan(cap, parseBid), 25000);
});

test('angka bersatuan waktu bukan harga', () => {
  assert.equal(tebakKelipatan('+1 menit tidak sah', parseBid), null);
  assert.equal(tebakKelipatan('naik 5 menit sebelum tutup', parseBid), null);
  // Tapi "+50rb" yang memang harga tetap terbaca.
  assert.equal(tebakKelipatan('Open bid 750rb (+50rb)', parseBid), 50000);
});

test('kelipatan tidak mengambil harga pembukaan', () => {
  // Kata "bid" pernah jadi kata kunci di sini, dan caption hampir selalu
  // menyebut "Open bid" SEBELUM kelipatannya — jadi yang terbaca justru harga
  // pembukaan, dan kartunya memajang "naik Rp750.000".
  const caption = 'Seiko Tank\nOpen bid 750rb\nKelipatan 50\nClose jam 21.00';
  assert.equal(tebakKelipatan(caption, parseBid), 50000);

  // Tanpa kata kunci kelipatan sama sekali: lebih baik tidak menebak.
  assert.equal(tebakKelipatan('Open bid 750rb', parseBid), null);
});

// ----------------------------------------------------------------- judul

test('nama barang tidak ditebak lagi', () => {
  // Dua kali salah dengan cara berbeda: mengambil tata tertib ("Mohon dibaca
  // keterangan"), lalu mengambil spesifikasi ("Lingkar pergelangan 15 cm").
  // Kolomnya dikosongkan dan diisi sendiri; kosong lebih jujur daripada salah.
  assert.equal(typeof bersihkanJudulTebakan, 'function');
});

// ------------------------------------------------- komentar yang dihapus

test('komentar yang hilang antara dua tarikan terdeteksi', async () => {
  const { hilangAntara } = await import('../web/js/diff.js');
  const c = (pk, text) => ({ pk, text, username: 'u' + pk, created_at: 1785800000 + +pk });

  const lama = { comments: [c('1', '800rb'), c('2', '1jt'), c('3', '850rb')] };
  const baru = { comments: [c('1', '800rb'), c('3', '850rb')] };

  const hilang = hilangAntara(lama, baru);
  assert.equal(hilang.length, 1);
  assert.equal(hilang[0].pk, '2');
  assert.equal(hilang[0].text, '1jt', 'isinya ikut tersimpan — itu buktinya');
});

test('komentar yang disunting bukan komentar yang hilang', () => {
  // Dibandingkan lewat pk, bukan teks: pk tidak berubah walau isinya disunting.
  return import('../web/js/diff.js').then(({ hilangAntara }) => {
    const lama = { comments: [{ pk: '1', text: '800rb' }] };
    const baru = { comments: [{ pk: '1', text: '900rb' }] };
    assert.deepEqual(hilangAntara(lama, baru), []);
  });
});

test('tarikan kosong tidak dianggap semuanya terhapus', () => {
  // Penarikan gagal mengembalikan nol komentar. Menganggap itu "semua dihapus"
  // akan menghasilkan tuduhan massal dari satu gangguan jaringan.
  return import('../web/js/diff.js').then(({ hilangAntara }) => {
    const lama = { comments: [{ pk: '1' }, { pk: '2' }] };
    assert.deepEqual(hilangAntara(lama, { comments: [] }), []);
    assert.deepEqual(hilangAntara(lama, null), []);
  });
});
