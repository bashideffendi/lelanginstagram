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
import { extract, APP_ID } from '../shared/ig-core.js';

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

/**
 * Simpan cookie Instagram yang baru ke berkas env, lalu pakai saat itu juga.
 *
 * Ditulis ke berkas supaya bertahan melewati restart, DAN dipasang ke
 * process.env supaya berlaku tanpa restart — menyalakan ulang layanan hanya
 * untuk ini akan memutus penarikan yang sedang berjalan.
 *
 * Baris lain di berkas dipertahankan apa adanya. Menulis ulang seluruh berkas
 * dari daftar yang dihafal di sini berarti setelan yang ditambahkan nanti
 * akan lenyap diam-diam pada penyegaran cookie berikutnya.
 */
const F_ENV = process.env.BERKAS_ENV || '/home/ubuntu/lelanginstagram/server/lelanginsta.env';

function simpanCookieIg({ sessionid, ds_user_id, csrftoken }) {
  const baru = { IG_SESSIONID: sessionid, IG_DS_USER_ID: ds_user_id, IG_CSRFTOKEN: csrftoken };

  let baris = [];
  try {
    baris = fs.readFileSync(F_ENV, 'utf8').split(/\r?\n/);
  } catch { /* berkas belum ada; disusun dari nol */ }

  const sudah = new Set();
  baris = baris.map((b) => {
    const m = b.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!m || !(m[1] in baru)) return b;
    sudah.add(m[1]);
    return `${m[1]}=${baru[m[1]]}`;
  });
  for (const k of Object.keys(baru)) if (!sudah.has(k)) baris.push(`${k}=${baru[k]}`);

  const tmp = F_ENV + '.tmp';
  fs.writeFileSync(tmp, baris.join('\n').replace(/\n+$/, '') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, F_ENV);
  try { fs.chmodSync(F_ENV, 0o600); } catch { /* diabaikan */ }

  for (const [k, v] of Object.entries(baru)) process.env[k] = v;
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

/**
 * Sesi disimpan ke disk supaya tetap berlaku setelah layanan dimulai ulang —
 * pembaruan server tidak boleh memaksa masuk ulang di semua perangkat.
 *
 * Sempat kubuat hanya di memori dengan alasan menghindari berkas rahasia
 * tambahan, tapi itu alasan yang lemah: berkas ini tidak lebih rahasia
 * daripada sidik kata sandi yang memang sudah tersimpan di sebelahnya.
 */
const F_SESI = path.join(DATA_DIR, 'sesi.json');
const SESI_MS = 365 * 24 * 3600 * 1000;

const sesi = new Map(Object.entries(bacaJson(F_SESI, {})));

function simpanSesi() {
  // Yang kedaluwarsa dibuang saat menulis, jadi berkasnya tidak menumpuk.
  const now = Date.now();
  for (const [t, exp] of sesi) if (now > exp) sesi.delete(t);
  tulisJson(F_SESI, Object.fromEntries(sesi));
}

function buatSesi() {
  const t = crypto.randomBytes(24).toString('hex');
  sesi.set(t, Date.now() + SESI_MS);
  simpanSesi();
  return t;
}

function sesiSah(t) {
  const exp = sesi.get(t);
  if (!exp) return false;
  if (Date.now() > exp) { sesi.delete(t); simpanSesi(); return false; }
  return true;
}

function hapusSesi(t) {
  if (sesi.delete(t)) simpanSesi();
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

/**
 * Siapa yang boleh masuk dengan akun Google.
 *
 * Daftar, bukan satu nilai: mengganti alamat kelak tidak boleh menuntut
 * mengubah kode. Kosong berarti masuk lewat Google dimatikan sama sekali —
 * lebih aman daripada bawaan yang menerima siapa saja.
 */
const EMAIL_DIIZINKAN = (process.env.EMAIL_DIIZINKAN || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const CLIENT_ID_GOOGLE = (process.env.GOOGLE_CLIENT_ID || '').trim();

const MAX_PAGES = Number(process.env.MAX_PAGES || 60);
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = Number(process.env.RATE_MAX || 20);

/**
 * Jatah untuk yang sudah masuk. Cukup untuk enam lelang berbarengan di menit
 * paling genting, dan tetap jauh di bawah kecepatan yang membuat Instagram
 * mulai membatasi akun servernya.
 */
const RATE_MAX_MASUK = Number(process.env.RATE_MAX_MASUK || 90);

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

/**
 * @param ember pemisah hitungan. Penarikan dan percobaan masuk punya jatah
 *              sendiri-sendiri; menyatukannya berarti penarikan yang wajar
 *              bisa menghabiskan jatah yang seharusnya menjaga kata sandi.
 */
function terbatas(ip, ember = 'tarik', batas = RATE_MAX) {
  const now = Date.now();
  const kunci = ember + '|' + ip;
  const list = (hits.get(kunci) || []).filter((t) => now - t < RATE_WINDOW_MS);
  list.push(now);
  hits.set(kunci, list);

  // Dulu seluruh peta dikosongkan saat penuh, dan itu justru menghapus
  // hitungan semua orang sekaligus — cukup membanjiri dari banyak alamat
  // untuk menyetel ulang batas siapa pun. Sekarang yang dibuang hanya yang
  // sudah kedaluwarsa.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] >= RATE_WINDOW_MS) hits.delete(k);
    }
  }
  return list.length > batas;
}

/**
 * Alamat pemanggil, diambil dari ujung KANAN X-Forwarded-For.
 *
 * Apache menambahkan alamat asli di belakang isi yang sudah ada, jadi nilai
 * paling kiri justru yang dikirim pemanggil sendiri — bisa dikarang. Memakai
 * yang paling kiri berarti pembatas lajunya bisa dilewati cukup dengan
 * mengirim header palsu, dan itu membuatnya tidak membatasi apa pun.
 *
 * Di belakang tepat satu proxy, yang paling kanan selalu yang ditambahkan
 * proxy itu sendiri, dan itulah satu-satunya yang tidak bisa dikarang.
 */
function ipKlien(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',');
  return fwd[fwd.length - 1].trim() || req.socket.remoteAddress || 'tanpa-ip';
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

/*
 * Denyut sesi Instagram.
 *
 * Sesi Instagram tidak bisa dibuat abadi — tidak ada cara memperpanjangnya
 * selain masuk lagi. Tapi dua hal yang membuat matinya terasa menyakitkan bisa
 * dihilangkan.
 *
 * Pertama, sesi yang menganggur mati lebih cepat daripada sesi yang dipakai.
 * Satu permintaan ringan tiap empat jam membuatnya terhitung aktif, dan itu
 * memperpanjang umurnya secara nyata tanpa membebani apa pun.
 *
 * Kedua — dan ini yang lebih penting — matinya selalu ketahuan pada saat
 * terburuk: waktu kamu menarik lelang yang sedang panas. Denyut ini membuatnya
 * ketahuan berjam-jam lebih awal, saat kamu masih sempat mengambil cookie baru
 * dengan tenang.
 */
const DENYUT_MS = 4 * 3600 * 1000;

const F_TANDA = path.join(DATA_DIR, 'sesi-ig.json');

let sesiIg = {
  keadaan: 'belum', dicek: null, hidupTerakhir: null, akun: null, pesan: '',
  // Bertahan melewati restart: fakta bahwa ada browser yang sanggup
  // menyegarkan sendiri tidak berubah karena layanan dinyalakan ulang.
  lewatExtension: !!bacaJson(F_TANDA, {}).lewatExtension
};

function simpanTanda() {
  tulisJson(F_TANDA, { lewatExtension: !!sesiIg.lewatExtension });
}

async function periksaSesiIg() {
  const cookie = cookieHeader();
  if (!cookie.includes('sessionid=')) {
    sesiIg = { ...sesiIg, keadaan: 'kosong', dicek: Date.now(),
      pesan: 'Cookie Instagram belum diisi di server.' };
    return sesiIg;
  }

  try {
    const r = await fetch('https://www.instagram.com/api/v1/accounts/current_user/', {
      headers: { ...HEADER_IG, cookie, 'x-ig-app-id': APP_ID },
      redirect: 'manual'                    // pengalihan = sesi ditolak, bukan 200
    });
    const hidup = r.status === 200;

    // Nama akunnya ikut dicatat. Server ini bekerja atas nama satu akun
    // Instagram, dan salah akun bukan gangguan kecil: penarikan dari IP pusat
    // data adalah pola yang rutin dibatasi, jadi kalau yang tertanam ternyata
    // akun yang dipakai ikut lelang, yang dipertaruhkan adalah akun itu.
    // Menyebutnya terang-terangan jauh lebih murah daripada menyadarinya
    // sesudah akunnya kena.
    let akun = sesiIg.akun || null;
    if (hidup) {
      try { akun = (await r.clone().json())?.user?.username || null; } catch { /* diabaikan */ }
    }

    sesiIg = {
      keadaan: hidup ? 'hidup' : 'ditolak',
      dicek: Date.now(),
      hidupTerakhir: hidup ? Date.now() : sesiIg.hidupTerakhir,
      akun,
      pesan: hidup ? '' : `Instagram menolak sesi (HTTP ${r.status}).`
    };
  } catch (e) {
    // Jaringan bermasalah bukan berarti sesinya mati; jangan menakut-nakuti.
    sesiIg = { ...sesiIg, keadaan: 'tak_tentu', dicek: Date.now(),
      pesan: 'Tidak bisa menghubungi Instagram: ' + (e.cause?.code || e.message) };
  }
  return sesiIg;
}

/** Dilaporkan ke halaman supaya peringatannya muncul sebelum dibutuhkan. */
function keadaanSesi() {
  return {
    keadaan: sesiIg.keadaan,
    pesan: sesiIg.pesan,
    dicek: sesiIg.dicek,
    hidupTerakhir: sesiIg.hidupTerakhir,
    akun: sesiIg.akun || null,
    lewatExtension: !!sesiIg.lewatExtension,
    cookie: cookieTerkirim()
  };
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
    return kirim(res, 200, { sehat: true, cookie: cookieTerkirim(), sesiIg: keadaanSesi() }, asal);
  }

  // ------------------------------------------------------------ akun

  /*
   * Jam server, untuk mengoreksi jam perangkat.
   *
   * Sengaja tanpa pembatas laju dan tanpa login: jawabannya satu bilangan yang
   * juga tertera di header Date setiap jawaban lain, jadi tidak ada yang bisa
   * dibocorkan, dan biayanya lebih murah daripada memeriksa batasnya.
   *
   * Jam mesin ini diselaraskan ntpd — diperiksa langsung terhadap acuan luar
   * dan sama persis. Kalau ntpd mati, koreksinya ikut salah dan salahnya diam,
   * jadi itu bagian yang perlu diperiksa lebih dulu kalau hitung mundurnya
   * terasa meleset.
   */
  if (url.pathname === '/waktu') {
    res.setHeader('cache-control', 'no-store');
    return kirim(res, 200, { t: Date.now() }, asal);
  }

  if (url.pathname === '/akun/keadaan') {
    return kirim(res, 200, {
      terpasang: sandiTerpasang(),
      google: !!(CLIENT_ID_GOOGLE && EMAIL_DIIZINKAN.length),
      clientId: CLIENT_ID_GOOGLE || null      // publik; halaman butuh untuk memanggil Google
    }, asal);
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
      // Jatah tersendiri dan jauh lebih sempit daripada penarikan: menebak
      // sandi butuh ribuan percobaan, jadi sepuluh per sepuluh menit sudah
      // menutup jalan itu tanpa pernah mengganggu pemakaian yang wajar.
      if (terbatas(ipKlien(req), 'masuk', 10)) {
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

  /*
   * Masuk dengan akun Google.
   *
   * Halaman mengirim ID token dari Google Identity Services; kesahihannya
   * diperiksa ke Google sendiri, bukan dibaca begitu saja. Isi JWT bisa
   * dikarang siapa pun — yang tidak bisa dikarang adalah tanda tangannya, dan
   * memverifikasi tanda tangan RS256 beserta perputaran kuncinya jauh lebih
   * banyak kode daripada satu permintaan ke titik akhir resmi Google. Untuk
   * alat berpengguna satu orang, yang lebih sedikit kodenya lebih sedikit pula
   * salahnya.
   *
   * Tiga hal diperiksa, dan ketiganya wajib:
   *   aud            token itu memang untuk aplikasi ini, bukan aplikasi lain
   *   email_verified Google sudah membuktikan alamat itu milik pemegangnya
   *   email          ada di daftar yang diizinkan
   *
   * Tanpa pemeriksaan aud, siapa pun bisa memakai token yang diterbitkan untuk
   * aplikasi lain miliknya sendiri untuk masuk ke sini.
   */
  if (url.pathname === '/akun/google' && req.method === 'POST') {
    if (terbatas(ipKlien(req), 'masuk', 10)) {
      return kirim(res, 429, { error: 'terlalu_sering', message: 'Terlalu banyak percobaan. Tunggu beberapa menit.' }, asal);
    }
    if (!EMAIL_DIIZINKAN.length || !CLIENT_ID_GOOGLE) {
      return kirim(res, 503, { error: 'belum_disiapkan',
        message: 'Masuk dengan Google belum disiapkan di server ini.' }, asal);
    }

    try {
      const b = await bacaBadan(req);
      if (!b.credential) {
        return kirim(res, 400, { error: 'isi_salah', message: 'Token Google tidak ada.' }, asal);
      }

      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' +
        encodeURIComponent(b.credential));
      const t = await r.json().catch(() => null);

      if (!r.ok || !t || t.error) {
        return kirim(res, 401, { error: 'token_tolak', message: 'Google menolak token itu.' }, asal);
      }
      if (t.aud !== CLIENT_ID_GOOGLE) {
        return kirim(res, 401, { error: 'aud_salah', message: 'Token itu bukan untuk aplikasi ini.' }, asal);
      }
      if (String(t.email_verified) !== 'true') {
        return kirim(res, 401, { error: 'email_belum', message: 'Alamat email itu belum diverifikasi Google.' }, asal);
      }

      const email = String(t.email || '').toLowerCase();
      if (!EMAIL_DIIZINKAN.includes(email)) {
        // Alamatnya tidak disebut kembali: alat ini punya satu pemilik, dan
        // memberi tahu penebak "bukan alamat ini" adalah keterangan gratis.
        console.log('[lelanginsta] masuk Google ditolak — alamat tidak diizinkan');
        return kirim(res, 403, { error: 'tidak_diizinkan',
          message: 'Akun Google itu tidak diizinkan masuk ke sini.' }, asal);
      }

      console.log(`[lelanginsta] masuk lewat Google: ${email}`);
      return kirim(res, 200, { token: buatSesi(), email }, asal);
    } catch (e) {
      return kirim(res, 400, { error: 'isi_salah', message: e.message }, asal);
    }
  }

  /*
   * Cabut semua sesi, dari mana pun mereka dibuat.
   *
   * Sesi berlaku setahun dan disimpan di server, jadi ponsel yang hilang tetap
   * bisa membuka pantauanmu sampai setahun ke depan. Sebelumnya satu-satunya
   * cara mencabutnya adalah menghapus berkas sesi lewat SSH — cara yang tidak
   * ada gunanya bagi orang yang sedang panik kehilangan ponsel.
   *
   * Yang memanggil ikut dicabut lalu diberi sesi baru, bukan dikecualikan:
   * mengecualikan berarti perangkat ini harus dipercaya sudah benar, padahal
   * justru dari perangkat inilah keputusan "ada yang tidak beres" diambil.
   */
  if (url.pathname === '/akun/cabut-semua' && req.method === 'POST') {
    if (!sesiSah(tokenDari(req))) {
      return kirim(res, 401, { error: 'belum_masuk', message: 'Perlu masuk dulu.' }, asal);
    }
    const jumlah = sesi.size;
    sesi.clear();
    const baru = buatSesi();
    console.log(`[lelanginsta] semua sesi dicabut (${jumlah}), satu sesi baru dibuat`);
    return kirim(res, 200, {
      dicabut: jumlah,
      token: baru,
      message: `${jumlah} sesi dicabut. Perangkat lain harus masuk lagi.`
    }, asal);
  }

  if (url.pathname === '/akun/keluar' && req.method === 'POST') {
    // Keluar harus benar-benar mencabut tandanya di server, bukan sekadar
    // melupakannya di browser — kalau tidak, token yang tercecer tetap sah.
    hapusSesi(tokenDari(req));
    return kirim(res, 200, { keluar: true }, asal);
  }

  // ------------------------------------------------------------ sesi Instagram

  /*
   * Terima sesi Instagram baru dari extension di browser pemilik.
   *
   * Terkunci di balik login Lelang Insta yang sama dengan pantauan: tanpa itu,
   * siapa pun yang tahu alamat server ini bisa menanamkan sesi Instagram milik
   * siapa pun ke dalamnya.
   *
   * Nilainya tidak pernah dicatat ke log, dan tidak pernah dikembalikan lewat
   * jawaban apa pun — yang dilaporkan cuma diterima atau tidak oleh Instagram.
   */
  if (url.pathname === '/sesi-ig' && req.method === 'POST') {
    if (!sesiSah(tokenDari(req))) {
      return kirim(res, 401, { error: 'belum_masuk', message: 'Perlu masuk dulu di Lelang Insta.' }, asal);
    }
    try {
      const b = await bacaBadan(req);
      const kurang = ['sessionid', 'ds_user_id', 'csrftoken'].filter((k) => !b[k]);
      if (kurang.length) {
        return kirim(res, 400, { error: 'tidak_lengkap',
          message: 'Belum lengkap: ' + kurang.join(', ') + '.' }, asal);
      }

      simpanCookieIg(b);
      const s = await periksaSesiIg();
      // Dicatat supaya perangkat lain tahu ada browser yang bisa menyegarkan
      // sendiri, dan peringatannya bisa menyuruh membuka browser itu alih-alih
      // menyuruh memasang extension di HP — tempat extension tidak bisa dipasang.
      if (s.keadaan === 'hidup') { sesiIg.lewatExtension = true; simpanTanda(); }
      console.log(`[lelanginsta] sesi IG disegarkan dari extension → ${s.keadaan}`);

      return kirim(res, 200, {
        keadaan: s.keadaan,
        message: s.keadaan === 'hidup'
          ? 'Sesi Instagram disegarkan dan diterima.'
          : (s.pesan || 'Sesi tersimpan, tapi Instagram belum menerimanya.')
      }, asal);
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

  /*
   * Yang sudah masuk dapat jatah jauh lebih longgar.
   *
   * Batas 20 per 10 menit disusun waktu titik akhir ini terbuka untuk umum dan
   * tidak ada cara mengenali siapa pemanggilnya. Sejak pantauan memeriksa
   * sendiri, angka itu justru menghukum pemiliknya: di sepuluh menit terakhir
   * satu lelang diperiksa tiap 45 detik — tiga belas penarikan — jadi dua
   * lelang yang tutup di malam yang sama sudah melewatinya. Dan melewatinya
   * berarti gagal menarik tepat di jendela sniper, satu-satunya menit yang
   * benar-benar menentukan.
   *
   * Sekarang ada login, jadi pemiliknya bisa dikenali. Yang anonim tetap 20.
   */
  const pemilik = sesiSah(tokenDari(req));
  const batas = pemilik ? RATE_MAX_MASUK : RATE_MAX;
  if (terbatas(ipKlien(req), pemilik ? 'tarik-pemilik' : 'tarik', batas)) {
    return kirim(res, 429, {
      error: 'terlalu_sering',
      message: `Terlalu banyak permintaan. Batasnya ${batas} penarikan per 10 menit.`
    }, asal);
  }

  try {
    /*
     * Batas halaman bisa dipersempit lewat ?halaman=N.
     *
     * Membaca seluruh komentar mahal: diukur pada lelang sungguhan, 5 komentar
     * makan 0,9 detik dan 16 komentar 2,0 detik — naik per halaman, jadi lelang
     * seratus komentar bisa sepuluh detik. Untuk menawar di detik terakhir itu
     * mematikan: harga yang dipakai menghitung sudah basi sepuluh detik, dan
     * yang menawar di sela itu tidak terlihat sama sekali.
     *
     * Di lelang yang harganya naik, yang tertinggi hampir selalu ada di
     * komentar terbaru. Riwayat lengkapnya sudah dikumpulkan pemeriksaan
     * berkala, jadi menjelang menembak yang perlu ditarik cuma selisihnya —
     * satu halaman.
     */
    const mintaHalaman = Number(url.searchParams.get('halaman') || 0);
    const batasHalaman = mintaHalaman > 0 ? Math.min(mintaHalaman, MAX_PAGES) : MAX_PAGES;

    const dump = await extract({
      base: IG_BASE,
      url: target,
      version: 'vps-1.0.0',
      via: 'server',
      includeRaw: url.searchParams.get('raw') !== '0',
      maxPages: batasHalaman,
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

  const denyut = () => periksaSesiIg().then((s) =>
    console.log(`[lelanginsta] sesi IG: ${s.keadaan}${s.pesan ? ' — ' + s.pesan : ''}`));
  denyut();
  // unref supaya pemeriksaan berkala tidak menahan proses saat dimatikan.
  setInterval(denyut, DENYUT_MS).unref();
});
