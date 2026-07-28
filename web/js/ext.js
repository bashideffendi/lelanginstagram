/**
 * Klien extension Ketok.
 *
 * Halaman ini tidak punya izin apa pun ke instagram.com — browser memblokirnya,
 * dan itu memang seharusnya. Kalau extension terpasang, ia yang melakukan
 * penarikan dan mengirim hasilnya balik ke sini lewat window.postMessage.
 */

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
