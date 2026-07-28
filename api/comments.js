/**
 * Mode server: menarik komentar tanpa extension, seperti commentgrid.
 *
 * BACA INI SEBELUM MENGAKTIFKAN.
 *
 * Endpoint ini memakai sesi Instagram yang tersimpan di variabel lingkungan.
 * Semua permintaan yang lewat sini terlihat oleh Instagram sebagai perbuatan
 * akun tersebut, dari IP pusat data Vercel — pola yang memang rutin dibatasi
 * Instagram. Karena itu:
 *
 *   - Pakai akun Instagram KHUSUS, bukan akun yang kamu pakai ikut lelang.
 *     Kalau akun itu dibatasi, tidak ada yang hilang.
 *   - Endpoint wajib digembok. Tanpa KETOK_KEY ia menolak melayani, supaya
 *     akun tadi tidak dipakai orang lain lewat internet.
 *
 * Variabel lingkungan:
 *   KETOK_KEY       WAJIB. Kata sandi bebas. Tanpa ini endpoint mati total.
 *   IG_SESSIONID    WAJIB. Nilai cookie `sessionid` dari akun khusus tadi.
 *   IG_DS_USER_ID   Opsional tapi disarankan, cookie `ds_user_id`.
 *   IG_CSRFTOKEN    Opsional, cookie `csrftoken`.
 *
 * Kalau salah satu yang wajib kosong, endpoint menjawab 503 dengan penjelasan
 * dan halaman Ketok akan tetap menyarankan extension.
 */
import { extract } from '../shared/ig-core.js';

const IG_BASE = 'https://www.instagram.com';

function cookieHeader() {
  const parts = [];
  if (process.env.IG_SESSIONID) parts.push('sessionid=' + process.env.IG_SESSIONID);
  if (process.env.IG_DS_USER_ID) parts.push('ds_user_id=' + process.env.IG_DS_USER_ID);
  if (process.env.IG_CSRFTOKEN) parts.push('csrftoken=' + process.env.IG_CSRFTOKEN);
  return parts.join('; ');
}

/** Perbandingan panjang-tetap supaya kunci tidak bisa ditebak lewat waktu respons. */
function safeEqual(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Hanya menerima GET.' });
  }

  const key = process.env.KETOK_KEY;
  if (!key) {
    return res.status(503).json({
      error: 'nonaktif',
      message: 'Mode server belum diaktifkan. Pakai extension Ketok, atau setel ' +
        'KETOK_KEY dan IG_SESSIONID di Environment Variables pada project Vercel.'
    });
  }

  if (!safeEqual(req.headers['x-ketok-key'], key)) {
    return res.status(401).json({
      error: 'kunci_salah',
      message: 'Kunci mode server salah atau belum diisi.'
    });
  }

  const cookie = cookieHeader();
  if (!cookie.includes('sessionid=')) {
    return res.status(503).json({
      error: 'sesi_kosong',
      message: 'IG_SESSIONID belum disetel di server, jadi mode server tidak bisa ' +
        'menarik apa pun. Pakai extension Ketok untuk sementara.'
    });
  }

  const url = String(req.query.url || '');
  if (!url) return res.status(400).json({ error: 'url_kosong', message: 'Parameter url wajib diisi.' });

  try {
    const dump = await extract({
      base: IG_BASE,
      url,
      version: 'server-1.0.0',
      via: 'server',
      includeRaw: req.query.raw !== '0',
      headers: { cookie }
    });
    return res.status(200).json(dump);
  } catch (e) {
    const status = e.status || 500;
    const message =
      status === 401 || status === 403
        ? 'Sesi Instagram di server sudah kedaluwarsa. Login ulang dengan akun khusus itu ' +
          'lalu perbarui IG_SESSIONID.'
        : status === 429
          ? 'Instagram sedang membatasi permintaan dari server. Tunggu beberapa menit, ' +
            'atau pakai extension yang menarik dari browser kamu sendiri.'
          : status === 404
            ? 'Postingan tidak ditemukan, sudah dihapus, atau akunnya privat.'
            : e.message;
    // 4xx dari Instagram bukan kesalahan pemanggil, jadi dipetakan ke 502.
    return res.status(status >= 400 && status < 500 ? 502 : 500).json({
      error: 'gagal_menarik', status, message
    });
  }
}
