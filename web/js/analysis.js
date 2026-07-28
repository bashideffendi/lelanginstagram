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

const UNIT_MULT = {
  jt: 1e6, juta: 1e6, jeti: 1e6, mio: 1e6,
  rb: 1e3, ribu: 1e3, k: 1e3
};

/** Di atas ini pasti bukan tawaran — biasanya nomor telepon atau nomor rekening. */
const BATAS_WAJAR = 1e10;

/** Kata yang biasanya mendahului angka tawaran. */
const KATA_TAWAR = /\b(bid|ob|nawar|menawar|tawar|up|naik|gas|ambil|angkat)\b/gi;

/**
 * Calon nilai: awalan Rp opsional, angka, satuan opsional.
 *
 * Penjaga di kiri dan kanan mencegah angka di dalam kata ikut terambil —
 * tanpa itu "SKX007K" terbaca sebagai tawaran Rp7.000, dan di lelang jam
 * tangan kode model seperti itu muncul terus-menerus.
 */
const CALON = new RegExp(
  '(?<![A-Za-z0-9])' +
  '(rp\\.?\\s*)?' +
  '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?' +     // 1.500.000 atau 1.500.000,00
  '|\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?' +     // 1,500,000
  '|\\d+(?:[.,]\\d+)?)' +                        // 1,5 atau 2.30 atau 500
  '\\s*(jt|juta|jeti|mio|rb|ribu|k)?' +
  '(?![A-Za-z0-9])',
  'gi'
);

/** Ubah tulisan angka jadi bilangan, dengan aturan pemisah Indonesia. */
function toNumber(raw, adaSatuan) {
  const s = String(raw).trim();

  // Berpemisah ribuan, mungkin berekor sen: 1.500.000 atau 1.500.000,00
  const grup = s.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/);
  if (grup) return +grup[1].replace(/[.,]/g, '');

  // Desimal: 1,5 atau 2.30 — hanya masuk akal kalau ada satuan di belakangnya.
  const des = s.match(/^(\d+)[.,](\d{1,2})$/);
  if (des) return adaSatuan ? +(des[1] + '.' + des[2]) : +des[1] + +des[2] / Math.pow(10, des[2].length);

  return +s.replace(/[.,]/g, '');
}

/**
 * Buang jam dari teks supaya tidak terbaca sebagai angka.
 *
 * Hanya bentuk yang benar-benar jam: berpemisah titik dua, atau berpemisah
 * titik tetapi berdampingan dengan kata waktu. Membuang semua "2.30" secara
 * membabi buta ikut menelan tawaran "2.30 jt".
 */
function buangJam(s) {
  return s
    .replace(/(?<![A-Za-z0-9])\d{1,2}:\d{2}(?::\d{2})?(?![A-Za-z0-9])/g, ' ')
    .replace(/\b(?:jam|pukul|tutup|closed?|cd|co|berakhir)\s*\d{1,2}[.:]\d{2}\b/gi, ' ')
    .replace(/\b\d{1,2}[.:]\d{2}\s*(?:wib|wita|wit)\b/gi, ' ');
}

/**
 * Tebak nilai tawaran dari teks komentar.
 *
 * Mengembalikan { value, confidence, matched }; value null kalau tidak ada.
 * confidence: 'high' (ada satuan atau awalan Rp), 'medium' (angka berpemisah
 * atau berdigit banyak), 'low' (angka telanjang yang bisa saja bukan tawaran).
 */
export function parseBid(text) {
  const kosong = { value: null, confidence: null, matched: null };
  if (!text) return kosong;

  const clean = buangJam(
    String(text).replace(/@[\w.]+/g, ' ').replace(/#[\w]+/g, ' ')
  );

  // Posisi kata tawar, dipakai memilih angka mana yang dimaksud.
  const posKata = [];
  KATA_TAWAR.lastIndex = 0;
  let k;
  while ((k = KATA_TAWAR.exec(clean)) !== null) posKata.push(k.index + k[0].length);

  const calon = [];
  CALON.lastIndex = 0;
  let m;
  while ((m = CALON.exec(clean)) !== null) {
    const [full, rp, angka, satuan] = m;
    const unit = satuan ? satuan.toLowerCase() : null;
    const nilai = toNumber(angka, !!unit) * (unit ? UNIT_MULT[unit] : 1);
    if (!Number.isFinite(nilai) || nilai <= 0 || nilai > BATAS_WAJAR) continue;

    const digit = angka.replace(/\D/g, '').length;
    // Deretan angka panjang tanpa satuan dan tanpa Rp hampir pasti nomor telepon.
    if (!unit && !rp && digit >= 10) continue;

    const kuat = !!unit || !!rp;
    calon.push({
      value: nilai,
      matched: full.trim(),
      kuat,
      confidence: kuat ? 'high'
        : (/[.,]/.test(angka) || digit >= 4) ? 'medium' : 'low',
      dekatKata: posKata.some((p) => m.index >= p && m.index - p <= 15)
    });
  }

  if (!calon.length) return kosong;

  // Yang bersatuan atau ber-Rp paling dipercaya; di antaranya ambil yang terbesar.
  const kuat = calon.filter((c) => c.kuat);
  if (kuat.length) return pilihTerbesar(kuat);

  // Kalau ada yang menempel pada kata seperti "bid" atau "up", itu yang dimaksud.
  const dekat = calon.filter((c) => c.dekatKata);
  if (dekat.length) return pilihTerbesar(dekat);

  // Sisanya: satu angka jelas dipakai; beberapa angka telanjang meragukan,
  // jadi ambil yang terakhir disebut dan turunkan tingkat keyakinannya.
  if (calon.length === 1) return bersih(calon[0]);
  return bersih({ ...calon[calon.length - 1], confidence: 'low' });
}

function pilihTerbesar(list) {
  return bersih(list.reduce((a, b) => (b.value > a.value ? b : a)));
}

function bersih(c) {
  return { value: c.value, confidence: c.confidence, matched: c.matched };
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
    // Jeda nol detik ikut dihitung. Tanpa itu, akun yang menembakkan tiga
    // tawaran dalam satu detik justru tampak paling santai.
    if (a.count > 1) a.gaps.push(Math.max(0, r.created_at - a.last));
    if (r.created_at > a.last) a.last = r.created_at;
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
