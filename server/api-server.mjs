/**
 * Lelang Insta — server penarik komentar, berdiri sendiri.
 *
 * Sama isinya dengan fungsi Vercel di api/comments.js, tapi berjalan sebagai
 * proses Node biasa di VPS. Alasannya satu: Instagram menolak sesi yang
 * dipakai dari IP pusat data Vercel, sementara IP VPS biasanya diterima.
 *
 * Tanpa dependensi. Memakai shared/ig-core.js, jadi kalau Instagram mengubah
 * endpoint-nya, perbaikannya tetap di satu tempat untuk semua jalur.
 *
 * Jalankan:
 *   IG_SESSIONID=... IG_DS_USER_ID=... IG_CSRFTOKEN=... node server/api-server.mjs
 *
 * Variabel lingkungan:
 *   PORT           default 8791, hanya mendengar di 127.0.0.1
 *   ASAL_DIIZINKAN daftar origin dipisah koma yang boleh memanggil
 *   KETOK_KEY      opsional; diisi = terkunci, dikosongkan = terbuka umum
 *   IG_SESSIONID   wajib, beserta IG_DS_USER_ID dan IG_CSRFTOKEN
 */
import http from 'node:http';
import { extract } from '../shared/ig-core.js';

const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || '127.0.0.1';
const IG_BASE = 'https://www.instagram.com';

const ASAL = (process.env.ASAL_DIIZINKAN ||
  'https://lelanginsta.tempuscollective.com,https://lelanginstagram.vercel.app,http://localhost:8777')
  .split(',').map((s) => s.trim()).filter(Boolean);

const MAX_PAGES = Number(process.env.MAX_PAGES || 60);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_MAX || 20);

const HEADER_PERAMBAN = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: '*/*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  referer: 'https://www.instagram.com/',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  'x-asbd-id': '129477',
  'x-ig-www-claim': '0'
};

// ---------------------------------------------------------------- bantu

const hits = new Map();

function terbatas(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_MAX;
}

function ipKlien(req) {
  const fwd = req.headers['x-forwarded-for'];
  return String(fwd || '').split(',')[0].trim() || req.socket.remoteAddress || 'tanpa-ip';
}

function cookieHeader() {
  const p = [];
  if (process.env.IG_SESSIONID) p.push('sessionid=' + process.env.IG_SESSIONID);
  if (process.env.IG_DS_USER_ID) p.push('ds_user_id=' + process.env.IG_DS_USER_ID);
  if (process.env.IG_CSRFTOKEN) p.push('csrftoken=' + process.env.IG_CSRFTOKEN);
  return p.join('; ');
}

/** Nama cookie saja, tidak pernah nilainya. */
function cookieTerkirim() {
  return [
    process.env.IG_SESSIONID ? 'sessionid' : null,
    process.env.IG_DS_USER_ID ? 'ds_user_id' : null,
    process.env.IG_CSRFTOKEN ? 'csrftoken' : null
  ].filter(Boolean);
}

function samaPanjang(a, b) {
  const x = String(a ?? ''), y = String(b ?? '');
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

function kirim(res, kode, data, asal) {
  const body = JSON.stringify(data);
  res.writeHead(kode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': asal || 'null',
    'access-control-allow-headers': 'x-ketok-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const asal = ASAL.includes(req.headers.origin) ? req.headers.origin : null;

  if (req.method === 'OPTIONS') {
    // Halaman mengirim x-ketok-key, jadi peramban selalu bertanya lebih dulu.
    res.writeHead(204, {
      'access-control-allow-origin': asal || 'null',
      'access-control-allow-headers': 'x-ketok-key',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '86400',
      vary: 'Origin'
    });
    return res.end();
  }

  if (url.pathname === '/sehat') {
    return kirim(res, 200, { sehat: true, cookie: cookieTerkirim() }, asal);
  }

  if (url.pathname !== '/api/comments') {
    return kirim(res, 404, { error: 'tidak_ada', message: 'Alamat tidak dikenal.' }, asal);
  }
  if (req.method !== 'GET') {
    return kirim(res, 405, { error: 'metode', message: 'Hanya menerima GET.' }, asal);
  }

  const kunci = process.env.KETOK_KEY;
  if (kunci && !samaPanjang(req.headers['x-ketok-key'], kunci)) {
    return kirim(res, 401, { error: 'kunci_salah', message: 'Kunci mode server salah atau belum diisi.' }, asal);
  }

  const cookie = cookieHeader();
  if (!cookie.includes('sessionid=')) {
    return kirim(res, 503, {
      error: 'sesi_kosong',
      message: 'Sesi Instagram belum disetel di server. Isi IG_SESSIONID lalu jalankan ulang layanannya.'
    }, asal);
  }

  const target = url.searchParams.get('url') || '';
  if (!target) {
    return kirim(res, 400, { error: 'url_kosong', message: 'Parameter url wajib diisi.' }, asal);
  }

  if (terbatas(ipKlien(req))) {
    return kirim(res, 429, {
      error: 'terlalu_sering',
      message: `Terlalu banyak permintaan. Batasnya ${RATE_MAX} penarikan per 10 menit.`
    }, asal);
  }

  try {
    const dump = await extract({
      base: IG_BASE,
      url: target,
      version: 'vps-1.0.0',
      via: 'server',
      includeRaw: url.searchParams.get('raw') !== '0',
      maxPages: MAX_PAGES,
      manualRedirect: true,
      headers: { ...HEADER_PERAMBAN, cookie }
    });
    return kirim(res, 200, dump, asal);
  } catch (e) {
    const sebab = e.cause ? (e.cause.code || e.cause.message || String(e.cause)) : null;
    console.error('[lelanginsta] gagal:', e.message,
      sebab ? '| sebab: ' + sebab : '',
      e.tujuan ? '| dialihkan ke: ' + e.tujuan : '',
      '| cookie: ' + (cookieTerkirim().join(',') || 'tidak ada'));

    if (!e.status) {
      return kirim(res, 502, {
        error: 'tak_tersambung', sebab,
        message: 'Server tidak berhasil menghubungi Instagram' + (sebab ? ` (${sebab})` : '') + '.'
      }, asal);
    }

    const lengkap = cookieTerkirim().length === 3;
    const tantangan = /challenge|checkpoint/i.test(e.tujuan || '');
    const pesan =
      e.status === 401 || e.status === 403
        ? 'Instagram menolak sesi server. ' +
          `Cookie yang terkirim: ${cookieTerkirim().join(', ') || 'tidak ada'}. ` +
          (tantangan
            ? 'Instagram meminta verifikasi pada akun itu. Selesaikan dulu, lalu ambil ulang cookie-nya.'
            : !lengkap
              ? 'Belum lengkap: sessionid, ds_user_id, dan csrftoken harus dikirim bersama.'
              : 'Ketiganya lengkap, jadi sesinya sudah kedaluwarsa. Ambil ulang cookie-nya.')
        : e.status === 429
          ? 'Instagram sedang membatasi permintaan dari server ini. Coba beberapa menit lagi.'
          : e.status === 404
            ? 'Postingan tidak ditemukan, sudah dihapus, atau akunnya privat.'
            : e.message;

    return kirim(res, e.status >= 400 && e.status < 500 ? 502 : 500,
      { error: 'gagal_menarik', status: e.status, message: pesan }, asal);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[lelanginsta] mendengar di http://${HOST}:${PORT}`);
  console.log(`[lelanginsta] asal diizinkan: ${ASAL.join(', ')}`);
  console.log(`[lelanginsta] cookie tersedia: ${cookieTerkirim().join(', ') || 'BELUM ADA'}`);
  console.log(`[lelanginsta] gembok: ${process.env.KETOK_KEY ? 'aktif' : 'terbuka untuk umum'}`);
});
