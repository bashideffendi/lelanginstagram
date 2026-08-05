/**
 * Analisis urutan bid.
 *
 * Catatan penting: Instagram hanya memberi presisi DETIK.
 * Dua bid pada detik yang sama tidak bisa diurutkan dari waktunya.
 * Tie-break memakai comment ID (pk) — ID Instagram naik monoton, jadi
 * pk lebih kecil = dibuat lebih dulu.
 */

/** Urutan kronologis: waktu dulu, lalu pk sebagai pemecah seri. */
export function chronoCompare(a, b) {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  try {
    const pa = BigInt(a.pk), pb = BigInt(b.pk);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  } catch {
    return String(a.pk).localeCompare(String(b.pk));
  }
}

// ------------------------------------------------------------ parsing nilai bid

const UNIT_MULT = {
  jt: 1e6, juta: 1e6, jeti: 1e6, mio: 1e6,
  rb: 1e3, ribu: 1e3, k: 1e3
};

/** Di atas ini pasti bukan tawaran — biasanya nomor telepon atau nomor rekening. */
const BATAS_WAJAR = 1e10;

/** Kata yang biasanya mendahului angka tawaran. */
const KATA_TAWAR = /\b(bid|ob|nawar|menawar|tawar|up|naik|gas|ambil|angkat)\b/gi;

/**
 * Calon nilai: awalan Rp opsional, angka, satuan opsional.
 *
 * Penjaga di kiri dan kanan mencegah angka di dalam kata ikut terambil —
 * tanpa itu "SKX007K" terbaca sebagai tawaran Rp7.000, dan di lelang jam
 * tangan kode model seperti itu muncul terus-menerus.
 */
/*
 * Penjaga tanda hubung, di kedua sisi.
 *
 * Lookbehind lama hanya menolak huruf dan angka yang menempel, jadi angka
 * sesudah tanda hubung lolos: "43-5170" — kode model jam — terbaca sebagai
 * tawaran 5.170, lalu dikalikan skala jadi Rp5.170.000. Angka yang tidak
 * pernah ditawarkan siapa pun, di komentar yang bahkan bukan tawaran.
 *
 * Deret berpenghubung angka selalu kode atau rentang, tidak pernah harga:
 * harga ditulis "750rb" atau "Rp750.000", bukan "43-5170". Jadi ditolak dari
 * dua arah — didahului "angka-", atau diikuti "-angka".
 */
const CALON = new RegExp(
  '(?<![A-Za-z0-9])(?<!\\d-)' +
  '(rp\\.?\\s*)?' +
  '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?' +     // 1.500.000 atau 1.500.000,00
  '|\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?' +     // 1,500,000
  '|\\d+(?:[.,]\\d+)?)' +                        // 1,5 atau 2.30 atau 500
  '\\s*(jt|juta|jeti|mio|rb|ribu|k)?' +
  '(?![A-Za-z0-9])(?!-\\d)',
  'gi'
);

/**
 * Buang nomor telepon sebelum angka dibaca.
 *
 * Penjaga "sepuluh digit tanpa satuan" tidak menolong kalau nomornya ditulis
 * berpenggal — "0812-3456-7890" terbaca sebagai beberapa angka pendek, dan
 * salah satunya bisa jadi tawaran tertinggi. Sepuluh digit atau lebih dalam
 * satu deret, dipisah spasi atau tanda hubung sekalipun, bukan harga.
 */
/**
 * Angka yang jelas-jelas bukan harga, dibuang sebelum dibaca.
 *
 * Di lelang jam tangan, kolom komentar penuh angka yang bukan tawaran: tahun
 * keluaran, diameter, panjang tali, berat. Tahun paling berbahaya karena
 * besarnya kebetulan masuk akal sebagai harga — "ini keluaran tahun 2020 ya
 * om?" di lelang 800rb-an terbaca Rp2.020.000 dan menobatkan penanya sebagai
 * pemenang, sekaligus mencap tawaran sah berikutnya sebagai "bid turun".
 */
function buangBukanHarga(s) {
  return String(s)
    // Tahun: 1900-2100 berdiri sendiri, dengan atau tanpa kata penanda.
    .replace(/(?:\b(?:tahun|thn|th|seri|tipe|type|keluaran|prod(?:uksi)?)\s*[:.]?\s*)?(?<![A-Za-z0-9])(19\d{2}|20\d{2}|2100)(?![A-Za-z0-9])/gi, ' ')
    // Ukuran fisik berspasi: "40 mm", "120 gram", "20 cm".
    .replace(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)?\s*(mm|cm|inch|inci|gram|gr|kg|ml)\b/gi, ' ');
}

/** Kata yang menandai angka sesudahnya sebagai KENAIKAN, bukan harga penuh. */
const KATA_RELATIF = /\b(naik|nambah|tambah|up|plus)\s*$/i;

function buangNomor(s) {
  return String(s).replace(/(?<![A-Za-z0-9])(?:\d[\s.-]?){9,}\d(?![A-Za-z0-9])/g, ' ');
}

/** Ubah tulisan angka jadi bilangan, dengan aturan pemisah Indonesia. */
function toNumber(raw, adaSatuan) {
  const s = String(raw).trim();

  // Berpemisah ribuan, mungkin berekor sen: 1.500.000 atau 1.500.000,00
  const grup = s.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/);
  if (grup) return +grup[1].replace(/[.,]/g, '');

  // Desimal: 1,5 atau 2.30 — hanya masuk akal kalau ada satuan di belakangnya.
  const des = s.match(/^(\d+)[.,](\d{1,2})$/);
  if (des) return adaSatuan ? +(des[1] + '.' + des[2]) : +des[1] + +des[2] / Math.pow(10, des[2].length);

  return +s.replace(/[.,]/g, '');
}

/**
 * Buang jam dari teks supaya tidak terbaca sebagai angka.
 *
 * Hanya bentuk yang benar-benar jam: berpemisah titik dua, atau berpemisah
 * titik tetapi berdampingan dengan kata waktu. Membuang semua "2.30" secara
 * membabi buta ikut menelan tawaran "2.30 jt".
 */
function buangJam(s) {
  return s
    .replace(/(?<![A-Za-z0-9])\d{1,2}:\d{2}(?::\d{2})?(?![A-Za-z0-9])/g, ' ')
    .replace(/\b(?:jam|pukul|tutup|closed?|cd|co|berakhir)\s*\d{1,2}[.:]\d{2}\b/gi, ' ')
    .replace(/\b\d{1,2}[.:]\d{2}\s*(?:wib|wita|wit)\b/gi, ' ');
}

/** Istilah yang muncul di pengumuman aturan lelang, bukan di tawaran. */
const ISTILAH_ATURAN = [
  /\brules?\b/i, /\baturan\b/i, /\bob\b\s*[:.]/i, /kelipatan/i,
  /buy\s*it\s*now/i, /\bbin\b/i, /\bnote\b/i, /wajib/i, /pembayaran/i,
  /penipuan/i, /\bdm\b/i, /rekening|\brek\b/i, /runner\s*up/i, /\bbid\b\s*[:.]/i
];

/**
 * Apakah komentar ini pengumuman aturan, bukan tawaran?
 *
 * Penyelenggara menempelkan aturan lelang sebagai komentar panjang berisi
 * harga awal dan kelipatan. Angka-angka itu bukan tawaran, tapi tanpa
 * penjagaan ini ia terbaca sebagai tawaran tertinggi, memenangkan lelang,
 * lalu membuat semua tawaran asli tampak menurun.
 *
 * Sengaja ketat: tawaran sungguhan selalu pendek ("750", "1,5jt"), tidak
 * pernah berbaris-baris dengan garis pemisah dan daftar syarat.
 */
export function isAnnouncement(text) {
  const s = String(text || '');
  if (s.length < 90) return false;

  const baris = s.split(/\r?\n/).filter((b) => b.trim()).length;
  if (baris < 3) return false;

  const adaGarisPemisah = /[=\-_·•*]{4,}/.test(s);
  const cocok = ISTILAH_ATURAN.filter((re) => re.test(s)).length;

  // Garis pemisah plus satu istilah sudah sangat khas pengumuman.
  // Tanpa garis pemisah, butuh beberapa istilah sekaligus.
  return (adaGarisPemisah && cocok >= 1) || cocok >= 3;
}

/**
 * Tebak nilai tawaran dari teks komentar.
 *
 * Mengembalikan { value, confidence, matched }; value null kalau tidak ada.
 * confidence: 'high' (ada satuan atau awalan Rp), 'medium' (angka berpemisah
 * atau berdigit banyak), 'low' (angka telanjang yang bisa saja bukan tawaran).
 */
export function parseBid(text) {
  const kosong = { value: null, confidence: null, matched: null };
  if (!text) return kosong;

  const clean = buangBukanHarga(buangNomor(buangJam(
    String(text).replace(/@[\w.]+/g, ' ').replace(/#[\w]+/g, ' ')
  )));

  // Posisi kata tawar, dipakai memilih angka mana yang dimaksud.
  const posKata = [];
  KATA_TAWAR.lastIndex = 0;
  let k;
  while ((k = KATA_TAWAR.exec(clean)) !== null) posKata.push(k.index + k[0].length);

  const calon = [];
  CALON.lastIndex = 0;
  let m;
  while ((m = CALON.exec(clean)) !== null) {
    const [full, rp, angka, satuan] = m;
    const unit = satuan ? satuan.toLowerCase() : null;
    const nilai = toNumber(angka, !!unit) * (unit ? UNIT_MULT[unit] : 1);
    if (!Number.isFinite(nilai) || nilai <= 0 || nilai > BATAS_WAJAR) continue;

    const digit = angka.replace(/\D/g, '').length;
    // Deretan angka panjang tanpa satuan dan tanpa Rp hampir pasti nomor telepon.
    if (!unit && !rp && digit >= 10) continue;

    const kuat = !!unit || !!rp;

    // "naik 50" / "up 100" itu KENAIKAN, bukan harga penuh. Nilainya sengaja
    // tidak dikarang jadi prevHigh + 50rb: alat ini dipakai menuduh, dan
    // menghitungkan tawaran yang tidak pernah ditulis orang lebih berbahaya
    // daripada kehilangannya. Ditandai saja, lalu dikeluarkan dari penentuan
    // pemenang di analyze().
    const relatif = !kuat && KATA_RELATIF.test(clean.slice(0, m.index));

    calon.push({
      value: nilai,
      matched: full.trim(),
      kuat,
      relatif,
      confidence: kuat ? 'high'
        : (/[.,]/.test(angka) || digit >= 4) ? 'medium' : 'low',
      dekatKata: posKata.some((p) => m.index >= p && m.index - p <= 15)
    });
  }

  if (!calon.length) return kosong;

  // Yang bersatuan atau ber-Rp paling dipercaya; di antaranya ambil yang terbesar.
  const kuat = calon.filter((c) => c.kuat);
  if (kuat.length) return pilihTerbesar(kuat);

  // Kalau ada yang menempel pada kata seperti "bid" atau "up", itu yang dimaksud.
  const dekat = calon.filter((c) => c.dekatKata);
  if (dekat.length) return pilihTerbesar(dekat);

  // Sisanya: satu angka jelas dipakai; beberapa angka telanjang meragukan,
  // jadi ambil yang terakhir disebut dan turunkan tingkat keyakinannya.
  if (calon.length === 1) return bersih(calon[0]);
  return bersih({ ...calon[calon.length - 1], confidence: 'low' });
}

function pilihTerbesar(list) {
  return bersih(list.reduce((a, b) => (b.value > a.value ? b : a)));
}

function bersih(c) {
  return {
    value: c.value, confidence: c.confidence, matched: c.matched,
    kuat: !!c.kuat, relatif: !!c.relatif
  };
}

function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Tentukan skala untuk angka telanjang.
 *
 * Di lelang Indonesia orang menulis "750" untuk tujuh ratus lima puluh ribu —
 * tidak ada jam tangan seharga Rp750. Tapi mengalikan seribu begitu saja bisa
 * salah untuk barang mahal yang ditawar "16" berarti enam belas juta.
 *
 * Jadi skalanya dikalibrasi dari data itu sendiri: angka yang menyebut
 * satuannya ("750K", "1,5jt", "Rp750.000") memberi tahu besaran yang benar,
 * termasuk yang tertulis di pengumuman aturan. Angka telanjang lalu dinaikkan
 * ke besaran yang sama.
 */
/**
 * Pengali untuk SATU angka telanjang, terhadap satu acuan.
 *
 * Dipisah dari hitungSkala karena satu lelang tidak selalu memakai satu
 * besaran. Tangga paling lazim di lelang Indonesia berpindah notasi begitu
 * melewati sejuta: "800, 850, 900, 950, 1, 1,05, 1,1". Skala tunggal memaksa
 * ketujuhnya memakai pengali yang sama, jadi tiga tawaran TERTINGGI dan
 * penentu terbaca Rp1.000 sampai Rp1.100 — ketiganya dicap turun, dan
 * pemenang sebenarnya lenyap dari berkas bukti.
 *
 * Acuannya harga tertinggi yang sudah sah saat itu (tangga lelang naik), jadi
 * "950" tetap 950 ribu sementara "1,05" sesudahnya jadi 1,05 juta.
 */
export function skalaSatuan(nilai, acuan) {
  if (!Number.isFinite(nilai) || nilai <= 0) return 1;

  // Tanpa acuan sama sekali: angka di bawah sepuluh ribu hampir pasti ribuan.
  if (!acuan) return nilai < 10000 ? 1000 : 1;

  let terbaik = 1;
  let jarakTerdekat = Infinity;
  for (const m of [1, 1e3, 1e6]) {
    const jarak = Math.abs(Math.log10(nilai * m) - Math.log10(acuan));
    if (jarak < jarakTerdekat) { jarakTerdekat = jarak; terbaik = m; }
  }
  return terbaik;
}

export function hitungSkala(nilaiKuat, nilaiTelanjang) {
  if (!nilaiTelanjang.length) return 1;

  const acuan = median(nilaiKuat);
  const polos = median(nilaiTelanjang);
  if (!polos) return 1;

  // Tanpa acuan sama sekali: angka di bawah sepuluh ribu hampir pasti ribuan.
  if (!acuan) return polos < 10000 ? 1000 : 1;

  const pilihan = [1, 1e3, 1e6];
  let terbaik = 1;
  let jarakTerdekat = Infinity;
  for (const m of pilihan) {
    const jarak = Math.abs(Math.log10(polos * m) - Math.log10(acuan));
    if (jarak < jarakTerdekat) { jarakTerdekat = jarak; terbaik = m; }
  }
  return terbaik;
}

export function fmtRupiah(v) {
  if (v == null) return '';
  return v.toLocaleString('id-ID');
}

// ------------------------------------------------------------ analisis utama

/**
 * @param {Array} comments  komentar hasil normalisasi dari dump
 * @param {Object} opts
 *   cutoffEpoch  epoch tutup lelang, atau null
 *   graceSec     jendela "detik-detik akhir" sebelum cutoff (default 60)
 *   includeReplies  ikutkan balasan bersarang
 */
/**
 * Cari harga pembukaan yang tertulis di caption atau aturan lelang.
 * Bentuk yang lazim: "OB : 750K", "Open Bid 750rb", "OB Rp750.000".
 */
/**
 * Harga pembukaan dari caption atau komentar aturan.
 *
 * Ikut melaporkan apakah angkanya kuat — bersatuan atau ber-Rp — karena itu
 * menentukan boleh tidaknya dipakai sebagai acuan kalibrasi skala. "OB 750K"
 * acuan terbaik yang bisa didapat; "OB 100" bukan acuan sama sekali, itu
 * justru angka telanjang yang perlu dikalibrasi juga.
 *
 * Dulu semuanya dianggap kuat, dan akibatnya berantai: angka telanjang 100
 * masuk ke kumpulan acuan, median acuan jadi 100, kalibrasi menyimpulkan skala
 * 1, lalu seluruh tawaran di lelang itu terbaca ratusan rupiah. Kartunya
 * memajang "buka Rp100" — dan itu persis gejalanya.
 */
/**
 * Harga pembukaan siap pakai dari caption saja, tanpa komentar sebagai acuan.
 * Angka telanjang di bawah seribu berarti ribuan — "OB 100" itu Rp100.000.
 */
export function tebakOpenBid(teks) {
  const ob = cariOpenBid(teks);
  if (!ob) return null;
  if (ob.kuat || ob.value >= 1000) return ob.value;

  // Desimal kecil berarti juta, bukan ribu. "OB 1,5" itu satu setengah juta —
  // tidak ada yang membuka lelang di seribu lima ratus rupiah, dan mengalikan
  // seribu menghasilkan angka yang salah tapi tetap kelihatan wajar.
  if (!Number.isInteger(ob.value) && ob.value < 100) return Math.round(ob.value * 1e6);

  return ob.value * 1000;
}

export function cariOpenBid(teks) {
  if (!teks) return null;
  /*
   * Satuan diberi penjaga kanan, dan ekor tanda baca tidak ikut terbawa.
   *
   * Grup satuan lama tidak berbatas kata, jadi ia menelan huruf pertama kata
   * berikutnya: "OB 1,5. Kelipatan 50rb" tertangkap sebagai "1,5. K", dicap
   * bersatuan, dan harga pembukaan terbaca Rp1,5 untuk lelang satu setengah
   * juta. Lebih jauh: nilai palsu-bersatuan itu masuk ke kumpulan acuan
   * kalibrasi, dan seluruh tawaran di lelang itu ikut terbaca ratusan rupiah.
   */
  const re = /\b(?:ob|open\s*bid|opening\s*bid)\b\s*[:=.]?\s*((?:rp\.?\s*)?\d[\d.]*(?:,\d+)?(?:\s*(?:jt|juta|jeti|mio|rb|ribu|k))?)(?![A-Za-z0-9])/gi;
  let m;
  while ((m = re.exec(String(teks))) !== null) {
    const nilai = parseBid(m[1]);
    if (nilai.value != null) {
      return { value: nilai.value, kuat: /(jt|juta|jeti|mio|rb|ribu|k|rp)/i.test(m[1]) };
    }
  }
  return null;
}

/**
 * Komentar yang isinya cuma "OB" berarti menawar di harga pembukaan —
 * bukan komentar kosong tanpa angka.
 */
function menawarDiPembukaan(teks) {
  const s = String(teks || '').trim();
  if (s.length > 40) return false;
  if (/\d/.test(s)) return false;                    // ada angka sendiri, bukan ini
  return /\b(ob|open\s*bid)\b/i.test(s);
}

/**
 * Terapkan aturan sniper zone.
 *
 * Sniper zone adalah N menit terakhir sebelum lelang tutup — untuk tutup
 * 21.00 dengan zona 5 menit, zonanya 20.55 sampai 21.00.
 *
 * Aturannya: yang boleh menawar di dalam zona hanya akun yang SUDAH pernah
 * menawar sebelum zona dimulai. Akun yang baru muncul di zona itu tidak
 * berhak; tawarannya tidak sah. Aturan ini menutup celah orang yang menunggu
 * di menit terakhir lalu menyalip tanpa pernah ikut menaikkan harga.
 *
 * Tidak semua penjual memakainya, jadi zona nol berarti aturan ini mati.
 */
export function terapkanSniperZone(rows, cutoff, sniperSec) {
  const mati = { aktif: false, mulai: null, pelanggar: [] };
  if (cutoff == null || !sniperSec) return mati;

  const mulai = cutoff - sniperSec;
  const pelanggar = [];

  const nama = (r) => String(r.username || '').toLowerCase();
  const praZona = (r) => !r.isOwner && !r.isAnnouncement && r.created_at < mulai;

  // Siapa saja yang sudah menawar sebelum zona dimulai. Tawaran relatif
  // ("naik 50") ikut dihitung: nilainya memang tidak kami hitung, tapi orangnya
  // jelas sudah ikut menawar — dan itu yang ditanyakan aturannya.
  const sudahMenawar = new Set(
    rows.filter((r) => praZona(r) && (r.bid != null || r.bidRelatif)).map(nama)
  );

  /*
   * Yang pra-zonanya BERANGKA tapi gagal kami baca nilainya.
   *
   * Aturan sniper zone dinilai dari "sudah pernah menawar atau belum", dan
   * jawaban itu di sini bersandar pada pembaca tawaran yang bisa meleset.
   * Kalau seseorang menulis angka sebelum zona dibuka tapi kami gagal
   * membacanya, kami TIDAK BOLEH menyimpulkan dia belum menawar — menuduh
   * orang melanggar dengan nama dan jam di berkas sanggahan adalah kesalahan
   * yang paling mahal yang bisa dibuat alat ini.
   *
   * Keadaan begitu ditandai ragu, bukan ilegal, supaya diperiksa mata dulu.
   */
  const raguMenawar = new Set(
    rows
      .filter((r) => praZona(r) && r.bid == null && !r.bidRelatif && /\d/.test(r.text || ''))
      .map(nama)
  );

  for (const r of rows) {
    if (r.bid == null || r.isOwner || r.isAnnouncement) continue;
    if (r.created_at < mulai || r.created_at > cutoff) continue;

    r.diZonaSniper = true;
    const u = nama(r);
    if (sudahMenawar.has(u)) continue;

    if (raguMenawar.has(u)) {
      r.sniperRagu = true;                       // perlu diperiksa, bukan dituduh
      continue;
    }
    r.sniperIlegal = true;
    pelanggar.push(r);
  }

  return { aktif: true, mulai, pelanggar, ragu: rows.filter((r) => r.sniperRagu) };
}

export function analyze(comments, opts = {}) {
  const {
    cutoffEpoch = null, graceSec = 60, includeReplies = true,
    ownerUsername = null, sniperSec = 0, captionText = null
  } = opts;

  const owner = ownerUsername ? String(ownerUsername).toLowerCase() : null;

  const rows = comments
    .filter((c) => (includeReplies ? true : !c.is_reply))
    .slice()
    .sort(chronoCompare)
    .map((c, i) => ({ ...c, seq: i + 1 }));

  // Kelompok detik kembar — bid yang jamnya identik.
  const bySecond = new Map();
  for (const r of rows) {
    if (!bySecond.has(r.created_at)) bySecond.set(r.created_at, []);
    bySecond.get(r.created_at).push(r);
  }

  // --- Lintasan pertama: baca angka apa adanya, kenali peran tiap komentar.
  for (const r of rows) {
    // Penyelenggara bukan peserta. Pengumuman aturan lelang hampir selalu
    // memuat angka — harga awal, kelipatan — dan kalau angka itu ikut dihitung,
    // penyelenggaranya sendiri bisa dinobatkan sebagai pemenang, lalu semua
    // tawaran asli dicap "nilai turun" karena dibandingkan dengannya.
    r.isOwner = !!owner && String(r.username || '').toLowerCase() === owner;

    // Pengumuman aturan dikenali dari bentuknya sendiri, jadi tetap tertangkap
    // walaupun Instagram tidak memberi tahu siapa pemilik postingannya.
    r.isAnnouncement = isAnnouncement(r.text);

    const bid = parseBid(r.text);
    r.bidRaw = bid.value;
    r.bidStrong = bid.kuat;
    r.bidRelatif = !!bid.relatif;
    r.bidConfidence = bid.confidence;
    r.bidMatched = bid.matched;
  }

  // Harga pembukaan: dari caption, atau dari komentar aturan lelang.
  const ob = cariOpenBid(captionText) ||
    cariOpenBid(rows.filter((r) => r.isAnnouncement || r.isOwner).map((r) => r.text).join('\n'));

  // Komentar "OB" tanpa angka berarti menawar di harga pembukaan itu.
  if (ob) {
    for (const r of rows) {
      if (r.bidRaw == null && !r.isAnnouncement && menawarDiPembukaan(r.text)) {
        r.bidRaw = ob.value;
        // Sekuat sumbernya, tidak lebih. Kalau aturannya menulis "OB 100"
        // tanpa satuan, tawaran ini pun angka telanjang dan ikut dikalibrasi.
        r.bidStrong = ob.kuat;
        r.bidConfidence = ob.kuat ? 'high' : 'medium';
        r.bidMatched = 'OB';
        r.isOpenBid = true;
      }
    }
  }

  // --- Kalibrasi skala. Angka bersatuan dari mana pun boleh jadi acuan,
  // termasuk "OB : 750K" di pengumuman aturan — itu justru acuan terbaik.
  const acuan = rows.filter((r) => r.bidRaw != null && r.bidStrong).map((r) => r.bidRaw);
  const polos = rows
    .filter((r) => r.bidRaw != null && !r.bidStrong && !r.isOwner && !r.isAnnouncement)
    .map((r) => r.bidRaw);
  const skala = hitungSkala(acuan, polos);

  /*
   * Tiap angka telanjang diskalakan terhadap harga tertinggi yang sudah sah
   * SAAT ITU, bukan terhadap satu angka untuk seluruh lelang.
   *
   * Tangga lelang naik, jadi harga tertinggi sejauh ini adalah acuan terbaik
   * yang tersedia pada tiap baris — dan satu-satunya yang ikut berpindah saat
   * tangganya menyeberang ke notasi juta.
   */
  let acuanBerjalan = acuan.length ? median(acuan) : (polos.length ? median(polos) * skala : null);

  for (const r of rows) {
    if (r.bidRaw == null) {
      r.bid = null;
      r.bidScaled = false;
      continue;
    }

    if (r.bidStrong) {
      r.bid = r.bidRaw;
      r.bidScaled = false;
    } else {
      const m = skalaSatuan(r.bidRaw, acuanBerjalan);
      r.bid = r.bidRaw * m;
      r.bidScaled = m !== 1;
    }

    // Acuan hanya dinaikkan oleh tawaran peserta yang sah; komentar
    // penyelenggara dan pengumuman aturan tidak menggerakkan tangga.
    if (!r.isOwner && !r.isAnnouncement && !r.bidRelatif &&
        (acuanBerjalan == null || r.bid > acuanBerjalan)) {
      acuanBerjalan = r.bid;
    }
  }

  // Harga pembukaan ikut dikalibrasi kalau angkanya telanjang, supaya tidak
  // jadi satu-satunya nilai di layar yang memakai skala berbeda dari sisanya.
  // Kalau kalibrasinya tidak punya bahan — misalnya semua tawaran di komentar
  // bersatuan sementara aturannya menulis "OB 100" — aturan telanjangnya tetap
  // berlaku sendiri. Tidak ada lelang jam tangan seharga seratus rupiah.
  const openBid = ob
    ? (ob.kuat ? ob.value : ob.value * (skala !== 1 ? skala : (ob.value < 1000 ? 1000 : 1)))
    : null;

  // --- Sniper zone menentukan tawaran mana yang tidak berhak, jadi dihitung
  // sebelum pemenang dipilih. Ia tidak menggeser waktu tutup.
  const sniper = terapkanSniperZone(rows, cutoffEpoch, sniperSec);
  const cutoffBerlaku = cutoffEpoch;

  // --- Lintasan kedua: urutan, penandaan, dan tangga tawaran.
  let prevHighBid = null;
  let prev = null;

  for (const r of rows) {
    r.gap = prev ? r.created_at - prev.created_at : null;
    r.sinceStart = rows.length ? r.created_at - rows[0].created_at : 0;

    const group = bySecond.get(r.created_at);
    r.tie = group.length > 1;
    r.tieSize = group.length;
    r.tieIndex = group.indexOf(r) + 1;

    r.flags = [];
    if (r.isOwner) r.flags.push('penyelenggara');
    else if (r.isAnnouncement) r.flags.push('pengumuman');
    if (r.sniperIlegal) r.flags.push('sniper-ilegal');
    if (r.sniperRagu) r.flags.push('sniper-ragu');

    if (cutoffBerlaku != null) {
      if (r.created_at > cutoffBerlaku) {
        r.late = r.created_at - cutoffBerlaku;
        r.flags.push('lewat-cutoff');
      } else if (cutoffBerlaku - r.created_at <= graceSec) {
        r.snipe = cutoffBerlaku - r.created_at;
        r.flags.push('detik-akhir');
      }
    }

    if (r.tie) r.flags.push('detik-kembar');

    // Tangga tawaran hanya menghitung peserta; komentar penyelenggara
    // dilewati sepenuhnya, tidak menaikkan maupun dibandingkan.
    // Nilainya kenaikan, bukan harga penuh — jadi tidak boleh dibandingkan
    // dengan tangga maupun mencapnya turun.
    if (r.bidRelatif) r.flags.push('bid-relatif');

    if (r.bid != null && !r.isOwner && !r.isAnnouncement && !r.bidRelatif) {
      if (prevHighBid != null) {
        r.increment = r.bid - prevHighBid;
        if (r.bid < prevHighBid) r.flags.push('bid-turun');
        else if (r.bid === prevHighBid) r.flags.push('bid-sama');
      }
      if (prevHighBid == null || r.bid > prevHighBid) prevHighBid = r.bid;
    }
    r.runningHigh = prevHighBid;

    prev = r;
  }

  // Bid berturut-turut dari akun yang sama dalam waktu dekat.
  const lastByUser = new Map();
  for (const r of rows) {
    const u = r.username || '(tanpa nama)';
    const last = lastByUser.get(u);
    if (last != null && r.created_at - last <= 5) r.flags.push('beruntun');
    lastByUser.set(u, r.created_at);
  }

  return {
    rows,
    accounts: perAccount(rows, cutoffBerlaku),
    summary: {
      ...summarize(rows, cutoffBerlaku),
      bidScale: skala, cutoffAsli: cutoffEpoch, sniper, openBid
    }
  };
}

function perAccount(rows, cutoffEpoch) {
  const map = new Map();

  for (const r of rows) {
    const u = r.username || '(tanpa nama)';
    let a = map.get(u);
    if (!a) {
      a = {
        username: u,
        user_pk: r.user_pk,
        full_name: r.full_name,
        count: 0,
        replies: 0,
        first: r.created_at,
        last: r.created_at,
        maxBid: null,
        lateCount: 0,
        lateBidCount: 0,
        snipeCount: 0,
        downCount: 0,
        gaps: []
      };
      map.set(u, a);
    }
    a.count++;
    if (r.is_reply) a.replies++;
    a.first = Math.min(a.first, r.created_at);
    // Jeda nol detik ikut dihitung. Tanpa itu, akun yang menembakkan tiga
    // tawaran dalam satu detik justru tampak paling santai.
    if (a.count > 1) a.gaps.push(Math.max(0, r.created_at - a.last));
    if (r.created_at > a.last) a.last = r.created_at;
    if (r.isOwner) a.isOwner = true;
    if (r.bid != null && !r.isOwner && !r.isAnnouncement && (a.maxBid == null || r.bid > a.maxBid)) a.maxBid = r.bid;
    if (r.flags.includes('lewat-cutoff')) {
      a.lateCount++;
      if (r.bid != null) a.lateBidCount++;
    }
    if (r.flags.includes('detik-akhir')) a.snipeCount++;
    if (r.flags.includes('bid-turun')) a.downCount++;
  }

  const list = [...map.values()];
  const lastBid = rows.length ? rows[rows.length - 1].created_at : null;

  for (const a of list) {
    a.span = a.last - a.first;
    a.avgGap = a.gaps.length
      ? Math.round(a.gaps.reduce((x, y) => x + y, 0) / a.gaps.length)
      : null;
    delete a.gaps;
    // Akun yang baru muncul di 10% waktu terakhir lelang.
    if (cutoffEpoch != null && rows.length) {
      const start = rows[0].created_at;
      const end = cutoffEpoch;
      a.lateEntrant = end > start && a.first >= start + (end - start) * 0.9;
    } else if (lastBid != null && rows.length) {
      const start = rows[0].created_at;
      a.lateEntrant = lastBid > start && a.first >= start + (lastBid - start) * 0.9;
    }
  }

  list.sort((x, y) => y.count - x.count || x.first - y.first);
  return list;
}

function summarize(rows, cutoffEpoch) {
  // Peserta dan tawaran dihitung tanpa penyelenggara: dia tidak ikut lelang,
  // dan angka di pengumuman aturannya bukan tawaran.
  const peserta = rows.filter((r) => !r.isOwner && !r.isAnnouncement);
  const users = new Set(peserta.map((r) => r.username || '(tanpa nama)'));
  const withBid = peserta.filter((r) => r.bid != null);
  const tieGroups = new Set(rows.filter((r) => r.tie).map((r) => r.created_at));

  return {
    total: rows.length,
    topLevel: rows.filter((r) => !r.is_reply).length,
    replies: rows.filter((r) => r.is_reply).length,
    users: users.size,
    first: rows.length ? rows[0].created_at : null,
    last: rows.length ? rows[rows.length - 1].created_at : null,
    span: rows.length ? rows[rows.length - 1].created_at - rows[0].created_at : 0,
    late: rows.filter((r) => r.flags.includes('lewat-cutoff')).length,
    // Yang menentukan sengketa adalah bid yang lewat cutoff, bukan obrolan biasa.
    lateBids: rows.filter((r) => r.flags.includes('lewat-cutoff') && r.bid != null).length,
    snipe: rows.filter((r) => r.flags.includes('detik-akhir')).length,
    tieRows: rows.filter((r) => r.tie).length,
    tieGroups: tieGroups.size,
    sniperIlegal: rows.filter((r) => r.sniperIlegal).length,
    bidDown: rows.filter((r) => r.flags.includes('bid-turun')).length,
    bidSame: rows.filter((r) => r.flags.includes('bid-sama')).length,
    parsedBids: withBid.length,
    highBid: withBid.length ? Math.max(...withBid.map((r) => r.bid)) : null,
    cutoff: cutoffEpoch,
    // Bid sah tertinggi = bid terbesar yang masuk sebelum cutoff.
    winner: (() => {
      // Tawaran yang melanggar sniper zone tidak berhak menang.
      const eligible = rows.filter(
        (r) => r.bid != null && !r.isOwner && !r.isAnnouncement && !r.sniperIlegal &&
          !r.bidRelatif &&
          (cutoffEpoch == null || r.created_at <= cutoffEpoch)
      );
      if (!eligible.length) return null;
      const max = Math.max(...eligible.map((r) => r.bid));
      // Kalau nilai sama, yang duluan menang.
      return eligible.filter((r) => r.bid === max).sort(chronoCompare)[0];
    })()
  };
}
