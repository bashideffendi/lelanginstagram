/**
 * Jam yang sudah dikoreksi terhadap jam sungguhan.
 *
 * Seluruh hitung mundur di alat ini memakai jam perangkatmu. Kalau jam
 * laptopmu meleset delapan detik — dan jam komputer memang rutin meleset
 * sebanyak itu tanpa ada yang menyadari — maka hitung mundurnya ikut meleset
 * delapan detik. Di lelang bersniper zone, satu detik menentukan boleh
 * tidaknya kamu menawar sama sekali.
 *
 * Instagram mencatat waktu komentar di servernya sendiri, yang terselaraskan
 * ke waktu sungguhan. Jadi yang benar bukan jam perangkatmu, melainkan waktu
 * sungguhan — dan itulah yang diukur di sini.
 *
 * Caranya sama seperti yang dipakai protokol penyelaras waktu: catat jam lokal
 * sebelum bertanya, catat jam lokal sesudah dijawab, lalu anggap jawaban
 * servernya berlaku di tengah-tengah keduanya. Dari beberapa pengukuran,
 * yang dipakai adalah yang perjalanannya paling singkat — makin singkat
 * perjalanannya, makin kecil kemungkinan pergi dan pulangnya berat sebelah.
 */

import { apiBase } from '../config.js';

/** Selisih jam sungguhan dikurangi jam perangkat ini, dalam milidetik. */
let beda = 0;
let terukur = false;
let ketelitian = null;      // perkiraan meleset maksimal, milidetik
let diukurPada = 0;

/** Berapa lama hasil pengukuran dianggap masih berlaku. */
const UMUR_UKURAN = 15 * 60 * 1000;

/**
 * Waktu sungguhan sekarang, dalam milidetik.
 *
 * Dipakai menggantikan Date.now() di mana pun angkanya dibandingkan dengan
 * waktu dari Instagram. Untuk urusan yang murni lokal — berapa lama tombol
 * ditekan, misalnya — Date.now() biasa tetap benar dan lebih murah.
 */
export function sekarang() {
  return Date.now() + beda;
}

/** Waktu sungguhan dalam detik, bentuk yang dipakai seluruh alat ini. */
export function sekarangDetik() {
  return Math.floor(sekarang() / 1000);
}

export function keadaan() {
  return {
    terukur,
    beda,                                    // + berarti jam perangkat ketinggalan
    ketelitian,
    kedaluwarsa: terukur && Date.now() - diukurPada > UMUR_UKURAN
  };
}

/**
 * Ukur selisihnya. Aman dipanggil berkali-kali; yang gagal tidak mengubah
 * apa pun, jadi hasil pengukuran sebelumnya tetap dipakai.
 *
 * @param sampel banyaknya pengukuran. Lebih dari satu karena satu perjalanan
 *               bisa kebetulan tersendat, dan yang tersendat memberi jawaban
 *               yang meleset tanpa terlihat meleset.
 */
export async function ukur(sampel = 4) {
  const hasil = [];

  for (let i = 0; i < sampel; i++) {
    try {
      const t0 = Date.now();
      const r = await fetch(apiBase() + '/waktu?_=' + t0, { cache: 'no-store' });
      const t2 = Date.now();
      if (!r.ok) continue;

      const j = await r.json();
      if (typeof j?.t !== 'number') continue;

      hasil.push({ rtt: t2 - t0, beda: j.t - (t0 + t2) / 2 });
    } catch {
      // Jaringan sedang tidak bisa. Jangan mengarang; diamkan saja.
    }
  }

  if (!hasil.length) return keadaan();

  // Yang perjalanannya paling singkat paling sedikit terdistorsi.
  const terbaik = hasil.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  beda = Math.round(terbaik.beda);
  ketelitian = Math.round(terbaik.rtt / 2);
  terukur = true;
  diukurPada = Date.now();

  return keadaan();
}

/**
 * Ukur sekarang, lalu ukur ulang berkala.
 *
 * Diukur ulang saat halaman kembali terlihat juga: laptop yang ditutup lalu
 * dibuka sering bangun dengan jam yang bergeser, dan itu justru terjadi tepat
 * sebelum orang membuka pantauannya untuk mengecek lelang.
 */
export function mulai() {
  ukur();
  setInterval(() => { if (!document.hidden) ukur(); }, UMUR_UKURAN);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - diukurPada > 60000) ukur();
  });
}

/** Kalimat pendek tentang keadaan jam perangkat ini. */
export function kalimat() {
  if (!terukur) return { teks: 'jam belum terukur', kelas: 'belum' };

  const detik = Math.abs(beda) / 1000;
  if (Math.abs(beda) < 1000) {
    return { teks: 'jam perangkatmu tepat', kelas: 'ok' };
  }

  const arah = beda > 0 ? 'ketinggalan' : 'kecepatan';
  return {
    teks: `jam perangkatmu ${arah} ${detik.toFixed(1)} detik — sudah dikoreksi`,
    kelas: Math.abs(beda) >= 5000 ? 'bad' : 'warn'
  };
}
