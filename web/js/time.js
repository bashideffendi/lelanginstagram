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
