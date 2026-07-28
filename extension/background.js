/**
 * Service worker Ketok.
 *
 * Satu-satunya bagian yang punya izin ke instagram.com. Halaman web Ketok
 * tidak bisa dan tidak pernah menyentuh Instagram langsung — ia hanya
 * menitipkan alamat post lewat bridge.js, lalu menerima hasilnya.
 *
 * Sesi login tetap di browser: fetch di sini memakai cookie yang sudah ada,
 * dan cookie itu tidak pernah dibaca, disalin, atau dikirim ke mana pun.
 */
import { extract } from './ig-core.js';

const VERSION = chrome.runtime.getManifest().version;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ketok') return;

  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.action !== 'extract') return;

    const post = (m) => {
      // Port bisa sudah tertutup kalau tab pengguna ditutup di tengah jalan.
      try { port.postMessage(m); } catch { /* diabaikan */ }
    };

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
