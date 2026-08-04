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

const KUNCI_WAKTU = 'lelanginsta_pantau_waktu';

function tulis(daftar, { stempel = true } = {}) {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(daftar));
    // Waktu ubah terakhir dipakai memutuskan mana yang lebih baru saat
    // isi di browser ini bertemu isi yang tersimpan di server.
    if (stempel) localStorage.setItem(KUNCI_WAKTU, String(Date.now()));
    return true;
  } catch {
    return false;        // mode privat atau kuota penuh
  }
}

export function waktuUbah() {
  try { return Number(localStorage.getItem(KUNCI_WAKTU) || 0); } catch { return 0; }
}

/** Ganti seluruh isi dengan yang datang dari server, tanpa mengubah stempel. */
export function timpaSemua(items, waktu) {
  tulis(Array.isArray(items) ? items : [], { stempel: false });
  try { localStorage.setItem(KUNCI_WAKTU, String(waktu || Date.now())); } catch { /* diabaikan */ }
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

/*
 * Nama barang sengaja TIDAK ditebak.
 *
 * Tiap penjual menulis caption dengan gaya sendiri, dan tidak ada pola yang
 * bertahan di antara mereka. Penebak lamanya sudah dua kali salah dengan cara
 * yang berbeda: sekali mengambil tata tertib ("Mohon dibaca keterangan sebelum
 * bid"), sekali mengambil spesifikasi ("Lingkar pergelangan +- 15 cm"). Tiap
 * perbaikan cuma memindahkan salahnya ke bentuk baru.
 *
 * Kolomnya dibiarkan kosong dan bisa diisi sendiri. Kartu tetap terbaca tanpa
 * itu, karena yang memimpin kartu adalah nama penjual — data pasti dari
 * Instagram. Kosong lebih jujur daripada salah: kolom kosong terlihat sebagai
 * sesuatu yang perlu diisi, kalimat salah terlihat sebagai sesuatu yang sudah
 * benar.
 *
 * Harga pembukaan dan kelipatan tetap ditebak. Keduanya ditulis dengan kata
 * kunci yang seragam antar penjual — "OB", "kelipatan" — jadi tebakannya
 * berpijak pada pola nyata, bukan pada tata letak caption.
 */

/**
 * Buang judul yang terlanjur tersimpan dari tebakan lama.
 *
 * Membiarkannya berarti sebagian kartu memajang tebakan dan sebagian tidak,
 * tanpa cara membedakan mana yang mana. Judul yang kamu ketik sendiri tidak
 * disentuh.
 */
export function bersihkanJudulTebakan() {
  const daftar = baca();
  let dibuang = 0;

  for (const it of daftar) {
    if ((it.manual || []).includes('title')) continue;
    if (it.title == null) continue;
    it.title = null;
    dibuang++;
  }

  if (dibuang) tulis(daftar);
  return dibuang;
}

/**
 * Betulkan harga pembukaan dan kelipatan yang terlanjur tersimpan telanjang.
 *
 * Aturan "50 berarti Rp50.000" diperbaiki di penebaknya, tapi penebak hanya
 * berjalan saat penarikan berikutnya. Lelang yang sudah dipantau tetap
 * memajang "buka Rp100" sampai kebetulan diperiksa lagi — dan justru kartu
 * itulah yang dilihat tiap hari. Nilai yang kamu isi sendiri tidak disentuh.
 */
export function perbaikiAngkaTelanjang() {
  const daftar = baca();
  let diperbaiki = 0;

  for (const it of daftar) {
    const manual = it.manual || [];
    for (const f of ['openBid', 'increment']) {
      if (manual.includes(f)) continue;
      const v = it[f];
      if (typeof v === 'number' && v > 0 && v < 1000) { it[f] = v * 1000; diperbaiki++; }
    }
  }

  if (diperbaiki) tulis(daftar);
  return diperbaiki;
}

export function tebakKelipatan(caption, parseBid) {
  if (!caption) return null;
  const nilai = '((?:rp\\.?\\s*)?[\\d.,]+\\s*(?:jt|juta|rb|ribu|k)?)';
  const re = new RegExp(
    '(?:kelipatan|minimal\\s*bid|min\\.?\\s*bid|increment|naik(?:an)?)\\s*[:=]?\\s*\\+?\\s*' + nilai +
    '|(?:^|[\\s(])\\+\\s*' + nilai,
    'gi');

  let m;
  while ((m = re.exec(caption)) !== null) {
    const v = parseBid(m[1] ?? m[2]);
    if (v.value == null) continue;
    const teks = m[1] ?? m[2];

    // "kelipatan 50" maksudnya Rp50.000, bukan Rp50. Aturan yang sama sudah
    // dipakai untuk tawaran di komentar; tanpa ini, kartunya memajang
    // "naik Rp50" — angka yang tidak pernah ada di lelang mana pun, dan
    // salahnya tidak kentara karena bentuknya tetap masuk akal.
    const telanjang = !/(jt|juta|rb|ribu|k|\.|,)/i.test(teks);
    return telanjang && v.value < 1000 ? v.value * 1000 : v.value;
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
 * Kapan pengingatnya berbunyi, dihitung mundur dari jam tutup.
 *
 * Bukan sekadar "beberapa menit sebelum tutup". Kalau lelangnya memakai sniper
 * zone, tenggat yang benar-benar menentukan bukan jam tutup melainkan saat
 * zona itu dibuka: siapa yang belum pernah menawar sebelum zona dimulai tidak
 * boleh ikut menawar di dalamnya. Terlambat semenit di titik itu berarti gugur
 * sama sekali, bukan sekadar kehilangan satu putaran — jadi di situlah
 * pengingatnya paling berguna, bukan di menit-menit terakhir saat pintunya
 * sudah tertutup.
 *
 * Tiga menit dipilih sebagai jarak siap-siap: cukup untuk membuka Instagram
 * dan mengetik satu tawaran, tapi belum cukup lama untuk keburu lupa lagi.
 */
export function pengingat(it) {
  const per = new Map([
    [5, 'tutup 5 menit lagi'],
    [3, 'tutup 3 menit lagi']
  ]);

  if (it.sniperMin) {
    // Ditimpa kalau bentrok: menyebut zona lebih berguna daripada menyebut
    // sisa waktu, karena yang satu memberi tahu apa yang harus dikerjakan.
    per.set(it.sniperMin + 3,
      `sniper zone mulai 3 menit lagi — kalau belum pernah menawar, ini kesempatan terakhir`);
  }

  return [...per.entries()]
    .sort((a, b) => b[0] - a[0])          // terjauh dulu
    .map(([menit, teks]) => ({ menit, teks }));
}

/**
 * Berkas kalender berisi satu acara per lelang, masing-masing dengan alarmnya.
 * Acaranya diberi nama jelas supaya di tampilan kalender langsung terbaca
 * lelang mana yang akan tutup.
 */
export function buatIcs(items, { alarmMenit = null } = {}) {
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
    // Panjang 15 menit, bukan nol — acara tanpa durasi tidak punya tinggi di
    // tampilan kalender dan terlihat seperti tidak tersimpan.
    L.push(`DTSTART:${stampUtc(it.closeAt)}`);
    L.push(`DTEND:${stampUtc(it.closeAt + 15 * 60)}`);
    L.push(lipat(`SUMMARY:${esc(`Lelang tutup — ${judul} (${penjual})`)}`));
    L.push(lipat(`DESCRIPTION:${esc(rincian)}`));
    if (it.url) L.push(lipat(`URL:${esc(it.url)}`));
    L.push('STATUS:CONFIRMED');

    const alarm = alarmMenit
      ? alarmMenit.map((menit) => ({ menit, teks: `tutup ${menit} menit lagi` }))
      : pengingat(it);

    for (const { menit, teks } of alarm) {
      L.push('BEGIN:VALARM');
      L.push('ACTION:DISPLAY');
      L.push(`TRIGGER:-PT${menit}M`);
      L.push(lipat(`DESCRIPTION:${esc(`${judul} — ${teks}`)}`));
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
