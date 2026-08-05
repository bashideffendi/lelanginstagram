/**
 * Uji koreksi jam.
 *
 * Kalau perhitungan di sini salah, seluruh hitung mundur ikut salah — dan
 * salahnya diam, karena angka yang meleset tetap berdetak dengan meyakinkan.
 * Karena itu perhitungannya diuji terhadap jam palsu yang selisihnya diketahui
 * persis, bukan terhadap jaringan sungguhan.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Muat ulang modulnya dengan jam dan jaringan palsu.
 *
 * Modulnya menyimpan hasil pengukuran di dalam dirinya, jadi tiap uji butuh
 * salinan yang bersih — kalau tidak, uji yang satu mewarisi selisih dari uji
 * sebelumnya dan lulus karena alasan yang salah.
 */
async function muat({ bedaSungguhan, rtt = 40, gagal = false, rttPerSampel = null }) {
  let lokal = 1785800000000;                   // jam perangkat, milidetik
  let ke = 0;

  globalThis.Date = class extends Date {
    static now() { return lokal; }
  };
  globalThis.document = { hidden: false, addEventListener() {} };
  globalThis.setInterval = () => 0;

  globalThis.fetch = async () => {
    if (gagal) throw new Error('jaringan mati');
    const perjalanan = rttPerSampel ? rttPerSampel[ke % rttPerSampel.length] : rtt;
    ke++;
    // Jawaban dibuat di tengah perjalanan.
    lokal += perjalanan / 2;
    const tServer = lokal + bedaSungguhan;
    lokal += perjalanan / 2;
    return { ok: true, json: async () => ({ t: tServer }) };
  };

  return import('../web/js/jam.js?t=' + Math.random());
}

beforeEach(() => { globalThis.Date = Date; });

test('selisih jam terukur, arahnya benar', async () => {
  // Jam perangkat ketinggalan 8 detik dari jam sungguhan.
  const J = await muat({ bedaSungguhan: 8000 });
  await J.ukur();

  const k = J.keadaan();
  assert.equal(k.terukur, true);
  assert.ok(Math.abs(k.beda - 8000) <= 5, `beda ${k.beda} harusnya sekitar 8000`);
  assert.match(J.kalimat().teks, /ketinggalan 8[.,]0 detik/);
});

test('jam perangkat yang kecepatan juga terbaca', async () => {
  const J = await muat({ bedaSungguhan: -3500 });
  await J.ukur();
  assert.ok(Math.abs(J.keadaan().beda + 3500) <= 5);
  assert.match(J.kalimat().teks, /kecepatan 3[.,]5 detik/);
});

test('jam yang sudah tepat tidak dikeluhkan', async () => {
  const J = await muat({ bedaSungguhan: 120 });
  await J.ukur();
  assert.equal(J.kalimat().kelas, 'ok');
  assert.match(J.kalimat().teks, /tepat/);
});

test('sekarang() memakai jam yang sudah dikoreksi', async () => {
  const J = await muat({ bedaSungguhan: 8000 });
  const sebelum = J.sekarang();
  await J.ukur();
  const sesudah = J.sekarang();

  // Perjalanan jaringan menggeser jam palsu, jadi yang diperiksa selisihnya.
  assert.ok(sesudah - sebelum >= 7900,
    'sesudah terukur, sekarang() harus melompat sebesar selisihnya');
  assert.equal(J.sekarangDetik(), Math.floor(J.sekarang() / 1000));
});

test('sampel yang perjalanannya paling singkat yang dipakai', async () => {
  // Satu perjalanan tersendat memberi jawaban yang meleset tanpa terlihat
  // meleset; yang tercepat paling kecil kemungkinan berat sebelah.
  const J = await muat({ bedaSungguhan: 5000, rttPerSampel: [400, 30, 800, 600] });
  await J.ukur(4);
  assert.equal(J.keadaan().ketelitian, 15, 'ketelitian = separuh perjalanan tercepat');
});

test('jaringan mati tidak mengarang selisih', async () => {
  const J = await muat({ bedaSungguhan: 8000, gagal: true });
  await J.ukur();

  const k = J.keadaan();
  assert.equal(k.terukur, false);
  assert.equal(k.beda, 0, 'lebih baik tidak mengoreksi daripada mengoreksi asal-asalan');
  assert.equal(J.kalimat().kelas, 'belum');
});

test('hasil pengukuran punya masa berlaku', async () => {
  const J = await muat({ bedaSungguhan: 1000 });
  await J.ukur();
  assert.equal(J.keadaan().kedaluwarsa, false);
});
