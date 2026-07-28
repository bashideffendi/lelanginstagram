/**
 * Kerangka pembanding tampilan.
 *
 * Ketiga versi memakai berkas ini, jadi angkanya persis sama dan yang dinilai
 * murni tampilannya. Semua perhitungan sudah selesai di sini — berkas versi
 * hanya menyusun tata letak, tidak boleh menghitung ulang apa pun.
 */
import { parseDump } from '../js/dump.js';
import { analyze, fmtRupiah } from '../js/analysis.js';
import { browserTz, fmtTime, fmtDate, fmtDateTime, fmtDuration, tzOffsetLabel } from '../js/time.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Alamat hanya boleh http/https — esc() menutup pelarian atribut, bukan skema. */
export const safeUrl = (u) => {
  try {
    const p = new URL(String(u), location.href);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : null;
  } catch {
    return null;
  }
};

const TZ_SHORT = {
  'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB',
  'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT', UTC: 'UTC'
};

const TAG_LABEL = {
  'lewat-cutoff': 'telat',
  'detik-akhir': 'detik akhir',
  'detik-kembar': 'detik sama',
  'bid-turun': 'nilai turun',
  'bid-sama': 'nilai sama',
  beruntun: 'beruntun'
};

/** Tebak jam tutup dari caption, sama seperti aplikasi utama. */
function guessCutoff(caption, comments, tz) {
  if (!caption || !comments.length) return null;
  const re = /(?<!\d)([01]?\d|2[0-3])[.:]([0-5]\d)(?!\d)/g;
  const found = [];
  let m;
  while ((m = re.exec(caption)) !== null) found.push({ h: +m[1], mi: +m[2], at: m.index });
  if (!found.length) return null;

  const kw = /(clos\w*|tutup|\bcd\b|\bco\b|berakhir|selesai)/gi;
  let pick = found[found.length - 1];
  let k;
  while ((k = kw.exec(caption)) !== null) {
    const near = found.find((f) => f.at > k.index && f.at - k.index < 40);
    if (near) { pick = near; break; }
  }

  const last = Math.max(...comments.map((c) => c.created_at));
  const [d, mo, y] = fmtDate(last, tz).split('/').map(Number);
  const guess = Date.UTC(y, mo - 1, d, pick.h, pick.mi, 0) / 1000;
  // Koreksi offset dua lintasan, sama seperti wallTimeToEpoch.
  const off = (e) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(e * 1000)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) / 1000 - e;
  };
  let epoch = guess - off(guess);
  const o2 = off(epoch);
  if (o2 !== off(guess)) epoch = guess - o2;
  return epoch;
}

/**
 * Susun seluruh angka dan teks yang dibutuhkan tampilan.
 * Berkas versi cukup membaca hasilnya.
 */
export async function buildModel(tz = browserTz()) {
  const zone = TZ_SHORT[tz] ? tz : 'Asia/Jakarta';
  const raw = await (await fetch('../contoh/lelang-2.json')).json();
  const dump = parseDump(raw, 'contoh');
  const cutoff = guessCutoff(dump.source?.caption, dump.comments, zone);
  const { rows, accounts, summary } = analyze(dump.comments, {
    cutoffEpoch: cutoff, graceSec: 60, includeReplies: true
  });

  const short = TZ_SHORT[zone] || tzOffsetLabel(summary.first, zone);
  const w = summary.winner;

  const findings = [];
  if (summary.lateBids > 0) {
    const worst = Math.max(...rows
      .filter((r) => r.flags.includes('lewat-cutoff') && r.bid != null).map((r) => r.late));
    findings.push({
      tone: 'bad',
      text: `${summary.lateBids} tawaran masuk setelah lelang ditutup`,
      sub: `terparah lewat ${fmtDuration(worst)}`
    });
  }
  if (summary.tieGroups > 0) {
    findings.push({
      tone: 'warn',
      text: `${summary.tieRows} tawaran jatuh pada detik yang sama persis`,
      sub: 'urutan diambil dari nomor komentar Instagram'
    });
  }
  if (summary.bidDown > 0) {
    findings.push({
      tone: 'warn',
      text: `${summary.bidDown} tawaran nilainya lebih rendah dari tawaran tertinggi saat itu`,
      sub: ''
    });
  }
  if (!findings.length) {
    findings.push({ tone: 'good', text: 'Tidak ditemukan kejanggalan', sub: '' });
  }

  return {
    tz: zone,
    tzShort: short,

    source: {
      owner: dump.source?.owner_username || null,
      url: dump.source?.url || null,
      caption: dump.source?.caption || null,
      pulledAt: dump.meta?.extracted_at ? fmtDateTime(dump.meta.extracted_at, zone) : null
    },

    winner: w ? {
      username: w.username,
      amount: w.bid != null ? 'Rp' + fmtRupiah(w.bid) : '—',
      quote: w.text,
      time: fmtTime(w.created_at, zone),
      date: fmtDate(w.created_at, zone),
      dateLong: fmtDateTime(w.created_at, zone),
      epoch: w.created_at,
      pk: w.pk,
      rel: cutoff != null && w.created_at <= cutoff
        ? `${fmtDuration(cutoff - w.created_at)} sebelum tutup` : ''
    } : null,

    findings,

    stats: [
      { n: summary.lateBids, k: 'Tawaran telat', tone: summary.lateBids ? 'bad' : 'off' },
      { n: summary.snipe, k: 'Detik terakhir', tone: summary.snipe ? 'warn' : 'off' },
      { n: summary.tieRows, k: 'Detik kembar', tone: summary.tieRows ? 'warn' : 'off' },
      { n: summary.bidDown, k: 'Nilai turun', tone: summary.bidDown ? 'bad' : 'off' },
      { n: summary.users, k: 'Peserta', tone: 'on' },
      { n: fmtDuration(summary.span), k: 'Lama lelang', tone: 'on' }
    ],

    meta: {
      total: summary.total,
      users: summary.users,
      cutoffTime: cutoff != null ? fmtTime(cutoff, zone) : null,
      cutoffDate: cutoff != null ? fmtDate(cutoff, zone) : null,
      first: fmtTime(summary.first, zone),
      last: fmtTime(summary.last, zone),
      span: fmtDuration(summary.span)
    },

    rows: rows.map((r) => ({
      seq: r.seq,
      time: fmtTime(r.created_at, zone),
      date: fmtDate(r.created_at, zone),
      epoch: r.created_at,
      gap: r.gap != null ? fmtDuration(r.gap) : '',
      user: r.username || '—',
      isReply: r.is_reply,
      amount: r.bid != null ? 'Rp' + fmtRupiah(r.bid) : '',
      text: r.text,
      isWinner: !!(w && r.pk === w.pk),
      isLate: r.flags.includes('lewat-cutoff'),
      isSnipe: r.flags.includes('detik-akhir'),
      tags: r.flags.map((f) => ({ key: f, label: TAG_LABEL[f] || f }))
    })),

    accounts: accounts.map((a) => ({
      user: a.username,
      count: a.count,
      first: fmtTime(a.first, zone),
      last: fmtTime(a.last, zone),
      max: a.maxBid != null ? 'Rp' + fmtRupiah(a.maxBid) : '',
      late: a.lateBidCount,
      lateEntrant: a.lateEntrant
    }))
  };
}

/** Bilah pemilih versi, sama di ketiga halaman. */
export function mountSwitcher(active) {
  const bar = document.createElement('div');
  bar.id = 'vswitch';
  bar.innerHTML =
    '<span>Bandingkan tampilan:</span>' +
    // Tanpa akhiran .html — Vercel mengalihkannya, dan pengalihan tiap klik
    // membuat perbandingan terasa lambat.
    [['dokumen', 'Dokumen bukti'], ['rapat', 'Satu layar rapat'], ['lega', 'Lega & tenang']]
      .map(([id, label]) =>
        `<a href="${id}"${id === active ? ' class="on"' : ''}>${label}</a>`).join('') +
    '<span class="sp"></span><a href="../" class="alt">Tampilan sekarang</a>';
  document.body.appendChild(bar);
}
