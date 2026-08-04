/**
 * Konversi & format waktu.
 *
 * Prinsip: sumber kebenaran selalu epoch detik (UTC-netral) dari Instagram.
 * Timezone hanya lapisan tampilan — ganti dropdown, epoch tidak pernah berubah.
 */

const CACHE = new Map();

function dtf(tz, opts) {
  const key = tz + '|' + JSON.stringify(opts);
  let f = CACHE.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts });
    CACHE.set(key, f);
  }
  return f;
}

export function browserTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const PINNED = [
  ['Asia/Jakarta', 'WIB — Jakarta'],
  ['Asia/Makassar', 'WITA — Makassar'],
  ['Asia/Jayapura', 'WIT — Jayapura'],
  ['UTC', 'UTC'],
  ['Asia/Singapore', 'Singapura'],
  ['Asia/Kuala_Lumpur', 'Kuala Lumpur'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Europe/London', 'London'],
  ['America/New_York', 'New York'],
  ['America/Los_Angeles', 'Los Angeles']
];

/** Daftar timezone: yang sering dipakai di atas, sisanya menyusul. */
export function tzOptions() {
  let all = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = PINNED.map(([z]) => z);
  }
  const pinnedIds = new Set(PINNED.map(([z]) => z));
  return {
    pinned: PINNED.filter(([z]) => all.includes(z) || pinnedIds.has(z)),
    rest: all.filter((z) => !pinnedIds.has(z))
  };
}

/** Offset timezone (detik) pada suatu titik waktu. Sadar DST. */
export function tzOffsetSeconds(epochSec, tz) {
  const parts = Object.fromEntries(
    dtf(tz, {
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
      .formatToParts(new Date(epochSec * 1000))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second
  ) / 1000;
  return Math.round(asUtc - epochSec);
}

/** Label offset, mis. "UTC+07:00". */
export function tzOffsetLabel(epochSec, tz) {
  const off = tzOffsetSeconds(epochSec, tz);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  const hh = String(Math.floor(a / 3600)).padStart(2, '0');
  const mm = String(Math.floor((a % 3600) / 60)).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/**
 * Waktu dinding di timezone tertentu -> epoch.
 * Dipakai untuk input cutoff: user mengetik jam lokal, kita butuh epoch.
 * Dua-lintasan agar benar di sekitar pergantian DST.
 */
export function wallTimeToEpoch(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
  const off1 = tzOffsetSeconds(guess, tz);
  let epoch = guess - off1;
  const off2 = tzOffsetSeconds(epoch, tz);
  if (off2 !== off1) epoch = guess - off2;
  return epoch;
}

/** Nilai <input type="datetime-local"> ("2026-07-28T14:30" / ":ss") -> epoch. */
export function datetimeLocalToEpoch(value, tz) {
  const m = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!m) return null;
  return wallTimeToEpoch(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz);
}

/** Epoch -> nilai untuk <input type="datetime-local"> di timezone tertentu. */
export function epochToDatetimeLocal(epochSec, tz) {
  const p = Object.fromEntries(
    dtf(tz, {
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
      .formatToParts(new Date(epochSec * 1000))
      .map((x) => [x.type, x.value])
  );
  const hh = String(+p.hour % 24).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}`;
}

export function fmtDateTime(epochSec, tz) {
  const p = Object.fromEntries(
    dtf(tz, {
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
      .formatToParts(new Date(epochSec * 1000))
      .map((x) => [x.type, x.value])
  );
  const hh = String(+p.hour % 24).padStart(2, '0');
  return `${p.day}/${p.month}/${p.year} ${hh}:${p.minute}:${p.second}`;
}

export function fmtTime(epochSec, tz) {
  const p = Object.fromEntries(
    dtf(tz, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(epochSec * 1000))
      .map((x) => [x.type, x.value])
  );
  return `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}:${p.second}`;
}

export function fmtDate(epochSec, tz) {
  const p = Object.fromEntries(
    dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(epochSec * 1000))
      .map((x) => [x.type, x.value])
  );
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * Nama hari singkat. "04/08/2026" tidak memberi tahu apa-apa tentang seberapa
 * dekat tanggal itu; "Sel" langsung terbaca tanpa membuka kalender.
 */
export function fmtHari(epochSec, tz) {
  const HARI = { Sun: 'Min', Mon: 'Sen', Tue: 'Sel', Wed: 'Rab', Thu: 'Kam', Fri: 'Jum', Sat: 'Sab' };
  const w = dtf(tz, { weekday: 'short' })
    .formatToParts(new Date(epochSec * 1000))
    .find((x) => x.type === 'weekday')?.value || '';
  return HARI[w] || w;
}

/**
 * "2026-08-04" dalam zona waktu terpilih — bentuk yang dimengerti
 * `<input type="date">`, satu-satunya bentuk yang diterimanya.
 */
export function fmtIsoDate(epochSec, tz) {
  const p = Object.fromEntries(
    dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(epochSec * 1000))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtIsoUtc(epochSec) {
  return new Date(epochSec * 1000).toISOString().replace('.000Z', 'Z');
}

/**
 * Durasi detik -> "1 jam 6 menit" / "4 menit 12 detik" / "12 detik".
 * Sengaja dieja penuh: singkatan seperti "41d" terbaca sebagai "41 hari"
 * padahal maksudnya detik, dan angka ini dipakai untuk menuduh orang telat.
 */
export function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  const neg = sec < 0;
  let s = Math.abs(Math.round(sec));
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;

  const parts = [];
  if (h) parts.push(`${h} jam`);
  if (m) parts.push(`${m} menit`);
  // Detik disembunyikan kalau durasinya sudah lebih dari sejam — tidak relevan
  // di skala itu, dan bikin kolom tabel kepanjangan.
  if (s && !h) parts.push(`${s} detik`);
  if (!parts.length) parts.push('0 detik');

  return (neg ? 'minus ' : '') + parts.join(' ');
}

/**
 * Terima jam apa adanya seperti orang menuliskannya: 21, 21.00, 21:00,
 * 2100, 9.30, 210030. Tanggalnya diambil dari pilihan terpisah, karena
 * lelang hampir selalu tutup di hari yang sama dengan komentarnya.
 */
export function parseClock(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  let h, mi = 0, sec = 0;

  if (/[.:\-\s]/.test(s)) {
    const p = s.split(/[.:\-\s]+/).filter(Boolean);
    if (!p.length || p.length > 3 || p.some((x) => !/^\d{1,2}$/.test(x))) return null;
    h = +p[0]; mi = +(p[1] ?? 0); sec = +(p[2] ?? 0);
  } else {
    if (!/^\d+$/.test(s)) return null;
    if (s.length <= 2) h = +s;
    else if (s.length === 3) { h = +s.slice(0, 1); mi = +s.slice(1); }
    else if (s.length === 4) { h = +s.slice(0, 2); mi = +s.slice(2); }
    else if (s.length === 6) { h = +s.slice(0, 2); mi = +s.slice(2, 4); sec = +s.slice(4); }
    else return null;
  }

  if (h > 23 || mi > 59 || sec > 59) return null;
  return { h, mi, sec };
}

export const pad = (n) => String(n).padStart(2, '0');

// Selalu sampai detik. Alat ini menjual ketelitian detik, jadi menyembunyikan
// ":00" membuat orang mengira ketelitiannya berhenti di menit.
export const fmtClock = (h, mi, sec) => `${pad(h)}:${pad(mi)}:${pad(sec || 0)}`;

/**
 * Sisipkan titik dua sambil diketik, supaya "2030" langsung terbaca "20:30"
 * dan tidak ada momen ragu apakah yang diketik sudah benar.
 *
 * Kalau pengguna mengetik pemisahnya sendiri, pengelompokannya dihormati —
 * "9:30" tetap 9:30, tidak dipaksa jadi 93:0.
 */
export function maskClock(raw) {
  const s = String(raw ?? '');

  if (/[.:]/.test(s)) {
    // Kelompok yang penuh harus melimpah ke kelompok berikutnya. Sebelumnya
    // tiap kelompok dipotong dua angka begitu saja, sehingga mengetik
    // "215059" berhenti di "21:50" — dua angka terakhir hilang tanpa jejak.
    const parts = s.replace(/[^\d.:]/g, '').split(/[.:]/);
    const hLen = Math.min(2, (parts[0] || '').length) || 1;
    const angka = parts.join('').slice(0, 6);

    const h = angka.slice(0, hLen);
    const sisa = angka.slice(hLen);
    const mi = sisa.slice(0, 2);
    const sec = sisa.slice(2, 4);

    return h +
      (mi || parts.length > 1 ? ':' + mi : '') +
      (sec ? ':' + sec : '');
  }

  const d = s.replace(/\D/g, '').slice(0, 6);
  if (d.length <= 2) return d;

  // Dua digit pertama hanya bisa jadi jam kalau nilainya masuk akal.
  const hLen = +d.slice(0, 2) <= 23 ? 2 : 1;
  const h = d.slice(0, hLen);
  const rest = d.slice(hLen);
  const mi = rest.slice(0, 2);
  const sec = rest.slice(2, 4);
  return h + ':' + mi + (sec ? ':' + sec : '');
}

/** Terapkan mask tanpa membuat kursor melompat ke ujung saat menyunting di tengah. */
export function applyMask(el) {
  const digitsBefore = el.value.slice(0, el.selectionStart ?? el.value.length)
    .replace(/\D/g, '').length;
  const masked = maskClock(el.value);
  if (masked === el.value) return;

  el.value = masked;

  let seen = 0;
  let pos = masked.length;
  if (digitsBefore === 0) {
    pos = 0;
  } else {
    for (let i = 0; i < masked.length; i++) {
      if (/\d/.test(masked[i])) seen++;
      if (seen === digitsBefore) { pos = i + 1; break; }
    }
  }
  try { el.setSelectionRange(pos, pos); } catch { /* input bisa belum fokus */ }
}
