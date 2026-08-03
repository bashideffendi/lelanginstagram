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
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extract } from '../shared/ig-core.js';

// ---------------------------------------------------------------- akun

/**
 * Satu pemilik, satu kata sandi.
 *
 * Bukan sistem pengguna banyak — ini kotak pribadi. Kata sandinya disimpan
 * sebagai sidik scrypt bergaram, jadi isi berkasnya tidak bisa dipakai masuk
 * walau terbaca orang. Kata sandi aslinya tidak pernah ditulis ke mana pun.
 */
const DATA_DIR = process.env.DATA_DIR || '/home/ubuntu/lelanginstagram/data';
const F_AKUN = path.join(DATA_DIR, 'akun.json');
const F_PANTAU = path.join(DATA_DIR, 'pantau.json');

function pastikanDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}

function bacaJson(f, bawaan) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return bawaan; }
}

function tulisJson(f, data) {
  pastikanDir();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, f);          // tulis atomik: berkas tidak pernah separuh
  // Ditegaskan setelah rename: pilihan mode saat menulis tunduk pada umask,
  // dan hasilnya bisa 644 — cukup untuk pengguna lain membaca sidik sandinya.
  try { fs.chmodSync(f, 0o600); } catch { /* diabaikan */ }
}

function sidikSandi(sandi, garam) {
  return crypto.scryptSync(String(sandi), garam, 32).toString('hex');
}

function sandiTerpasang() {
  return !!bacaJson(F_AKUN, null)?.sidik;
}

function pasangSandi(sandi) {
  const garam = crypto.randomBytes(16).toString('hex');
  tulisJson(F_AKUN, { garam, sidik: sidikSandi(sandi, garam), dibuat: Date.now() });
}

function sandiCocok(sandi) {
  const a = bacaJson(F_AKUN, null);
  if (!a?.sidik) return false;
  const uji = Buffer.from(sidikSandi(sandi, a.garam), 'hex');
  const asli = Buffer.from(a.sidik, 'hex');
  return uji.length === asli.length && crypto.timingSafeEqual(uji, asli);
}

// Token hanya di memori: restart layanan = semua sesi berakhir. Untuk kotak
// pribadi satu orang itu pertukaran yang wajar, dan menghindari satu berkas
// rahasia lagi di disk.
const sesi = new Map();
const SESI_MS = 30 * 24 * 3600 * 1000;

function buatSesi() {
  const t = crypto.randomBytes(24).toString('hex');
  sesi.set(t, Date.now() + SESI_MS);
  return t;
}

function sesiSah(t) {
  const exp = sesi.get(t);
  if (!exp) return false;
  if (Date.now() > exp) { sesi.delete(t); return false; }
  return true;
}

function tokenDari(req) {
  return String(req.headers['x-lelang-token'] || '');
}

const PORT = Number(process.env.PORT || 8791);
const HOST = process.env.HOST || '127.0.0.1';
const IG_BASE = 'https://www.instagram.com';

const ASAL = (process.env.ASAL_DIIZINKAN ||
  'https://lelanginsta.tempuscollective.com,https://lelanginstagram.vercel.app,http://localhost:8777')
  .split(',').map((s) => s.trim()).filter(Boolean);

const MAX_PAGES = Number(process.env.MAX_PAGES || 60);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_MAX || 20);

/**
 * Instagram mengikat sesi pada identitas peramban yang membuatnya, dan
 * menolak yang lain dengan "useragent mismatch" — bukan dengan pengalihan
 * ke login. Diuji langsung: semua identitas peramban ditolak, identitas
 * aplikasi Instagram diterima. Karena itu ini bawaannya.
 *
 * Kalau sesimu dibuat dari peramban, isi IG_USER_AGENT dengan identitas
 * peramban itu persis (Console: navigator.userAgent).
 */
const IG_UA = process.env.IG_USER_AGENT ||
  'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; ' +
  'SM-G991B; o1s; exynos2100; en_US; 458229237)';

const PERAMBAN = /Mozilla/.test(IG_UA);

const HEADER_IG = {
  'user-agent': IG_UA,
  accept: '*/*',
  'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  // Referer tetap dikirim walau identitasnya aplikasi. Diuji: tanpa ini
  // Instagram menjawab "SecFetch Policy violation"; dengan ini diterima.
  referer: 'https://www.instagram.com/',
  'x-asbd-id': '129477',
  'x-ig-www-claim': '0',
  // Hanya trio sec-fetch yang khas peramban; mengirimnya bersama identitas
  // aplikasi justru yang memicu penolakan kebijakan itu.
  ...(PERAMBAN ? {
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
  } : {})
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

const HEADER_DIIZINKAN = 'x-ketok-key, x-lelang-token, content-type';

function kirim(res, kode, data, asal) {
  const body = JSON.stringify(data);
  res.writeHead(kode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': asal || 'null',
    'access-control-allow-headers': HEADER_DIIZINKAN,
    'access-control-max-age': '86400',
    vary: 'Origin',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function bacaBadan(req, batas = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const bagian = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > batas) { reject(new Error('Isinya terlalu besar.')); req.destroy(); return; }
      bagian.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(bagian).toString('utf8') || '{}')); }
      catch { reject(new Error('Isinya bukan JSON yang sah.')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const asal = ASAL.includes(req.headers.origin) ? req.headers.origin : null;

  if (req.method === 'OPTIONS') {
    // Halaman mengirim header sendiri, jadi peramban selalu bertanya dulu.
    res.writeHead(204, {
      'access-control-allow-origin': asal || 'null',
      'access-control-allow-headers': HEADER_DIIZINKAN,
      'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
      'access-control-max-age': '86400',
      vary: 'Origin'
    });
    return res.end();
  }

  if (url.pathname === '/sehat') {
    return kirim(res, 200, { sehat: true, cookie: cookieTerkirim() }, asal);
  }

  // ------------------------------------------------------------ akun

  if (url.pathname === '/akun/keadaan') {
    return kirim(res, 200, { terpasang: sandiTerpasang() }, asal);
  }

  if (url.pathname === '/akun/pasang' && req.method === 'POST') {
    // Hanya boleh sekali. Kalau sudah ada, ganti sandi menuntut sandi lama.
    if (sandiTerpasang()) {
      return kirim(res, 409, { error: 'sudah_ada', message: 'Kata sandi sudah pernah dibuat.' }, asal);
    }
    try {
      const b = await bacaBadan(req);
      if (!b.sandi || String(b.sandi).length < 8) {
        return kirim(res, 400, { error: 'terlalu_pendek', message: 'Kata sandi minimal 8 huruf.' }, asal);
      }
      pasangSandi(b.sandi);
      return kirim(res, 200, { token: buatSesi() }, asal);
    } catch (e) {
      return kirim(res, 400, { error: 'isi_salah', message: e.message }, asal);
    }
  }

  if (url.pathname === '/akun/masuk' && req.method === 'POST') {
    try {
      const b = await bacaBadan(req);
      // Pembatas laju yang sama dipakai supaya sandi tidak bisa ditebak beruntun.
      if (terbatas('masuk:' + ipKlien(req))) {
        return kirim(res, 429, { error: 'terlalu_sering', message: 'Terlalu banyak percobaan. Tunggu beberapa menit.' }, asal);
      }
      if (!sandiCocok(b.sandi)) {
        return kirim(res, 401, { error: 'sandi_salah', message: 'Kata sandi salah.' }, asal);
      }
      return kirim(res, 200, { token: buatSesi() }, asal);
    } catch (e) {
      return kirim(res, 400, { error: 'isi_salah', message: e.message }, asal);
    }
  }

  // ------------------------------------------------------------ pantauan

  if (url.pathname === '/pantau') {
    if (!sesiSah(tokenDari(req))) {
      return kirim(res, 401, { error: 'belum_masuk', message: 'Perlu masuk dulu.' }, asal);
    }

    if (req.method === 'GET') {
      return kirim(res, 200, bacaJson(F_PANTAU, { items: [], updatedAt: 0 }), asal);
    }

    if (req.method === 'PUT') {
      try {
        const b = await bacaBadan(req);
        if (!Array.isArray(b.items)) {
          return kirim(res, 400, { error: 'isi_salah', message: 'items harus berupa daftar.' }, asal);
        }
        const isi = {
          items: b.items,
          akun: b.akun || null,
          updatedAt: Date.now()
        };
        tulisJson(F_PANTAU, isi);
        return kirim(res, 200, { updatedAt: isi.updatedAt, jumlah: isi.items.length }, asal);
      } catch (e) {
        return kirim(res, 400, { error: 'isi_salah', message: e.message }, asal);
      }
    }

    return kirim(res, 405, { error: 'metode', message: 'Hanya GET dan PUT.' }, asal);
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
      headers: { ...HEADER_IG, cookie }
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
  console.log(`[lelanginsta] identitas: ${PERAMBAN ? 'peramban' : 'aplikasi Instagram'}`);
  console.log(`[lelanginsta] gembok: ${process.env.KETOK_KEY ? 'aktif' : 'terbuka untuk umum'}`);
});
