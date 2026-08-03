/**
 * Alamat server penarik komentar.
 *
 * Kosong berarti memakai alamat yang sama dengan halaman ini — yaitu fungsi
 * Vercel di /api/comments. Isi dengan alamat penuh untuk memakai server
 * sendiri, misalnya di VPS:
 *
 *   export const API_BASE = 'https://api.lelanginsta.masbash.id';
 *
 * Instagram menolak sesi yang dipakai dari IP pusat data Vercel, sementara
 * IP VPS biasanya diterima. Karena itu server sendiri lebih andal untuk mode
 * tempel-link, walaupun extension tetap yang paling tidak bermasalah.
 */
export const API_BASE = 'https://lelanginsta-api.tempuscollective.com';

/** Untuk mencoba server lain tanpa mengubah berkas ini: */
export function apiBase() {
  try {
    const ov = localStorage.getItem('lelanginsta_api');
    if (ov) return ov.replace(/\/+$/, '');
  } catch { /* localStorage bisa diblokir */ }
  return API_BASE.replace(/\/+$/, '');
}
