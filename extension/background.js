/**
 * Service worker Ketok.
 *
 * Satu-satunya bagian yang punya izin ke instagram.com. Halaman web Ketok
 * tidak bisa dan tidak pernah menyentuh Instagram langsung — ia hanya
 * menitipkan alamat post lewat bridge.js, lalu menerima hasilnya.
 *
 * Sesi login tetap di browser: fetch penarikan memakai cookie yang sudah ada
 * tanpa pernah membacanya.
 *
 * Satu perkecualian, dan hanya atas permintaan halamanmu sendiri: menyegarkan
 * sesi server (lihat `segarkanSesi` di bawah). Sesi Instagram di server mati
 * sendiri setiap beberapa minggu, dan tanpa ini satu-satunya cara
 * menghidupkannya adalah membuka DevTools, menyalin tiga cookie, lalu
 * menjalankan skrip — pekerjaan yang tidak masuk akal dituntut dari alat yang
 * gunanya justru mengurangi kerepotan. Nilainya berjalan dari browser ini
 * langsung ke server milikmu sendiri, tidak singgah ke mana pun.
 */
import { extract } from './ig-core.js';

const VERSION = chrome.runtime.getManifest().version;

/** Tiga cookie yang dibutuhkan server; tidak ada yang lain yang dibaca. */
const COOKIE_SESI = ['sessionid', 'ds_user_id', 'csrftoken'];

async function bacaCookieIg() {
  const isi = {};
  for (const nama of COOKIE_SESI) {
    const c = await chrome.cookies.get({ url: 'https://www.instagram.com/', name: nama });
    if (!c || !c.value) return { galat: `Cookie "${nama}" tidak ada — browser ini belum login Instagram.` };
    isi[nama] = c.value;
  }
  return { isi };
}

/**
 * Kirim sesi ke server Lelang Insta milik pengguna.
 *
 * Alamat servernya dan tanda masuknya dikirim oleh halaman, bukan disimpan di
 * sini: extension tidak perlu tahu apa-apa tentang akunmu, dan server yang
 * menolak tanda masuk yang salah.
 */
/**
 * Alamat server yang boleh menerima cookie Instagram.
 *
 * Halaman menyebut alamatnya, dan tanpa daftar ini alamat apa pun diterima —
 * satu halaman jahat di localhost:8777 (port yang dipakai bermacam alat
 * pengembangan, bukan cuma proyek ini) cukup mengirim pesan berisi alamatnya
 * sendiri untuk memanen sesi Instagram-mu. Cookie ini bukan sekadar data:
 * pemegangnya bisa berkomentar, mengikuti, dan membaca DM atas namamu.
 */
const API_DIIZINKAN = [
  'https://lelanginsta-api.tempuscollective.com',
  'http://localhost:8791',
  'http://127.0.0.1:8791'
];

function apiSah(alamat) {
  const bersih = String(alamat || '').replace(/\/+$/, '');
  return API_DIIZINKAN.includes(bersih) ? bersih : null;
}

async function segarkanSesi(msg) {
  const api = apiSah(msg.api);
  if (!api) {
    return { kind: 'error', message: 'Alamat server itu tidak ada di daftar yang diizinkan extension ini.' };
  }

  const { isi, galat } = await bacaCookieIg();
  if (galat) return { kind: 'error', message: galat };

  try {
    const r = await fetch(api + '/sesi-ig', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lelang-token': msg.token || '' },
      body: JSON.stringify({
        sessionid: isi.sessionid,
        ds_user_id: isi.ds_user_id,
        csrftoken: isi.csrftoken
      })
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { kind: 'error', message: j?.message || `Server menolak (HTTP ${r.status}).` };
    return { kind: 'done', keadaan: j?.keadaan || null, pesan: j?.message || '' };
  } catch (e) {
    return { kind: 'error', message: 'Server tidak bisa dihubungi: ' + e.message };
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ketok') return;

  port.onMessage.addListener(async (msg) => {
    if (!msg) return;

    const post = (m) => {
      // Port bisa sudah tertutup kalau tab pengguna ditutup di tengah jalan.
      try { port.postMessage(m); } catch { /* diabaikan */ }
    };

    if (msg.action === 'segarkanSesi') {
      post(await segarkanSesi(msg));
      return;
    }

    if (msg.action !== 'extract') return;

    try {
      const dump = await extract({
        base: 'https://www.instagram.com',
        url: msg.url,
        version: VERSION,
        via: 'extension',
        includeRaw: msg.includeRaw !== false,
        onProgress: (p) => post({ kind: 'progress', ...p })
      });
      post({ kind: 'done', dump });
    } catch (e) {
      post({ kind: 'error', message: e.message, status: e.status ?? null });
    }
  });
});
