/**
 * Masuk, dan penyimpanan pantauan di server.
 *
 * Tanpa masuk, daftar pantauan hanya ada di browser ini — hilang kalau ganti
 * perangkat. Setelah masuk, daftarnya dititipkan ke servermu sendiri sehingga
 * laptop dan ponsel melihat isi yang sama.
 *
 * Kata sandinya tidak pernah disimpan di browser; yang disimpan cuma tanda
 * sesi yang bisa dicabut dengan keluar atau memulai ulang layanan.
 */

import { apiBase } from '../config.js';

const KUNCI_TOKEN = 'lelanginsta_sesi';

export function token() {
  try { return localStorage.getItem(KUNCI_TOKEN) || ''; } catch { return ''; }
}

function simpanToken(t) {
  try {
    if (t) localStorage.setItem(KUNCI_TOKEN, t);
    else localStorage.removeItem(KUNCI_TOKEN);
  } catch { /* mode privat */ }
}

export function sudahMasuk() {
  return !!token();
}

async function panggil(jalur, opsi = {}) {
  const r = await fetch(apiBase() + jalur, {
    ...opsi,
    headers: {
      'content-type': 'application/json',
      ...(token() ? { 'x-lelang-token': token() } : {}),
      ...(opsi.headers || {})
    }
  });

  let j = null;
  try { j = await r.json(); } catch { /* balasan tanpa isi */ }

  if (!r.ok) {
    const e = new Error(j?.message || `HTTP ${r.status}`);
    e.status = r.status;
    e.kode = j?.error;
    throw e;
  }
  return j;
}

/** Apakah servernya sudah punya kata sandi, atau ini pemakaian pertama? */
export async function keadaan() {
  try {
    const j = await panggil('/akun/keadaan');
    return {
      ada: true,
      terpasang: !!j.terpasang,
      google: !!j.google,
      clientId: j.clientId || ''
    };
  } catch {
    return { ada: false, terpasang: false, google: false, clientId: '' };
  }
}

/**
 * Masuk dengan akun Google.
 *
 * Yang dikirim ke server cuma ID token dari Google — bukan kata sandi, bukan
 * apa pun yang bisa dipakai ulang di tempat lain. Server yang memeriksa
 * kesahihannya ke Google dan mencocokkan alamatnya dengan daftar yang
 * diizinkan; halaman ini tidak memutuskan apa-apa soal siapa yang boleh masuk.
 */
export async function masukGoogle(credential) {
  const j = await panggil('/akun/google', {
    method: 'POST', body: JSON.stringify({ credential })
  });
  simpanToken(j.token);
  return j;
}

export async function pasangSandi(sandi) {
  const j = await panggil('/akun/pasang', { method: 'POST', body: JSON.stringify({ sandi }) });
  simpanToken(j.token);
  return j.token;
}

export async function masuk(sandi) {
  const j = await panggil('/akun/masuk', { method: 'POST', body: JSON.stringify({ sandi }) });
  simpanToken(j.token);
  return j.token;
}

export async function keluar() {
  // Dicabut di server dulu, baru dilupakan di browser. Kebalikannya menyisakan
  // tanda sesi yang masih sah tapi tidak bisa dicabut lagi dari sini.
  try { await panggil('/akun/keluar', { method: 'POST' }); } catch { /* tetap keluar */ }
  simpanToken('');
}

export async function ambilDariServer() {
  return panggil('/pantau');
}

export async function kirimKeServer(items, akun) {
  return panggil('/pantau', { method: 'PUT', body: JSON.stringify({ items, akun }) });
}
