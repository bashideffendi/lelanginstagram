/**
 * Pantauan lelang.
 *
 * Menyimpan daftar lelang yang sedang diincar beserta jam tutupnya, lalu
 * mengubahnya jadi berkas kalender berisi alarm. Pengingat sengaja diserahkan
 * ke kalender ponsel, bukan ke notifikasi browser: kalender tetap berbunyi
 * walau browser tertutup dan ponsel di kantong — dan itulah keadaan saat orang
 * biasanya kelewatan lelang.
 *
 * Semua tersimpan di browser ini saja. Tidak ada server, jadi tidak ada yang
 * bisa hilang karena layanan mati, tapi juga tidak ikut pindah antar perangkat
 * kecuali diekspor sendiri.
 */

const KUNCI = 'lelanginsta_pantau_v1';
const KUNCI_AKU = 'lelanginsta_akun';

export const STATUS = {
  aktif: 'Sedang berjalan',
  menang: 'Menang',
  kalah: 'Kalah',
  batal: 'Batal ikut'
};

// ---------------------------------------------------------------- simpanan

function baca() {
  try {
    const t = localStorage.getItem(KUNCI);
    const d = t ? JSON.parse(t) : [];
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

function tulis(daftar) {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(daftar));
    return true;
  } catch {
    return false;        // mode privat atau kuota penuh
  }
}

export function semua() {
  // Yang paling dekat tutup selalu di atas; yang sudah selesai turun ke bawah.
  return baca().slice().sort((a, b) => {
    const aktifA = a.status === 'aktif', aktifB = b.status === 'aktif';
    if (aktifA !== aktifB) return aktifA ? -1 : 1;
    if (aktifA) return (a.closeAt ?? Infinity) - (b.closeAt ?? Infinity);
    return (b.closeAt ?? 0) - (a.closeAt ?? 0);
  });
}

export function ambil(id) {
  return baca().find((x) => x.id === id) || null;
}

export function simpan(item) {
  const daftar = baca();
  const i = daftar.findIndex((x) => x.id === item.id);
  if (i >= 0) daftar[i] = { ...daftar[i], ...item };
  else daftar.push(item);
  return tulis(daftar);
}

export function hapus(id) {
  return tulis(baca().filter((x) => x.id !== id));
}

export function akunku() {
  try { return localStorage.getItem(KUNCI_AKU) || ''; } catch { return ''; }
}

export function setAkunku(nama) {
  try { localStorage.setItem(KUNCI_AKU, String(nama || '').replace(/^@/, '').trim()); } catch { /* diabaikan */ }
}

// ---------------------------------------------------------------- turunan

/** Judul barang: baris pertama caption yang bukan aturan atau tempelan. */
export function tebakJudul(caption) {
  if (!caption) return null;
  const buang = /^(lelang|open\s*bid|ob\b|bid\b|closed?|close|rules?|note|hati2|rek\b|no cod)/i;
  for (const baris of String(caption).split(/\r?\n/)) {
    const b = baris.replace(/[^\p{L}\p{N}\s.,'()+-]/gu, '').trim();
    if (b.length < 6 || b.length > 90) continue;
    if (buang.test(b)) continue;
    if (!/[\p{L}]/u.test(b)) continue;
    return b;
  }
  // Tidak ada baris yang meyakinkan; pakai baris pertama apa adanya.
  const awal = String(caption).split(/\r?\n/).find((x) => x.trim());
  return awal ? awal.trim().slice(0, 90) : null;
}

/** Kelipatan minimum, biasanya ditulis "+50K" atau "Minimal Bid : 50rb". */
export function tebakKelipatan(caption, parseBid) {
  if (!caption) return null;
  const re = /(?:kelipatan|minimal\s*bid|min\s*bid|bid)\s*[:=]?\s*\+?\s*((?:rp\.?\s*)?[\d.,]+\s*(?:jt|juta|rb|ribu|k)?)/gi;
  let m;
  while ((m = re.exec(caption)) !== null) {
    const v = parseBid(m[1]);
    if (v.value != null) return v.value;
  }
  return null;
}

// ---------------------------------------------------------------- kalender

/** Baris ICS wajib dilipat pada 75 oktet; baris panjang ditolak sebagian aplikasi. */
function lipat(baris) {
  const out = [];
  let sisa = baris;
  while (sisa.length > 73) {
    out.push(sisa.slice(0, 73));
    sisa = ' ' + sisa.slice(73);
  }
  out.push(sisa);
  return out.join('\r\n');
}

function esc(teks) {
  return String(teks ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function stampUtc(epoch) {
  return new Date(epoch * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Berkas kalender berisi satu acara per lelang, masing-masing dengan dua alarm.
 * Acaranya sengaja berdurasi nol menit dan diberi nama jelas, supaya di
 * tampilan kalender langsung terbaca lelang mana yang akan tutup.
 */
export function buatIcs(items, { alarmMenit = [30, 5] } = {}) {
  const now = stampUtc(Math.floor(Date.now() / 1000));
  const L = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lelang Insta//Pantauan//ID',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  for (const it of items) {
    if (it.closeAt == null) continue;

    const judul = it.title ? `${it.title}` : 'Lelang Instagram';
    const penjual = it.owner ? `@${it.owner}` : 'penjual tidak diketahui';

    const rincian = [
      `Penjual: ${penjual}`,
      it.openBid != null ? `Harga pembukaan: Rp${it.openBid.toLocaleString('id-ID')}` : null,
      it.increment != null ? `Kelipatan: Rp${it.increment.toLocaleString('id-ID')}` : null,
      it.sniperMin ? `Sniper zone: ${it.sniperMin} menit terakhir` : null,
      it.myBid != null ? `Tawaranku terakhir: Rp${it.myBid.toLocaleString('id-ID')}` : null,
      '',
      it.url || '',
      '',
      'Dicatat lewat Lelang Insta.'
    ].filter((x) => x !== null).join('\n');

    L.push('BEGIN:VEVENT');
    L.push(lipat(`UID:lelanginsta-${esc(it.id)}@lelanginsta`));
    L.push(`DTSTAMP:${now}`);
    L.push(`DTSTART:${stampUtc(it.closeAt)}`);
    L.push(`DTEND:${stampUtc(it.closeAt)}`);
    L.push(lipat(`SUMMARY:${esc(`Lelang tutup — ${judul} (${penjual})`)}`));
    L.push(lipat(`DESCRIPTION:${esc(rincian)}`));
    if (it.url) L.push(lipat(`URL:${esc(it.url)}`));
    L.push('STATUS:CONFIRMED');

    for (const menit of alarmMenit) {
      L.push('BEGIN:VALARM');
      L.push('ACTION:DISPLAY');
      L.push(`TRIGGER:-PT${menit}M`);
      L.push(lipat(`DESCRIPTION:${esc(`${judul} tutup ${menit} menit lagi`)}`));
      L.push('END:VALARM');
    }

    L.push('END:VEVENT');
  }

  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- riwayat

/**
 * Riwayat harga per barang, dari lelang yang sudah selesai.
 * Berguna menentukan batas atas sebelum ikut lelang berikutnya.
 */
export function riwayatHarga() {
  const selesai = baca().filter((x) =>
    (x.status === 'menang' || x.status === 'kalah') && x.finalPrice != null);

  selesai.sort((a, b) => (b.closeAt ?? 0) - (a.closeAt ?? 0));

  const harga = selesai.map((x) => x.finalPrice).sort((a, b) => a - b);
  const tengah = harga.length
    ? harga[Math.floor(harga.length / 2)]
    : null;

  return {
    items: selesai,
    jumlah: selesai.length,
    menang: selesai.filter((x) => x.status === 'menang').length,
    terendah: harga.length ? harga[0] : null,
    tertinggi: harga.length ? harga[harga.length - 1] : null,
    tengah
  };
}

/** Ekspor seluruh pantauan sebagai JSON, supaya bisa dipindah perangkat. */
export function eksporSemua() {
  return JSON.stringify({
    lelanginsta: 'pantauan',
    versi: 1,
    diekspor: Math.floor(Date.now() / 1000),
    akun: akunku(),
    items: baca()
  }, null, 2);
}

export function imporSemua(teks) {
  let d;
  try { d = JSON.parse(teks); } catch { throw new Error('Berkas itu bukan JSON yang sah.'); }
  const masuk = Array.isArray(d) ? d : (d && Array.isArray(d.items) ? d.items : null);
  if (!masuk) throw new Error('Isinya bukan berkas pantauan Lelang Insta.');

  const daftar = baca();
  let baru = 0;
  let diperbarui = 0;
  for (const it of masuk) {
    if (!it || !it.id) continue;
    const i = daftar.findIndex((x) => x.id === it.id);
    if (i >= 0) { daftar[i] = { ...daftar[i], ...it }; diperbarui++; }
    else { daftar.push(it); baru++; }
  }
  tulis(daftar);
  if (d && d.akun && !akunku()) setAkunku(d.akun);
  return { baru, diperbarui };
}
