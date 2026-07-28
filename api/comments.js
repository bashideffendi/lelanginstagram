/**
 * Mode server: menarik komentar tanpa perlu memasang apa pun.
 *
 * BACA INI SEBELUM MENGAKTIFKAN.
 *
 * Endpoint ini memakai sesi Instagram yang tersimpan di variabel lingkungan.
 * Semua permintaan yang lewat sini — termasuk permintaan orang lain kalau
 * endpoint dibuka untuk umum — terlihat oleh Instagram sebagai perbuatan akun
 * tersebut, dari IP pusat data. Pola itu memang rutin dibatasi Instagram.
 *
 *   Pakai akun Instagram KHUSUS, bukan akun yang kamu pakai ikut lelang.
 *   Kalau akun itu dibatasi, tidak ada yang hilang. Kalau yang dibatasi akun
 *   lelangmu, kamu kehilangan akses ke lelang yang sedang kamu selidiki.
 *
 * Variabel lingkungan:
 *   IG_SESSIONID    WAJIB. Nilai cookie `sessionid` dari akun khusus tadi.
 *   KETOK_KEY       OPSIONAL. Kalau diisi, endpoint terkunci dan hanya bisa
 *                   dipakai yang tahu kuncinya. Kalau dikosongkan, endpoint
 *                   terbuka untuk umum.
 *   IG_DS_USER_ID   Opsional, cookie `ds_user_id`.
 *   IG_CSRFTOKEN    Opsional, cookie `csrftoken`.
 */
import { extract } from '../shared/ig-core.js';

const IG_BASE = 'https://www.instagram.com';

// Batas kasar untuk penggunaan terbuka. Satu postingan lelang yang wajar jauh
// di bawah ini; angkanya ada supaya satu orang tidak bisa menguras akunnya.
const MAX_PAGES = 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;

/**
 * Pembatas laju sederhana. Ingatannya per instance lambda, jadi ia tidak
 * ketat — Vercel bisa menjalankan beberapa instance sekaligus. Cukup untuk
 * menahan penyalahgunaan santai, bukan penyerang yang niat.
 */
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);

  if (hits.size > 5000) hits.clear();          // jaga-jaga agar memori tidak membengkak
  return list.length > RATE_MAX;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '')).split(',')[0].trim() || 'tanpa-ip';
}

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
    return res.status(405).json({ error: 'metode', message: 'Hanya menerima GET.' });
  }

  // Gembok opsional. Kosongkan KETOK_KEY di Vercel untuk membuka untuk umum.
  const key = process.env.KETOK_KEY;
  if (key && !safeEqual(req.headers['x-ketok-key'], key)) {
    return res.status(401).json({
      error: 'kunci_salah',
      message: 'Kunci mode server salah atau belum diisi.'
    });
  }

  const cookie = cookieHeader();
  if (!cookie.includes('sessionid=')) {
    return res.status(503).json({
      error: 'sesi_kosong',
      message: 'Sesi Instagram belum disetel di server. Setel IG_SESSIONID di ' +
        'Environment Variables pada project Vercel, lalu deploy ulang.'
    });
  }

  const url = String(req.query.url || '');
  if (!url) {
    return res.status(400).json({ error: 'url_kosong', message: 'Parameter url wajib diisi.' });
  }

  if (rateLimited(clientIp(req))) {
    return res.status(429).json({
      error: 'terlalu_sering',
      message: `Terlalu banyak permintaan. Batasnya ${RATE_MAX} penarikan per 10 menit. ` +
        'Pasang extension kalau butuh lebih — extension menarik dari browser kamu sendiri, tanpa batas ini.'
    });
  }

  try {
    const dump = await extract({
      base: IG_BASE,
      url,
      version: 'server-1.0.0',
      via: 'server',
      includeRaw: req.query.raw !== '0',
      maxPages: MAX_PAGES,
      headers: { cookie }
    });
    return res.status(200).json(dump);
  } catch (e) {
    const status = e.status || 500;
    const message =
      status === 401 || status === 403
        ? 'Sesi Instagram di server sudah kedaluwarsa. Pemilik situs perlu memperbaruinya. ' +
          'Sementara ini, pasang extension supaya penarikan memakai sesi kamu sendiri.'
        : status === 429
          ? 'Instagram sedang membatasi permintaan dari server ini. Coba beberapa menit lagi, ' +
            'atau pasang extension yang menarik dari browser kamu sendiri.'
          : status === 404
            ? 'Postingan tidak ditemukan, sudah dihapus, atau akunnya privat.'
            : e.message;
    // 4xx dari Instagram bukan kesalahan pemanggil, jadi dipetakan ke 502.
    return res.status(status >= 400 && status < 500 ? 502 : 500).json({
      error: 'gagal_menarik', status, message
    });
  }
}
