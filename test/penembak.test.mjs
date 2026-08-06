/**
 * Uji penembak tawaran otomatis.
 *
 * Ini satu-satunya bagian yang mengirim sesuatu ke Instagram tanpa ada manusia
 * yang menekan apa pun. Instagram-nya dipalsukan seluruhnya di sini: yang
 * diuji adalah kapan ia menembak, berapa yang dikirim, dan kapan ia menolak —
 * bukan apakah Instagram menerimanya.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buatPenembak } from '../server/penembak.mjs';
import { parseBid } from '../web/js/analysis.js';

/**
 * Jam tutup dihitung SAAT tiap uji dibuat, bukan sekali saat modul dimuat.
 *
 * Dihitung sekali di atas berarti uji kedua dan seterusnya sudah lewat jam
 * tutupnya sebelum sempat berjalan — dan penembak yang benar memang menolak
 * menembak lelang yang sudah tutup, jadi ujinya gagal karena kodenya benar.
 */
const tutupSebentarLagi = () => Math.floor(Date.now() / 1000) + 3;

function berkasSementara(isi) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tembak-')), 'pantau.json');
  fs.writeFileSync(f, JSON.stringify(isi));
  return f;
}

const lelang = (ubah = {}) => ({
  closeAt: tutupSebentarLagi(),
  id: 'A1',
  url: 'https://www.instagram.com/p/CabcdefGHIJ/',
  shortcode: 'CabcdefGHIJ',
  status: 'aktif',
  autoBid: true,
  maksBid: 1000000,
  increment: 50000,
  leadDetik: 2,
  ...ubah
});

/**
 * Penembak dengan Instagram palsu.
 *
 * @param komentar komentar yang "ada" di postingan saat harga ditarik
 */
function siapkan({ items, akun = 'durian', komentar = [] }) {
  const f = berkasSementara({ items, akun });
  const terkirim = [];
  const catatan = [];

  const p = buatPenembak({
    berkasPantau: f,
    headerIg: {},
    igBase: 'https://ig.palsu',
    cookie: () => 'sessionid=x; csrftoken=CSRF',
    akunSekarang: () => 'durian',
    log: (m) => catatan.push(m)
  });
  p.pakaiPembaca((teks) => {
    const b = parseBid(teks);
    if (b.value == null || b.relatif) return null;
    return b.kuat ? b.value : (b.value < 10000 ? b.value * 1000 : b.value);
  });

  const fetchAsli = globalThis.fetch;
  globalThis.fetch = async (url, opsi) => {
    const u = String(url);
    // Dua jalur kirim: endpoint aplikasi (/media/{id}/comment/) yang dicoba
    // lebih dulu, dan endpoint web (/web/comments/{id}/add/) sebagai cadangan.
    if (opsi?.method === 'POST' && /\/comment\/$|\/add\/$/.test(u)) {
      terkirim.push(new URLSearchParams(opsi.body).get('comment_text'));
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
    // Info media dan daftar komentar.
    if (u.includes('/info/')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ caption: null, user: {} }] }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        comments: komentar.map((c, i) => ({
          pk: String(i + 1), created_at: Math.floor(Date.now() / 1000) - 100 + i,
          text: c.text, user: { username: c.u }
        })),
        next_max_id: null
      })
    };
  };

  return {
    penembak: p, terkirim, catatan, berkas: f,
    pulihkan: () => { p.hentikan(); globalThis.fetch = fetchAsli; }
  };
}

/** Jalankan satu putaran detak secara langsung, tanpa menunggu timer. */
async function satuPutaran(s) {
  s.penembak.mulai();
  await new Promise((r) => setTimeout(r, 2600));
}

test('menembak tawaran berikutnya menjelang tutup', async () => {
  const s = siapkan({
    items: [lelang()],
    komentar: [{ u: 'durian', text: '750rb' }, { u: 'orang', text: '800rb' }]
  });
  try {
    await satuPutaran(s);
    assert.deepEqual(s.terkirim, ['Rp850.000'], 'tertinggi 800rb + kelipatan 50rb');
    // Jalur aplikasi yang dipakai lebih dulu, bukan jalur web.

    const d = JSON.parse(fs.readFileSync(s.berkas, 'utf8'));
    assert.equal(d.items[0].autoTembakNilai, 850000);
    assert.equal(d.items[0].autoTembakGalat, null);
    assert.equal(d.items[0].autoTembakOleh, 'server');
  } finally { s.pulihkan(); }
});

test('tidak menembak kalau harga sudah lewat batas atas', async () => {
  const s = siapkan({
    items: [lelang({ maksBid: 800000 })],
    komentar: [{ u: 'durian', text: '750rb' }, { u: 'orang', text: '800rb' }]
  });
  try {
    await satuPutaran(s);
    assert.deepEqual(s.terkirim, [], 'kalah dengan sadar, bukan menang di harga yang tidak disetujui');
    assert.ok(s.catatan.some((m) => m.includes('lewat_batas')));
  } finally { s.pulihkan(); }
});

test('tidak menembak kalau akun penembak belum pernah menawar', async () => {
  // Syarat sniper zone. Tawaran pertama yang ditembakkan mesin batal menurut
  // aturan penjualnya sendiri.
  const s = siapkan({
    items: [lelang()],
    komentar: [{ u: 'orang', text: '800rb' }]
  });
  try {
    await satuPutaran(s);
    assert.deepEqual(s.terkirim, []);
    assert.ok(s.catatan.some((m) => m.includes('belum_menawar')));
  } finally { s.pulihkan(); }
});

test('tidak menembak dua kali untuk satu lelang', async () => {
  const s = siapkan({
    items: [lelang()],
    komentar: [{ u: 'durian', text: '750rb' }, { u: 'orang', text: '800rb' }]
  });
  try {
    await satuPutaran(s);
    await new Promise((r) => setTimeout(r, 2200));   // detak berikutnya
    assert.equal(s.terkirim.length, 1, 'autoTembakPada menutup putaran berikutnya');
  } finally { s.pulihkan(); }
});

test('tidak menembak kalau menawar otomatis dimatikan', async () => {
  const s = siapkan({
    items: [lelang({ autoBid: false })],
    komentar: [{ u: 'durian', text: '750rb' }, { u: 'orang', text: '800rb' }]
  });
  try {
    await satuPutaran(s);
    assert.deepEqual(s.terkirim, []);
  } finally { s.pulihkan(); }
});

test('kegagalan Instagram dicatat, bukan ditelan', async () => {
  const s = siapkan({
    items: [lelang()],
    komentar: [{ u: 'durian', text: '750rb' }, { u: 'orang', text: '800rb' }]
  });
  const f = globalThis.fetch;
  globalThis.fetch = async (url, opsi) => {
    if (opsi?.method === 'POST' && /\/comment\/$|\/add\/$/.test(String(url))) {
      return { ok: false, status: 403, json: async () => ({ status: 'fail', message: 'checkpoint_required' }) };
    }
    return f(url, opsi);
  };
  try {
    await satuPutaran(s);
    const d = JSON.parse(fs.readFileSync(s.berkas, 'utf8'));
    assert.match(d.items[0].autoTembakGalat, /checkpoint_required/);
    assert.equal(d.items[0].autoTembakNilai, null);
  } finally { s.pulihkan(); }
});
