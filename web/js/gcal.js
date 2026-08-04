/**
 * Sinkron ke Google Calendar.
 *
 * Bekerja langsung dari browser: izin diminta lewat alur resmi Google, dan
 * kunci aksesnya hanya disimpan di memori halaman ini — tidak pernah ditulis
 * ke penyimpanan, tidak pernah dikirim ke server mana pun, dan hilang begitu
 * tab ditutup. Kalau izinnya sudah pernah diberikan, permintaan berikutnya
 * berjalan diam-diam tanpa menampilkan jendela lagi.
 *
 * Dibutuhkan satu "client ID" milik pengguna sendiri, dibuat sekali di Google
 * Cloud. Google tidak mengizinkan aplikasi menulis ke kalender orang tanpa itu.
 */

import { CLIENT_ID_GOOGLE } from '../config.js';
import { pengingat } from './pantau.js';
import { fmtTime } from './time.js';

const CAKUPAN = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';

let tokenClient = null;
let token = null;          // hanya di memori
let tokenSampai = 0;

export function clientId() {
  try {
    const ov = localStorage.getItem('lelanginsta_gcal_id');
    if (ov) return ov.trim();
  } catch { /* diabaikan */ }
  return (CLIENT_ID_GOOGLE || '').trim();
}

export function siap() {
  return !!clientId();
}

/** Muat pustaka resmi Google sekali saja. */
function muatGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (muatGis._janji) return muatGis._janji;

  muatGis._janji = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(
      'Gagal memuat pustaka Google. Periksa sambungan internet, ' +
      'atau jaringanmu memblokir accounts.google.com.'
    ));
    document.head.appendChild(s);
  });
  return muatGis._janji;
}

/**
 * @param diam true = jangan tampilkan jendela izin; dipakai saat halaman baru
 *             dibuka dan izinnya sudah pernah diberikan sebelumnya.
 */
export async function hubungkan({ diam = false } = {}) {
  const id = clientId();
  if (!id) throw new Error('Client ID Google belum disetel.');

  if (token && Date.now() < tokenSampai - 60000) return token;

  await muatGis();

  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: CAKUPAN,
      callback: () => {}          // diisi per permintaan di bawah
    });
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) {
        // Saat diam, penolakan itu wajar: berarti pengguna memang belum
        // pernah memberi izin, dan tidak boleh diganggu jendela.
        reject(new Error(resp.error === 'interaction_required' || diam
          ? 'belum_diizinkan'
          : 'Izin Google ditolak: ' + resp.error));
        return;
      }
      token = resp.access_token;
      tokenSampai = Date.now() + (Number(resp.expires_in || 3600) * 1000);
      resolve(token);
    };

    try {
      tokenClient.requestAccessToken({ prompt: diam ? 'none' : '' });
    } catch (e) {
      reject(e);
    }
  });
}

export function terhubung() {
  return !!token && Date.now() < tokenSampai;
}

export function putuskan() {
  if (token && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(token); } catch { /* diabaikan */ }
  }
  token = null;
  tokenSampai = 0;
  akunTersambung._nilai = null;
}

async function panggil(jalur, opsi = {}) {
  const t = await hubungkan({ diam: true }).catch(() => hubungkan());
  const r = await fetch(API + jalur, {
    ...opsi,
    headers: {
      authorization: 'Bearer ' + t,
      'content-type': 'application/json',
      ...(opsi.headers || {})
    }
  });

  if (r.status === 204) return null;
  const j = await r.json().catch(() => null);

  if (!r.ok) {
    const pesan = j?.error?.message || `HTTP ${r.status}`;
    const e = new Error(pesan);
    e.status = r.status;
    throw e;
  }
  return j;
}

/**
 * Alamat akun Google yang sedang tersambung.
 *
 * Tanpa ini, satu-satunya cara mengetahui acaranya dititipkan ke akun yang
 * mana adalah membuka acaranya dan melihat apakah Google menolak — jawaban
 * yang baru datang setelah kejadian, di perangkat yang salah, dalam bentuk
 * "a supported calendar is not available in this account".
 *
 * Diambil dari daftar acara, bukan dari data akun: cakupan izin yang diminta
 * cuma acara kalender, dan alamatnya kebetulan memang nama kalender utama.
 * Jadi tidak perlu meminta izin tambahan hanya untuk menampilkan ini.
 */
export async function akunTersambung() {
  if (akunTersambung._nilai) return akunTersambung._nilai;
  try {
    const j = await panggil('/calendars/primary/events?maxResults=1&fields=summary');
    const nama = j?.summary || '';
    if (nama.includes('@')) akunTersambung._nilai = nama;
    return akunTersambung._nilai || null;
  } catch {
    return null;                 // bukan kegagalan yang perlu mengganggu
  }
}

/** Susunan acara kalender dari satu catatan pantauan. */
function acara(it, tz) {
  const judul = it.title || 'Lelang Instagram';
  const penjual = it.owner ? '@' + it.owner : 'penjual tidak diketahui';
  const waktu = new Date(it.closeAt * 1000).toISOString();

  // Zona sniper disebut dengan jam mulainya, bukan cuma panjangnya. "Sniper
  // zone: 5 menit terakhir" masih menuntut hitung-hitungan saat panik;
  // "mulai 20:55" langsung bisa dibandingkan dengan jam di tangan.
  const zona = it.sniperMin && it.closeAt != null
    ? `Sniper zone: mulai ${fmtTime(it.closeAt - it.sniperMin * 60, tz)} ` +
      `(${it.sniperMin} menit terakhir). Belum pernah menawar sebelum jam itu = tidak boleh ikut.`
    : null;

  const rincian = [
    `Penjual: ${penjual}`,
    it.openBid != null ? `Harga pembukaan: Rp${it.openBid.toLocaleString('id-ID')}` : null,
    it.increment != null ? `Kelipatan: Rp${it.increment.toLocaleString('id-ID')}` : null,
    zona,
    it.topBid != null ? `Tertinggi saat terakhir dicek: Rp${it.topBid.toLocaleString('id-ID')}` : null,
    '',
    it.url || '',
    '',
    'Dikelola otomatis oleh Lelang Insta.'
  ].filter((x) => x !== null).join('\n');

  return {
    summary: `Lelang tutup — ${judul} (${penjual})`,
    description: rincian,
    /*
     * Acaranya diberi panjang 15 menit, bukan nol.
     *
     * Google menerima acara berdurasi nol lewat API dan mengembalikan
     * "berhasil dibuat", tapi di tampilan kalender benda itu tidak punya
     * tinggi sama sekali — jadi terlihat seperti tidak ada yang tersimpan.
     * Mulainya tepat di jam tutup, sehingga hitungan pengingat "sekian menit
     * sebelum mulai" tetap berarti sekian menit sebelum lelang tutup.
     */
    start: { dateTime: waktu, timeZone: tz },
    end: { dateTime: new Date((it.closeAt + 15 * 60) * 1000).toISOString(), timeZone: tz },
    // Google hanya menerima menitnya; teks popupnya selalu judul acara, tidak
    // bisa diatur. Karena itu alasan tiap pengingat ditaruh di rincian.
    reminders: {
      useDefault: false,
      overrides: pengingat(it).map((p) => ({ method: 'popup', minutes: p.menit }))
    }
  };
}

/**
 * Satukan daftar pantauan ke kalender.
 *
 * Lelang berjalan yang punya jam tutup dibuatkan atau diperbarui acaranya;
 * yang sudah selesai, dibatalkan, atau kehilangan jam tutupnya dihapus dari
 * kalender. Jadi kalender selalu memantulkan keadaan sekarang, bukan tumpukan
 * sisa acara lama.
 */
export async function sinkron(items, tz, { simpan }) {
  const hasil = { dibuat: 0, diperbarui: 0, dihapus: 0, gagal: [], tautan: null };

  for (const it of items) {
    const perlu = it.status === 'aktif' && it.closeAt != null;

    try {
      if (perlu) {
        if (it.gcalId) {
          const j = await panggil(`/calendars/primary/events/${encodeURIComponent(it.gcalId)}`, {
            method: 'PATCH',
            body: JSON.stringify(acara(it, tz))
          });
          if (j.htmlLink && j.htmlLink !== it.gcalLink) simpan({ ...it, gcalLink: j.htmlLink });
          hasil.diperbarui++;
          hasil.tautan = hasil.tautan || j.htmlLink || null;
        } else {
          const j = await panggil('/calendars/primary/events', {
            method: 'POST',
            body: JSON.stringify(acara(it, tz))
          });
          // Tautannya ikut disimpan. "1 ditambahkan" tidak membuktikan apa-apa
          // kalau acaranya tidak ketemu di kalender; tautan ini membuka acara
          // itu persis, di akun mana pun dia sebenarnya dibuat.
          simpan({ ...it, gcalId: j.id, gcalLink: j.htmlLink || null });
          hasil.dibuat++;
          hasil.tautan = hasil.tautan || j.htmlLink || null;
        }
      } else if (it.gcalId) {
        await panggil(`/calendars/primary/events/${encodeURIComponent(it.gcalId)}`, { method: 'DELETE' });
        simpan({ ...it, gcalId: null });
        hasil.dihapus++;
      }
    } catch (e) {
      // Acara yang sudah dihapus manusia di kalender akan menjawab 404 atau
      // 410; itu bukan kegagalan, cukup lupakan tautannya lalu buat lagi nanti.
      if (e.status === 404 || e.status === 410) {
        simpan({ ...it, gcalId: null });
        continue;
      }
      hasil.gagal.push({ id: it.id, pesan: e.message });
    }
  }

  return hasil;
}

/** Hapus satu acara, dipakai saat lelangnya dibuang dari pantauan. */
export async function hapusAcara(gcalId) {
  if (!gcalId) return;
  try {
    await panggil(`/calendars/primary/events/${encodeURIComponent(gcalId)}`, { method: 'DELETE' });
  } catch (e) {
    if (e.status !== 404 && e.status !== 410) throw e;
  }
}
