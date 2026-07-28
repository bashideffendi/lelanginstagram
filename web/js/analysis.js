/**
 * Analisis urutan bid.
 *
 * Catatan penting: Instagram hanya memberi presisi DETIK.
 * Dua bid pada detik yang sama tidak bisa diurutkan dari waktunya.
 * Tie-break memakai comment ID (pk) — ID Instagram naik monoton, jadi
 * pk lebih kecil = dibuat lebih dulu.
 */

/** Urutan kronologis: waktu dulu, lalu pk sebagai pemecah seri. */
export function chronoCompare(a, b) {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  try {
    const pa = BigInt(a.pk), pb = BigInt(b.pk);
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  } catch {
    return String(a.pk).localeCompare(String(b.pk));
  }
}

// ------------------------------------------------------------ parsing nilai bid

const UNIT_PATTERNS = [
  [/(\d+(?:[.,]\d+)?)\s*(?:jt|juta|jeti|mio)\b/gi, 1e6],
  [/(\d+(?:[.,]\d+)?)\s*(?:rb|ribu|k)\b/gi, 1e3]
];

function toNumber(raw) {
  const s = String(raw).trim();
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return +s.replace(/[.,]/g, '');   // 1.500.000
  if (/^\d+[.,]\d{1,2}$/.test(s)) return +s.replace(',', '.');           // 1,5
  return +s.replace(/[.,]/g, '');
}

/**
 * Tebak nilai bid dari teks komentar.
 * Mengembalikan { value, confidence, matched } — value null kalau tidak ketemu.
 * confidence: 'high' (ada satuan jt/rb/k), 'medium' (angka besar/berpemisah), 'low' (angka telanjang).
 */
export function parseBid(text) {
  if (!text) return { value: null, confidence: null, matched: null };

  // Buang mention, hashtag, dan jam (21:30) supaya tidak terbaca sebagai angka.
  const clean = String(text)
    .replace(/@[\w.]+/g, ' ')
    .replace(/#[\w]+/g, ' ')
    .replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ');

  let best = null;

  for (const [re, mult] of UNIT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const v = toNumber(m[1]) * mult;
      if (Number.isFinite(v) && v > 0 && (!best || v > best.value)) {
        best = { value: v, confidence: 'high', matched: m[0].trim() };
      }
    }
  }
  if (best) return best;

  // Hanya angka yang berdiri sendiri. Tanpa ini, "SKX007" terbaca sebagai
  // tawaran bernilai 7 — kesalahan yang berbahaya di alat yang dipakai menuduh.
  const tokens = clean.match(/(?<![A-Za-z0-9])\d[\d.,]*(?![A-Za-z0-9])/g) || [];
  for (const t of tokens) {
    const v = toNumber(t);
    if (!Number.isFinite(v) || v <= 0) continue;
    const digits = t.replace(/[.,]/g, '').length;
    const conf = /[.,]/.test(t) || digits >= 4 ? 'medium' : 'low';
    if (!best || v > best.value) best = { value: v, confidence: conf, matched: t };
  }
  return best || { value: null, confidence: null, matched: null };
}

export function fmtRupiah(v) {
  if (v == null) return '';
  return v.toLocaleString('id-ID');
}

// ------------------------------------------------------------ analisis utama

/**
 * @param {Array} comments  komentar hasil normalisasi dari dump
 * @param {Object} opts
 *   cutoffEpoch  epoch tutup lelang, atau null
 *   graceSec     jendela "detik-detik akhir" sebelum cutoff (default 60)
 *   includeReplies  ikutkan balasan bersarang
 */
export function analyze(comments, opts = {}) {
  const { cutoffEpoch = null, graceSec = 60, includeReplies = true } = opts;

  const rows = comments
    .filter((c) => (includeReplies ? true : !c.is_reply))
    .slice()
    .sort(chronoCompare)
    .map((c, i) => ({ ...c, seq: i + 1 }));

  // Kelompok detik kembar — bid yang jamnya identik.
  const bySecond = new Map();
  for (const r of rows) {
    if (!bySecond.has(r.created_at)) bySecond.set(r.created_at, []);
    bySecond.get(r.created_at).push(r);
  }

  let prevHighBid = null;
  let prev = null;

  for (const r of rows) {
    r.gap = prev ? r.created_at - prev.created_at : null;
    r.sinceStart = rows.length ? r.created_at - rows[0].created_at : 0;

    const group = bySecond.get(r.created_at);
    r.tie = group.length > 1;
    r.tieSize = group.length;
    r.tieIndex = group.indexOf(r) + 1;

    const bid = parseBid(r.text);
    r.bid = bid.value;
    r.bidConfidence = bid.confidence;
    r.bidMatched = bid.matched;

    r.flags = [];

    if (cutoffEpoch != null) {
      if (r.created_at > cutoffEpoch) {
        r.late = r.created_at - cutoffEpoch;
        r.flags.push('lewat-cutoff');
      } else if (cutoffEpoch - r.created_at <= graceSec) {
        r.snipe = cutoffEpoch - r.created_at;
        r.flags.push('detik-akhir');
      }
    }

    if (r.tie) r.flags.push('detik-kembar');

    if (r.bid != null) {
      if (prevHighBid != null) {
        r.increment = r.bid - prevHighBid;
        if (r.bid < prevHighBid) r.flags.push('bid-turun');
        else if (r.bid === prevHighBid) r.flags.push('bid-sama');
      }
      if (prevHighBid == null || r.bid > prevHighBid) prevHighBid = r.bid;
      r.runningHigh = prevHighBid;
    } else {
      r.runningHigh = prevHighBid;
    }

    prev = r;
  }

  // Bid berturut-turut dari akun yang sama dalam waktu dekat.
  const lastByUser = new Map();
  for (const r of rows) {
    const u = r.username || '(tanpa nama)';
    const last = lastByUser.get(u);
    if (last != null && r.created_at - last <= 5) r.flags.push('beruntun');
    lastByUser.set(u, r.created_at);
  }

  return { rows, accounts: perAccount(rows, cutoffEpoch), summary: summarize(rows, cutoffEpoch) };
}

function perAccount(rows, cutoffEpoch) {
  const map = new Map();

  for (const r of rows) {
    const u = r.username || '(tanpa nama)';
    let a = map.get(u);
    if (!a) {
      a = {
        username: u,
        user_pk: r.user_pk,
        full_name: r.full_name,
        count: 0,
        replies: 0,
        first: r.created_at,
        last: r.created_at,
        maxBid: null,
        lateCount: 0,
        lateBidCount: 0,
        snipeCount: 0,
        downCount: 0,
        gaps: []
      };
      map.set(u, a);
    }
    a.count++;
    if (r.is_reply) a.replies++;
    a.first = Math.min(a.first, r.created_at);
    if (r.created_at > a.last) {
      a.gaps.push(r.created_at - a.last);
      a.last = r.created_at;
    }
    if (r.bid != null && (a.maxBid == null || r.bid > a.maxBid)) a.maxBid = r.bid;
    if (r.flags.includes('lewat-cutoff')) {
      a.lateCount++;
      if (r.bid != null) a.lateBidCount++;
    }
    if (r.flags.includes('detik-akhir')) a.snipeCount++;
    if (r.flags.includes('bid-turun')) a.downCount++;
  }

  const list = [...map.values()];
  const lastBid = rows.length ? rows[rows.length - 1].created_at : null;

  for (const a of list) {
    a.span = a.last - a.first;
    a.avgGap = a.gaps.length
      ? Math.round(a.gaps.reduce((x, y) => x + y, 0) / a.gaps.length)
      : null;
    delete a.gaps;
    // Akun yang baru muncul di 10% waktu terakhir lelang.
    if (cutoffEpoch != null && rows.length) {
      const start = rows[0].created_at;
      const end = cutoffEpoch;
      a.lateEntrant = end > start && a.first >= start + (end - start) * 0.9;
    } else if (lastBid != null && rows.length) {
      const start = rows[0].created_at;
      a.lateEntrant = lastBid > start && a.first >= start + (lastBid - start) * 0.9;
    }
  }

  list.sort((x, y) => y.count - x.count || x.first - y.first);
  return list;
}

function summarize(rows, cutoffEpoch) {
  const users = new Set(rows.map((r) => r.username || '(tanpa nama)'));
  const withBid = rows.filter((r) => r.bid != null);
  const tieGroups = new Set(rows.filter((r) => r.tie).map((r) => r.created_at));

  return {
    total: rows.length,
    topLevel: rows.filter((r) => !r.is_reply).length,
    replies: rows.filter((r) => r.is_reply).length,
    users: users.size,
    first: rows.length ? rows[0].created_at : null,
    last: rows.length ? rows[rows.length - 1].created_at : null,
    span: rows.length ? rows[rows.length - 1].created_at - rows[0].created_at : 0,
    late: rows.filter((r) => r.flags.includes('lewat-cutoff')).length,
    // Yang menentukan sengketa adalah bid yang lewat cutoff, bukan obrolan biasa.
    lateBids: rows.filter((r) => r.flags.includes('lewat-cutoff') && r.bid != null).length,
    snipe: rows.filter((r) => r.flags.includes('detik-akhir')).length,
    tieRows: rows.filter((r) => r.tie).length,
    tieGroups: tieGroups.size,
    bidDown: rows.filter((r) => r.flags.includes('bid-turun')).length,
    bidSame: rows.filter((r) => r.flags.includes('bid-sama')).length,
    parsedBids: withBid.length,
    highBid: withBid.length ? Math.max(...withBid.map((r) => r.bid)) : null,
    cutoff: cutoffEpoch,
    // Bid sah tertinggi = bid terbesar yang masuk sebelum cutoff.
    winner: (() => {
      const eligible = rows.filter(
        (r) => r.bid != null && (cutoffEpoch == null || r.created_at <= cutoffEpoch)
      );
      if (!eligible.length) return null;
      const max = Math.max(...eligible.map((r) => r.bid));
      // Kalau nilai sama, yang duluan menang.
      return eligible.filter((r) => r.bid === max).sort(chronoCompare)[0];
    })()
  };
}
