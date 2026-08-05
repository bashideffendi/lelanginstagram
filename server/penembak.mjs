/**
 * Penembak tawaran otomatis.
 *
 * Berjalan di server, jadi tetap menembak walau semua perangkatmu mati — itu
 * satu-satunya alasan bagian ini ada di sini dan bukan di browser.
 *
 * Keputusannya TIDAK dibuat di sini. Modul ini memanggil putusan() dari
 * web/js/tawar.js — berkas yang sama persis yang dipakai halaman, bukan
 * salinannya. Kalau keputusan ditulis dua kali, suatu saat keduanya berbeda,
 * dan bedanya baru ketahuan lewat tawaran yang tidak seharusnya terkirim.
 *
 * Yang dikerjakan di sini cuma tiga hal yang memang tidak bisa di browser:
 * bangun sendiri menjelang lelang tutup, menarik harga terbaru, dan mengirim
 * komentarnya.
 */

import fs from 'node:fs';
import path from 'node:path';
import { extract, shortcodeFromUrl, shortcodeToMediaId } from '../shared/ig-core.js';
import { putusan, teksTawaran, SEBAB } from '../web/js/tawar.js';

/**
 * Seberapa sering langit dilihat.
 *
 * Dua detik: cukup rapat supaya titik tembak meleset paling banyak dua detik,
 * dan cukup jarang supaya tidak ada beban berarti saat tidak ada lelang.
 */
const DETAK_MS = 2000;

/**
 * Berapa lama sebelum titik tembak penarikan harga dimulai.
 *
 * Diukur pada lelang sungguhan: baca harga tanpa balasan 0,95 detik, kirim
 * komentar 0,3 detik. Dua setengah detik memberi ruang untuk keduanya plus
 * jaringan yang tersendat, tanpa membuat harganya basi.
 */
const SIAP_SIAP_MS = 2500;

export function buatPenembak({ berkasPantau, headerIg, igBase, cookie, akunSekarang, log = console.log }) {
  let jalan = false;
  let detak = null;
  const sedang = new Set();

  function bacaDaftar() {
    try {
      const d = JSON.parse(fs.readFileSync(berkasPantau, 'utf8'));
      const items = Array.isArray(d) ? d : (d.items || []);
      return { items, akun: String(d.akun || '') };
    } catch {
      return { items: [], akun: '' };
    }
  }

  function tulisDaftar(ubah) {
    // Baca-ubah-tulis, bukan menyimpan salinan di memori: halaman juga menulis
    // berkas ini lewat /pantau, dan menyimpan salinan berarti perubahan dari
    // ponselmu ditimpa diam-diam oleh keadaan yang dihafal proses ini.
    let d;
    try { d = JSON.parse(fs.readFileSync(berkasPantau, 'utf8')); } catch { return; }
    const items = Array.isArray(d) ? d : (d.items || []);
    const i = items.findIndex((x) => x.id === ubah.id);
    if (i < 0) return;
    items[i] = { ...items[i], ...ubah };

    const isi = Array.isArray(d) ? items : { ...d, items, updatedAt: Date.now() };
    const tmp = berkasPantau + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(isi), { mode: 0o600 });
    fs.renameSync(tmp, berkasPantau);
    try { fs.chmodSync(berkasPantau, 0o600); } catch { /* diabaikan */ }
  }

  /** Harga terbaru, mode cepat: satu halaman, tanpa balasan. */
  async function hargaTerbaru(url) {
    const dump = await extract({
      base: igBase,
      url,
      version: 'penembak-1.0.0',
      via: 'server',
      includeRaw: false,
      skipReplies: true,
      maxPages: 1,
      manualRedirect: true,
      headers: { ...headerIg, cookie: cookie() }
    });
    return dump;
  }

  /**
   * Kirim komentarnya ke Instagram.
   *
   * Memakai titik akhir yang dipakai klien web Instagram sendiri. csrftoken
   * wajib dikirim sebagai header, bukan cuma sebagai cookie — tanpa itu
   * jawabannya 403 tanpa penjelasan.
   */
  async function kirimKomentar(mediaId, teks) {
    const kuki = cookie();
    const csrf = (kuki.match(/csrftoken=([^;]+)/) || [])[1] || '';
    const r = await fetch(`${igBase}/api/v1/web/comments/${mediaId}/add/`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        ...headerIg,
        cookie: kuki,
        'x-csrftoken': csrf,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ comment_text: teks }).toString()
    });

    const j = await r.json().catch(() => null);
    if (!r.ok || j?.status === 'fail') {
      const e = new Error(j?.message || `Instagram menolak (HTTP ${r.status}).`);
      e.status = r.status;
      throw e;
    }
    return j;
  }

  async function coba(it, akunSaya, akunPenembak, sekarangDetik) {
    /*
     * Kunci di memori proses ini.
     *
     * Cukup, karena hanya ada satu proses server. Yang dijaga bukan dua
     * server, melainkan dua putaran detak yang saling menyusul saat penarikan
     * lebih lama dari dua detik.
     */
    if (sedang.has(it.id)) return;
    sedang.add(it.id);

    try {
      // Harga dibaca ULANG sesaat sebelum menembak. Yang tersimpan di berkas
      // bisa berumur puluhan detik, dan di detik-detik terakhir itu selisih
      // yang menentukan menang atau kalah.
      const dump = await hargaTerbaru(it.url);
      const segar = ringkas(dump, akunSaya);

      const p = putusan({ ...it, ...segar }, {
        now: Math.floor(Date.now() / 1000),
        akunSaya,
        akunPenembak
      });

      if (!p.tembak) {
        log(`[tembak] ${it.id}: tidak — ${p.kode}`);
        // Yang sudah pasti tidak akan berubah lagi ditandai supaya tidak
        // ditarik berulang sampai lelangnya tutup.
        if (p.kode === SEBAB.LEWAT_BATAS || p.kode === SEBAB.SUDAH_TUTUP) {
          tulisDaftar({ id: it.id, autoTembakPada: sekarangDetik, autoTembakNilai: null,
            autoTembakGalat: p.pesan });
        }
        return;
      }

      const teks = teksTawaran(p.nilai, it.teksTawar);
      const mediaId = String(shortcodeToMediaId(it.shortcode || shortcodeFromUrl(it.url)));

      log(`[tembak] ${it.id}: mengirim "${teks}" sebagai @${akunPenembak}`);
      await kirimKomentar(mediaId, teks);

      tulisDaftar({
        id: it.id,
        autoTembakPada: Math.floor(Date.now() / 1000),
        autoTembakNilai: p.nilai,
        autoTembakGalat: null,
        autoTembakOleh: 'server'
      });
      log(`[tembak] ${it.id}: TERKIRIM ${teks}`);
    } catch (e) {
      log(`[tembak] ${it.id}: GAGAL — ${e.message}`);
      tulisDaftar({
        id: it.id,
        autoTembakPada: Math.floor(Date.now() / 1000),
        autoTembakNilai: null,
        autoTembakGalat: String(e.message).slice(0, 160),
        autoTembakOleh: 'server'
      });
    } finally {
      sedang.delete(it.id);
    }
  }

  /** Ambil harga tertinggi dan peta tawaran dari dump, bentuk yang dipakai putusan(). */
  function ringkas(dump, akunSaya) {
    const rows = (dump.comments || []).filter((c) => c.username);
    const peta = {};
    let topBid = null;
    let topUser = null;

    // Sengaja memakai pembaca yang sama dengan halaman — diimpor, bukan ditulis
    // ulang — supaya angka yang dipakai menembak sama dengan angka yang kamu
    // lihat di kartu.
    for (const c of rows) {
      const v = bacaNilai(c.text);
      if (v == null) continue;
      const u = String(c.username).toLowerCase();
      if (peta[u] == null || peta[u] < v) peta[u] = v;
      if (topBid == null || v > topBid) { topBid = v; topUser = c.username; }
    }
    return { topBid, topUser, tawaranPer: peta };
  }

  let bacaNilai = () => null;

  return {
    /** Pembaca nilai disuntikkan dari luar supaya modul ini tetap bisa diuji. */
    pakaiPembaca(fn) { bacaNilai = fn; },

    /** Dihentikan supaya proses bisa berakhir — dipakai uji, dan saat mati bersih. */
    hentikan() {
      if (detak) clearInterval(detak);
      detak = null;
      jalan = false;
    },

    mulai() {
      if (jalan) return;
      jalan = true;
      log('[tembak] penembak otomatis hidup');

      detak = setInterval(async () => {
        const { items, akun } = bacaDaftar();
        if (!items.length) return;

        const akunSaya = akun.split(',').map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
        // Diambil dari sesi yang benar-benar hidup, bukan dari setelan: kalau
        // keduanya berbeda, yang menembak tetap akun sesinya, dan menembak
        // atas nama yang salah lebih buruk daripada tidak menembak.
        const akunPenembak = String(akunSekarang?.() || '').toLowerCase();
        if (!akunPenembak) return;

        const now = Date.now();
        const nowDetik = Math.floor(now / 1000);

        for (const it of items) {
          if (!it.autoBid || it.autoTembakPada || !it.closeAt || !it.url) continue;
          if (it.status !== 'aktif') continue;

          const titik = it.closeAt * 1000 - (it.leadDetik || 5) * 1000;
          // Jendelanya dibuka sedikit lebih awal supaya penarikan harganya
          // sempat selesai, dan ditutup di jam tutup supaya tidak pernah
          // mengirim tawaran yang lewat batas.
          if (now < titik - SIAP_SIAP_MS) continue;
          if (now > it.closeAt * 1000) continue;

          coba(it, akunSaya, akunPenembak, nowDetik);
        }
      }, DETAK_MS);
    }
  };
}
