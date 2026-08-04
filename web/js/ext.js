/**
 * Klien extension Ketok.
 *
 * Halaman ini tidak punya izin apa pun ke instagram.com — browser memblokirnya,
 * dan itu memang seharusnya. Kalau extension terpasang, ia yang melakukan
 * penarikan dan mengirim hasilnya balik ke sini lewat window.postMessage.
 */

import { apiBase } from '../config.js';

const pending = new Map();
let seq = 0;

window.addEventListener('message', (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.ketokExt !== 'res') return;

  const h = pending.get(d.id);
  if (!h) return;

  if (d.kind === 'progress') { h.onProgress?.(d); return; }

  pending.delete(d.id);
  clearTimeout(h.timer);
  if (d.kind === 'error') h.reject(Object.assign(new Error(d.message), { status: d.status }));
  else h.resolve(d);
});

function call(action, payload, { onProgress, timeoutMs = 0 } = {}) {
  const id = 'k' + (++seq);
  return new Promise((resolve, reject) => {
    const timer = timeoutMs
      ? setTimeout(() => {
          pending.delete(id);
          reject(new Error('timeout'));
        }, timeoutMs)
      : null;
    pending.set(id, { resolve, reject, onProgress, timer });
    window.postMessage({ ketokExt: 'req', id, action, ...payload }, location.origin);
  });
}

/** Petunjuk cepat: bridge.js menandai <html> begitu ia dimuat. */
export function extInstalled() {
  return document.documentElement.hasAttribute('data-ketok-ext');
}

/** Konfirmasi sungguhan lewat ping. Mengembalikan versi, atau null. */
export async function pingExtension(timeoutMs = 700) {
  try {
    const r = await call('ping', {}, { timeoutMs });
    return r.version || 'terpasang';
  } catch {
    return null;
  }
}

/** Minta extension menarik komentar dari sebuah alamat post. */
export async function extractViaExtension(url, onProgress) {
  const r = await call('extract', { url, includeRaw: true }, { onProgress });
  return r.dump;
}

/** Cek bentuk alamat sebelum repot-repot memanggil extension. */
export function looksLikePostUrl(url) {
  return /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,}/.test(String(url));
}

// ---------------------------------------------------------------- mode server

const KEY_STORE = 'ketok_key';

export function savedKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

export function saveKey(k) {
  try { localStorage.setItem(KEY_STORE, k); } catch { /* mode privat */ }
}

async function callServer(path, key) {
  // Kosong = fungsi di alamat yang sama; terisi = server sendiri, misalnya VPS.
  const r = await fetch(apiBase() + path, { headers: key ? { 'x-ketok-key': key } : {} });
  let body = {};
  try { body = await r.json(); } catch { /* bukan JSON */ }
  return { ok: r.ok, status: r.status, body };
}

/**
 * Apakah mode server siap dipakai?
 *   'off'         endpoint tidak ada, atau sengaja belum diaktifkan di server
 *   'need-key'    aktif, tapi kunci belum diisi atau salah
 *   'no-session'  kunci sudah benar, tapi sesi Instagram belum disetel di server
 *   'ready'       aktif, kunci diterima, sesi ada
 */
export async function probeServer(key) {
  try {
    // Tanpa parameter url, endpoint yang sehat menjawab 400 — itu justru
    // bukti bahwa gembok dan sesinya sudah lolos.
    const r = await callServer('/api/comments', key);
    if (r.status === 400) return 'ready';
    if (r.status === 401) return 'need-key';
    if (r.status === 503 && r.body.error === 'sesi_kosong') return 'no-session';
    return 'off';
  } catch {
    return 'off';
  }
}

/**
 * Keadaan sesi Instagram di server, tanpa menarik apa pun.
 *
 * Sesi Instagram mati sendiri cepat atau lambat, dan sebelumnya matinya baru
 * ketahuan saat kamu menarik lelang yang sedang panas — waktu paling buruk
 * untuk mengurus cookie. Server memeriksanya tiap empat jam; ini cuma membaca
 * hasilnya, jadi murah dan bisa dipanggil tiap halaman dibuka.
 */
export async function keadaanSesiServer() {
  try {
    const r = await fetch(apiBase() + '/sehat', { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.sesiIg || null;
  } catch {
    return null;                  // server mati itu urusan lain, bukan ini
  }
}

export async function extractViaServer(url, key) {
  const r = await callServer('/api/comments?url=' + encodeURIComponent(url), key);
  if (!r.ok) {
    throw Object.assign(new Error(r.body.message || 'Gagal menghubungi server (HTTP ' + r.status + ').'), {
      code: r.body.error,
      httpStatus: r.status,
      igStatus: r.body.status
    });
  }
  return r.body;
}
