/**
 * Keputusan menawar otomatis.
 *
 * Gaya proxy bidding seperti Yahoo Auction: kamu menetapkan batas atas di
 * depan, alat ini menawar sekadar cukup untuk memimpin, dan berhenti begitu
 * harga melewati batas itu. Kalah dengan sadar lebih baik daripada menang di
 * harga yang tidak kamu setujui.
 *
 * Seluruh keputusannya ada di satu fungsi murni tanpa jaringan dan tanpa
 * tampilan, supaya bisa diuji sampai ke sudut-sudutnya. Yang menembak hanya
 * boleh menembak kalau fungsi ini bilang boleh — tidak ada jalan lain, dan
 * tidak ada keputusan yang diambil di tempat lain.
 */

/** Alasan yang mungkin dikembalikan; dipakai juga sebagai kunci pesan. */
export const SEBAB = {
  MATI: 'mati',
  TANPA_BATAS: 'tanpa_batas',
  TANPA_KELIPATAN: 'tanpa_kelipatan',
  TANPA_JAM: 'tanpa_jam',
  SUDAH_TUTUP: 'sudah_tutup',
  BELUM_WAKTUNYA: 'belum_waktunya',
  BELUM_MENAWAR: 'belum_menawar',
  MEMIMPIN: 'memimpin',
  LEWAT_BATAS: 'lewat_batas',
  SUDAH_DITEMBAK: 'sudah_ditembak',
  TEMBAK: 'tembak'
};

const PESAN = {
  [SEBAB.MATI]: 'Menawar otomatis mati untuk lelang ini.',
  [SEBAB.TANPA_BATAS]: 'Batas atas belum diisi — tanpa itu tidak ada yang menghentikan tawaran.',
  [SEBAB.TANPA_KELIPATAN]: 'Kelipatan belum diketahui, jadi tawaran berikutnya tidak bisa dihitung.',
  [SEBAB.TANPA_JAM]: 'Jam tutup belum diketahui.',
  [SEBAB.SUDAH_TUTUP]: 'Lelangnya sudah tutup.',
  [SEBAB.BELUM_MENAWAR]: 'Akun penembak belum pernah menawar sendiri di lelang ini.',
  [SEBAB.MEMIMPIN]: 'Kamu sudah memimpin — menawar lagi berarti menaikkan harga sendiri.',
  [SEBAB.LEWAT_BATAS]: 'Harga sudah melewati batas atasmu. Kita kalah.',
  [SEBAB.SUDAH_DITEMBAK]: 'Sudah ditembakkan sekali untuk lelang ini.'
};

/**
 * Tawaran berikutnya yang sah: harga tertinggi ditambah satu kelipatan.
 *
 * Kalau belum ada tawaran sama sekali, harga pembukaan yang berlaku — tapi
 * keadaan itu praktis tidak terjadi, karena syarat memakai alat ini adalah
 * kamu sudah menawar lebih dulu dengan tangan sendiri.
 */
export function tawaranBerikut(it) {
  if (it.topBid == null) return it.openBid ?? null;
  if (it.increment == null) return null;
  return it.topBid + it.increment;
}

/**
 * Boleh menembak sekarang?
 *
 * Dua daftar akun, dan bedanya penting:
 *
 *   akunSaya      semua akun milikmu. Dipakai memutuskan apakah kamu sudah
 *                 memimpin — kalau salah satunya yang tertinggi, menembak
 *                 berarti menawar melawan dirimu sendiri.
 *   akunPenembak  akun yang sesinya dipegang alat ini, satu-satunya yang bisa
 *                 benar-benar berkomentar. Syarat sniper zone melekat pada
 *                 akun INI, bukan pada akunmu yang lain: yang berhak menawar
 *                 di dalam zona hanya yang sudah menawar sebelum zona dibuka,
 *                 dan penjual menilainya per akun.
 *
 * @param it   catatan lelang
 * @param now  detik sekarang, dari jam yang sudah dikoreksi
 */
export function putusan(it, { now, akunSaya = [], akunPenembak = '' }) {
  const tidak = (kode, tambahan = {}) =>
    ({ tembak: false, kode, pesan: PESAN[kode] || kode, ...tambahan });

  if (!it.autoBid) return tidak(SEBAB.MATI);
  if (it.autoTembakPada) return tidak(SEBAB.SUDAH_DITEMBAK);
  if (it.maksBid == null) return tidak(SEBAB.TANPA_BATAS);
  if (it.closeAt == null) return tidak(SEBAB.TANPA_JAM);
  if (now > it.closeAt) return tidak(SEBAB.SUDAH_TUTUP);

  /*
   * Syarat sniper zone dipenuhi tanganmu sendiri, bukan oleh alat ini.
   *
   * Di lelang bersniper zone, yang belum pernah menawar sebelum zona dibuka
   * tidak berhak menawar di dalamnya. Menembakkan tawaran pertama lewat alat
   * ini berarti tawaran itu batal menurut aturan penjualnya sendiri — dan
   * seluruh gunanya alat ini adalah menang dengan cara yang tidak bisa
   * disanggah.
   */
  const peta = it.tawaranPer || {};
  const penembak = String(akunPenembak || '').toLowerCase();

  /*
   * Yang menembak selalu akun yang sesinya dipegang alat ini, apa pun akun
   * yang kamu tandai untuk lelang itu. Penandaan di kartu cuma menentukan
   * tawaran siapa yang ditampilkan sebagai "Tawaranmu"; menembak dengan akun
   * yang sesinya tidak ada memang mustahil, dan berpura-pura bisa cuma
   * menunda kegagalannya sampai lelang tutup.
   */
  if (!penembak || peta[penembak] == null) return tidak(SEBAB.BELUM_MENAWAR);

  /*
   * Memimpin dinilai atas SEMUA akunmu, bukan cuma akun penembaknya.
   *
   * Kalau akunmu yang lain yang tertinggi, menembak berarti menyalip dirimu
   * sendiri: harganya naik, yang membayar tetap kamu, dan bagi penjual dua
   * akun yang saling menyalip terlihat seperti shill bidding.
   */
  const milikku = akunSaya.length ? akunSaya : [penembak];
  const tertinggiku = milikku
    .map((u) => peta[u])
    .filter((v) => typeof v === 'number')
    .reduce((a, b) => Math.max(a, b), -Infinity);

  /*
   * Seri BUKAN memimpin.
   *
   * Nilai yang sama dengan tawaran tertinggi dibaca sebagai "sudah memimpin",
   * padahal di lelang yang menang adalah yang lebih dulu — dan kalau lawan
   * yang lebih dulu, kamu sedang kalah. Alat ini lalu menolak menembak tepat
   * di keadaan yang paling butuh ditembak: harga seri, tinggal beberapa detik,
   * dan satu kelipatan sudah cukup untuk membalik.
   */
  const tertinggi = it.topBid;
  const akuYangTeratas = milikku.includes(String(it.topUser || '').toLowerCase());
  if (tertinggi != null && tertinggiku >= tertinggi && akuYangTeratas) {
    return tidak(SEBAB.MEMIMPIN);
  }

  const nilai = tawaranBerikut(it);
  if (nilai == null) return tidak(SEBAB.TANPA_KELIPATAN);

  // Batasnya batas: sama dengan batas masih boleh, lewat sedikit pun tidak.
  if (nilai > it.maksBid) {
    return tidak(SEBAB.LEWAT_BATAS, { nilai, kurang: nilai - it.maksBid });
  }

  const jarak = it.closeAt - now;
  if (jarak > (it.leadDetik || 5)) return tidak(SEBAB.BELUM_WAKTUNYA, { nilai, jarak });

  return {
    tembak: true,
    kode: SEBAB.TEMBAK,
    nilai,
    pesan: `Akan menawar Rp${nilai.toLocaleString('id-ID')}.`
  };
}

/**
 * Bagaimana angkanya dituliskan sebagai komentar.
 *
 * Bentuk lengkap dengan "Rp" dan pemisah ribuan dipilih karena komentar ini
 * juga jadi bukti: "900" bisa diperdebatkan artinya, "Rp900.000" tidak.
 */
export function teksTawaran(nilai, pola) {
  if (pola) return String(pola).replace('{nilai}', nilai.toLocaleString('id-ID'));
  return 'Rp' + nilai.toLocaleString('id-ID');
}
