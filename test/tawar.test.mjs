/**
 * Uji keputusan menawar otomatis.
 *
 * Ini satu-satunya bagian yang bisa mengeluarkan uang tanpa kamu menekan apa
 * pun. Salah di sini berarti menawar melewati batas, menawar melawan diri
 * sendiri, atau menawar di lelang tempat tawaranmu batal menurut aturan
 * penjualnya. Karena itu tiap penolakannya diuji satu per satu, bukan cuma
 * jalur yang berhasil.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { putusan, tawaranBerikut, teksTawaran, SEBAB } from '../web/js/tawar.js';

const TUTUP = 1785900000;

/** Lelang yang semuanya sudah benar; tiap uji merusak satu hal saja. */
const lelang = (ubah = {}) => ({
  autoBid: true,
  maksBid: 1000000,
  increment: 50000,
  openBid: 750000,
  closeAt: TUTUP,
  leadDetik: 5,
  topBid: 800000,
  topUser: 'orang',
  tawaranPer: { bashide: 750000, orang: 800000 },
  ...ubah
});

const saat = (jarak, akun = 'bashide') => ({ now: TUTUP - jarak, akun });

test('keadaan normal: menembak sekadar cukup untuk memimpin', () => {
  const p = putusan(lelang(), saat(3));
  assert.equal(p.tembak, true);
  assert.equal(p.nilai, 850000, 'tertinggi 800rb + kelipatan 50rb');
});

test('tidak menembak sebelum waktunya', () => {
  const p = putusan(lelang(), saat(60));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.BELUM_WAKTUNYA);
  assert.equal(p.nilai, 850000, 'nilainya tetap dihitung supaya bisa ditampilkan lebih dulu');
});

test('berhenti begitu harga melewati batas atas', () => {
  // Tertinggi 980rb, berikutnya 1,03jt — lewat batas 1jt.
  const p = putusan(lelang({ topBid: 980000, tawaranPer: { bashide: 750000, orang: 980000 } }), saat(3));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.LEWAT_BATAS);
  assert.equal(p.kurang, 30000);
  assert.match(p.pesan, /kalah/i);
});

test('tepat sama dengan batas atas masih boleh', () => {
  // Tertinggi 950rb + 50rb = 1jt, persis batasnya.
  const p = putusan(lelang({ topBid: 950000, tawaranPer: { bashide: 750000, orang: 950000 } }), saat(3));
  assert.equal(p.tembak, true);
  assert.equal(p.nilai, 1000000);
});

test('tidak menawar melawan diri sendiri', () => {
  const p = putusan(lelang({
    topBid: 900000, topUser: 'bashide', tawaranPer: { bashide: 900000, orang: 800000 }
  }), saat(3));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.MEMIMPIN);
});

test('menolak kalau kamu belum pernah menawar sendiri', () => {
  // Syarat sniper zone dipenuhi tanganmu, bukan oleh alat ini. Tawaran pertama
  // yang ditembakkan mesin batal menurut aturan penjualnya sendiri.
  const p = putusan(lelang({ tawaranPer: { orang: 800000 } }), saat(3));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.BELUM_MENAWAR);

  // Akun sendiri belum diisi pun ditolak — tidak ada yang bisa dicocokkan.
  assert.equal(putusan(lelang(), { now: TUTUP - 3, akun: '' }).kode, SEBAB.BELUM_MENAWAR);
});

test('menolak tanpa batas atas', () => {
  const p = putusan(lelang({ maksBid: null }), saat(3));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.TANPA_BATAS);
});

test('menolak kalau kelipatan tidak diketahui', () => {
  const p = putusan(lelang({ increment: null }), saat(3));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.TANPA_KELIPATAN);
});

test('menolak sesudah lelang tutup', () => {
  const p = putusan(lelang(), { now: TUTUP + 1, akun: 'bashide' });
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.SUDAH_TUTUP);
});

test('menolak kalau sudah pernah ditembakkan', () => {
  // Penjaga terakhir supaya dua penembak — browser dan server — tidak
  // mengirim dua komentar untuk satu lelang.
  const p = putusan(lelang({ autoTembakPada: TUTUP - 4 }), saat(3));
  assert.equal(p.tembak, false);
  assert.equal(p.kode, SEBAB.SUDAH_DITEMBAK);
});

test('menolak kalau dimatikan', () => {
  assert.equal(putusan(lelang({ autoBid: false }), saat(3)).kode, SEBAB.MATI);
});

test('menolak tanpa jam tutup', () => {
  assert.equal(putusan(lelang({ closeAt: null }), saat(3)).kode, SEBAB.TANPA_JAM);
});

test('lead time bisa diatur per lelang', () => {
  const l = lelang({ leadDetik: 20 });
  assert.equal(putusan(l, saat(25)).kode, SEBAB.BELUM_WAKTUNYA);
  assert.equal(putusan(l, saat(15)).tembak, true);
});

test('tawaran berikutnya kalau belum ada tawaran sama sekali', () => {
  assert.equal(tawaranBerikut({ topBid: null, openBid: 750000 }), 750000);
  assert.equal(tawaranBerikut({ topBid: 800000, increment: 50000 }), 850000);
  assert.equal(tawaranBerikut({ topBid: 800000, increment: null }), null);
});

test('teks komentarnya tidak bisa disalahartikan', () => {
  // Komentar ini juga jadi bukti: "900" bisa diperdebatkan, "Rp900.000" tidak.
  assert.equal(teksTawaran(900000), 'Rp900.000');
  assert.equal(teksTawaran(1500000), 'Rp1.500.000');
  assert.equal(teksTawaran(900000, 'ikut {nilai}'), 'ikut 900.000');
});
