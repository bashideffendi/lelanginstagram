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

/** Susunan acara kalender dari satu catatan pantauan. */
function acara(it, tz) {
  const judul = it.title || 'Lelang Instagram';
  const penjual = it.owner ? '@' + it.owner : 'penjual tidak diketahui';
  const waktu = new Date(it.closeAt * 1000).toISOString();

  const rincian = [
    `Penjual: ${penjual}`,
    it.openBid != null ? `Harga pembukaan: Rp${it.openBid.toLocaleString('id-ID')}` : null,
    it.increment != null ? `Kelipatan: Rp${it.increment.toLocaleString('id-ID')}` : null,
    it.sniperMin ? `Sniper zone: ${it.sniperMin} menit terakhir` : null,
    it.topBid != null ? `Tertinggi saat terakhir dicek: Rp${it.topBid.toLocaleString('id-ID')}` : null,
    '',
    it.url || '',
    '',
    'Dikelola otomatis oleh Lelang Insta.'
  ].filter((x) => x !== null).join('\n');

  return {
    summary: `Lelang tutup — ${judul} (${penjual})`,
    description: rincian,
    start: { dateTime: waktu, timeZone: tz },
    end: { dateTime: waktu, timeZone: tz },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 5 }
      ]
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
  const hasil = { dibuat: 0, diperbarui: 0, dihapus: 0, gagal: [] };

  for (const it of items) {
    const perlu = it.status === 'aktif' && it.closeAt != null;

    try {
      if (perlu) {
        if (it.gcalId) {
          await panggil(`/calendars/primary/events/${encodeURIComponent(it.gcalId)}`, {
            method: 'PATCH',
            body: JSON.stringify(acara(it, tz))
          });
          hasil.diperbarui++;
        } else {
          const j = await panggil('/calendars/primary/events', {
            method: 'POST',
            body: JSON.stringify(acara(it, tz))
          });
          simpan({ ...it, gcalId: j.id });
          hasil.dibuat++;
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
