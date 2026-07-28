import { parseDump, readFileAsDump } from './dump.js';
import { analyze, chronoCompare, fmtRupiah } from './analysis.js';
import { diffDumps } from './diff.js';
import {
  browserTz, tzOptions, tzOffsetLabel, fmtDateTime, fmtTime, fmtDate,
  fmtDuration, datetimeLocalToEpoch, epochToDatetimeLocal, wallTimeToEpoch
} from './time.js';
import {
  download, sha256Hex, commentsCsv, accountsCsv, diffCsv, summaryText
} from './export.js';
import {
  pingExtension, extractViaExtension, looksLikePostUrl
} from './ext.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  dumps: [], primary: null, diff: null, isDemo: false,
  tz: browserTz(), cutoff: null, grace: 60,
  query: '', includeReplies: true, onlyFlagged: false, tech: false,
  result: null, hash: null, guessedCutoff: false,
  sort: { chrono: { key: 'seq', dir: 1 }, accounts: { key: 'count', dir: -1 } }
};

// ================================================================ bookmarklet

async function initBookmarklet() {
  try {
    const { BOOKMARKLET } = await import('../bookmarklet.js');
    $('bm').href = BOOKMARKLET;
  } catch {
    $('bm').removeAttribute('href');
    $('bm').style.opacity = '.5';
    $('bm').style.cursor = 'not-allowed';
    $('bmnote').innerHTML =
      'Tombol belum tersedia — jalankan <code>node bookmarklet/build.mjs</code> sekali untuk membuatnya.';
  }
  $('bm').addEventListener('click', (e) => {
    e.preventDefault();
    $('bmnote').textContent = 'Tombol ini harus diseret ke bar bookmark, bukan diklik di sini.';
    $('bmnote').style.color = 'var(--danger)';
  });
}

// ================================================================ kotak paste

let extVersion = null;

function setStat(text, cls = '') {
  const el = $('paststat');
  el.className = 'pastestat ' + cls;
  el.innerHTML = text;
}

function showExtInfo() {
  $('extinfo').classList.remove('hidden');
  $('extinfo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function initPaste() {
  setStat('Memeriksa apakah extension Ketok terpasang&hellip;');
  extVersion = await pingExtension();

  if (extVersion) {
    setStat(`Extension aktif (v${esc(extVersion)}) — tempel link postingannya, lalu tekan Ambil komentar.`, 'ready');
  } else {
    setStat(
      'Extension Ketok belum terpasang, jadi kotak ini belum bisa dipakai. ' +
      '<button class="linkbtn" id="whyext">Kenapa perlu extension?</button>', 'warn');
    $('whyext').onclick = showExtInfo;
  }
}

async function runPaste() {
  const url = $('iglink').value.trim();

  if (!url) { setStat('Tempel dulu link postingannya.', 'bad'); return; }
  if (!looksLikePostUrl(url)) {
    setStat('Itu bukan link postingan. Bentuknya harus <code>instagram.com/p/XXXX/</code> — ' +
      'buka postingannya dulu, lalu salin alamat dari bilah alamat browser.', 'bad');
    return;
  }
  if (!extVersion) {
    extVersion = await pingExtension();
    if (!extVersion) {
      setStat('Extension Ketok belum terpasang. Petunjuk pemasangannya ada di bawah.', 'bad');
      showExtInfo();
      return;
    }
  }

  const btn = $('go');
  btn.disabled = true;
  $('pasteprog').classList.remove('hidden');
  const fill = $('pasteprog').querySelector('i');
  fill.style.width = '0%';

  try {
    const dump = await extractViaExtension(url, (p) => {
      if (p.stage === 'info') setStat('Mengambil keterangan postingan&hellip;');
      else if (p.stage === 'comments') {
        setStat(`Menarik komentar&hellip; ${p.count} terkumpul` + (p.total ? ` dari sekitar ${p.total}` : ''));
        fill.style.width = (p.total ? Math.min(95, (p.count / p.total) * 100) : Math.min(90, (p.page || 0) * 8)) + '%';
      } else if (p.stage === 'replies') {
        setStat(`Mengambil balasan&hellip; utas ${p.page} dari ${p.total}`);
      }
    });
    fill.style.width = '100%';
    activate([parseDump(dump, 'lewat extension')]);
  } catch (e) {
    let hint = '';
    if (e.status === 401 || e.status === 403) hint = ' Buka instagram.com di tab lain dan pastikan kamu sudah login.';
    else if (e.status === 429) hint = ' Instagram sedang membatasi permintaan. Tunggu beberapa menit.';
    else if (e.status === 404) hint = ' Postingannya mungkin sudah dihapus, atau akunnya privat.';
    setStat('Gagal: ' + esc(e.message) + hint, 'bad');
  } finally {
    btn.disabled = false;
    setTimeout(() => $('pasteprog').classList.add('hidden'), 800);
  }
}

// ================================================================ timezone

function initTz() {
  const sel = $('tz');
  const { pinned, rest } = tzOptions();
  const g1 = document.createElement('optgroup');
  g1.label = 'Sering dipakai';
  for (const [id, label] of pinned) {
    const o = document.createElement('option');
    o.value = id; o.textContent = label; g1.appendChild(o);
  }
  sel.appendChild(g1);
  const g2 = document.createElement('optgroup');
  g2.label = 'Semua zona';
  for (const id of rest) {
    const o = document.createElement('option');
    o.value = id; o.textContent = id.replace(/_/g, ' '); g2.appendChild(o);
  }
  sel.appendChild(g2);
  const opts = [...sel.options].map((o) => o.value);
  sel.value = opts.includes(state.tz) ? state.tz : 'Asia/Jakarta';
  state.tz = sel.value;
}

function tzNote() {
  const ref = state.result?.summary.first ?? Math.floor(Date.now() / 1000);
  const auto = browserTz();
  $('tznote').textContent = state.tz === auto
    ? `Mengikuti jam laptop kamu (${tzOffsetLabel(ref, state.tz)}).`
    : `${tzOffsetLabel(ref, state.tz)}. Jam laptop kamu: ${auto}.`;
}

// ================================================================ tebak jam tutup

/**
 * Cari jam tutup di caption post — penjual hampir selalu menuliskannya
 * ("CLOSED 21.00 WIB"). Hanya tebakan; ditandai jelas ke pengguna.
 */
function guessCutoff(caption, comments, tz) {
  if (!caption || !comments.length) return null;
  const re = /(?<!\d)([01]?\d|2[0-3])[.:]([0-5]\d)(?!\d)/g;
  const found = [];
  let m;
  while ((m = re.exec(caption)) !== null) {
    found.push({ h: +m[1], mi: +m[2], at: m.index });
  }
  if (!found.length) return null;

  // Utamakan angka jam yang muncul dekat kata penutupan.
  const kw = /(clos\w*|tutup|\bcd\b|\bco\b|berakhir|selesai)/gi;
  let pick = found[found.length - 1];
  let k;
  while ((k = kw.exec(caption)) !== null) {
    const near = found.find((f) => f.at > k.index && f.at - k.index < 40);
    if (near) { pick = near; break; }
  }

  // Pakai tanggal dari komentar terakhir, karena di situlah lelang berakhir.
  const last = Math.max(...comments.map((c) => c.created_at));
  const [d, mo, y] = fmtDate(last, tz).split('/').map(Number);
  const epoch = wallTimeToEpoch(y, mo, d, pick.h, pick.mi, 0, tz);

  // Buang tebakan yang jelas di luar rentang komentar.
  const first = Math.min(...comments.map((c) => c.created_at));
  if (epoch < first || epoch > last + 86400) return null;
  return { epoch, label: `${String(pick.h).padStart(2, '0')}.${String(pick.mi).padStart(2, '0')}` };
}

// ================================================================ muat data

function showError(msg) {
  $('loaderr').textContent = msg;
  $('loaderr').classList.remove('hidden');
}

async function loadFiles(files) {
  $('loaderr').classList.add('hidden');
  try {
    const parsed = [];
    for (const f of [...files].slice(0, 2)) parsed.push(await readFileAsDump(f));
    activate(parsed);
  } catch (e) {
    showError(e.message);
  }
}

async function loadDemo() {
  $('loaderr').classList.add('hidden');
  try {
    const parsed = [];
    for (const n of ['contoh/lelang-1.json', 'contoh/lelang-2.json']) {
      const r = await fetch(n);
      if (!r.ok) throw new Error(`tidak menemukan ${n}`);
      parsed.push(parseDump(await r.json(), n));
    }
    state.isDemo = true;
    activate(parsed);
  } catch (e) {
    showError('Gagal memuat data contoh: ' + e.message +
      '. Jalankan `node samples/generate.mjs` sekali untuk membuatnya.');
  }
}

function activate(dumps) {
  state.dumps = dumps;
  const sorted = dumps.slice().sort(
    (a, b) => (a.meta?.extracted_at ?? 0) - (b.meta?.extracted_at ?? 0));
  state.primary = sorted[sorted.length - 1];
  state.diff = dumps.length === 2 ? diffDumps(sorted[0], sorted[1]) : null;

  $('landing').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('reset').classList.remove('hidden');
  $('tab-diff').classList.toggle('hidden', !state.diff);

  $('democue').innerHTML = state.isDemo
    ? '<div class="democue"><b>Ini lelang contoh, bukan data asli.</b> ' +
      'Semua angkanya dibuat-buat supaya kamu bisa melihat cara kerja Ketok. ' +
      'Klik "Muat data lain" di kanan atas kalau sudah punya hasil tarikan sungguhan.</div>'
    : '';

  const g = guessCutoff(state.primary.source?.caption, state.primary.comments, state.tz);
  if (g) {
    $('cutoff').value = epochToDatetimeLocal(g.epoch, state.tz);
    state.guessedCutoff = g.label;
  } else {
    const last = Math.max(...state.primary.comments.map((c) => c.created_at));
    $('cutoff').placeholder = epochToDatetimeLocal(last, state.tz);
  }

  computeHash();
  render();
  window.scrollTo(0, 0);
}

async function computeHash() {
  try { state.hash = await sha256Hex(JSON.stringify(state.primary.original)); }
  catch { state.hash = null; }
  $('hash').textContent = state.hash || 'tidak tersedia';
}

// ================================================================ render

function render() {
  state.cutoff = datetimeLocalToEpoch($('cutoff').value, state.tz);
  state.includeReplies = $('reps').checked;
  state.onlyFlagged = $('onlyflag').checked;
  state.tech = $('tech').checked;
  state.query = $('q').value.trim().toLowerCase();

  state.result = analyze(state.primary.comments, {
    cutoffEpoch: state.cutoff,
    graceSec: state.grace,
    includeReplies: state.includeReplies
  });

  tzNote();
  renderPost();
  renderVerdict();
  renderCards();
  renderChrono();
  renderAccounts();
  renderDiff();
  renderLegend();
  renderEvidence();
}

function renderPost() {
  const s = state.primary.source || {};
  const m = state.primary.meta || {};
  const bits = [];
  if (s.owner_username) bits.push(`Lelang oleh <b>@${esc(s.owner_username)}</b>`);
  if (s.url) bits.push(`<a href="${esc(s.url)}" target="_blank" rel="noopener">buka postingannya</a>`);
  if (m.extracted_at) bits.push(`Ditarik <b>${fmtDateTime(m.extracted_at, state.tz)}</b>`);
  if (s.reported_comment_count != null) {
    const gap = s.reported_comment_count - state.primary.comments.length;
    bits.push(gap > 0
      ? `Instagram menghitung <b>${s.reported_comment_count}</b> komentar, terambil <b>${state.primary.comments.length}</b> — selisih ${gap} kemungkinan sudah dihapus atau disaring`
      : `<b>${state.primary.comments.length}</b> komentar terambil`);
  }
  $('postcard').innerHTML = bits.join('<span class="soft">&nbsp;&middot;&nbsp;</span>') +
    (s.caption ? `<div class="cap">${esc(s.caption)}</div>` : '');
}

function renderVerdict() {
  const s = state.result.summary;
  const problems = [];

  if (s.cutoff != null && s.lateBids > 0) {
    problems.push(`<b>${s.lateBids} tawaran masuk setelah lelang ditutup.</b> ` +
      `Yang paling telat ${fmtDuration(Math.max(...state.result.rows
        .filter((r) => r.flags.includes('lewat-cutoff') && r.bid != null).map((r) => r.late)))} lewat.`);
  }
  if (state.diff && state.diff.deleted.length) {
    problems.push(`<b>${state.diff.deleted.length} komentar dihapus</b> di antara dua penarikan kamu. ` +
      `Lihat tab &ldquo;Yang dihapus&rdquo;.`);
  }
  if (s.tieGroups > 0) {
    problems.push(`${s.tieRows} tawaran jatuh pada detik yang sama persis — urutannya ` +
      `ditentukan lewat nomor komentar, bukan jam.`);
  }
  if (s.bidDown > 0) {
    problems.push(`${s.bidDown} tawaran nilainya lebih rendah dari tawaran tertinggi saat itu.`);
  }

  let html = '';
  if (s.cutoff == null) {
    html = '<div class="vbox clean" style="background:var(--info-soft);border-color:#cfe0fb">' +
      '<div class="vtitle" style="color:#1e40af">Isi jam tutup lelang dulu</div>' +
      '<p class="vhint">Tanpa jam tutup, Ketok belum bisa menilai siapa yang telat. ' +
      'Kotak <b>Jam lelang ditutup</b> ada tepat di bawah ini' +
      (state.guessedCutoff ? ' — sudah aku isikan dari caption, tinggal periksa.' : '.') +
      '</p></div>';
  } else if (problems.length) {
    html = '<div class="vbox bad"><div class="vtitle">Ada yang perlu dilihat</div>' +
      '<ul>' + problems.map((p) => `<li><span>${p}</span></li>`).join('') + '</ul></div>';
  } else {
    html = '<div class="vbox clean"><div class="vtitle">Tidak ditemukan kejanggalan</div>' +
      '<p class="vhint">Semua tawaran masuk sebelum jam tutup, tidak ada nilai yang turun, ' +
      'dan tidak ada dua tawaran di detik yang sama.</p></div>';
  }

  const w = s.winner;
  if (w) {
    html += '<div class="winnerbox">' +
      `<div class="wlabel">Tawaran tertinggi yang masuk${s.cutoff != null ? ' sebelum tutup' : ''}</div>` +
      `<div class="wname">@${esc(w.username || '—')}</div>` +
      `<div class="wamt">${w.bid != null ? 'Rp' + fmtRupiah(w.bid) : '—'}</div>` +
      `<div class="wmeta">${fmtDateTime(w.created_at, state.tz)}</div>` +
      '</div>';
  }
  if (state.guessedCutoff && state.cutoff != null) {
    html += `<p class="alert warn">Jam tutup <b>${esc(state.guessedCutoff)}</b> aku tebak dari caption ` +
      `postingannya. Periksa dan perbaiki kalau salah — semua tanda merah bergantung pada angka ini.</p>`;
  }
  $('verdict').innerHTML = html;
}

function statcard(k, v, s, cls = '') {
  return `<div class="statcard ${cls}"><div class="k">${k}</div><div class="v">${v}</div>` +
    (s ? `<div class="s">${s}</div>` : '') + '</div>';
}

function renderCards() {
  const s = state.result.summary;
  const html = [
    statcard('Tawaran telat', s.cutoff == null ? '—' : s.lateBids,
      s.cutoff == null ? 'isi jam tutup dulu'
        : `${s.late} komentar masuk setelah tutup, ${s.lateBids} di antaranya membawa angka`,
      s.cutoff != null && s.lateBids > 0 ? 'bad' : ''),
    statcard('Detik-detik akhir', s.cutoff == null ? '—' : s.snipe,
      `tawaran dalam ${state.grace} detik terakhir`,
      s.snipe > 0 ? 'warn' : ''),
    statcard('Detik yang sama', s.tieRows, `${s.tieGroups} detik berisi lebih dari satu tawaran`,
      s.tieRows > 0 ? 'warn' : ''),
    statcard('Nilai turun', s.bidDown, `${s.bidSame} tawaran mengulang nilai yang sama`,
      s.bidDown > 0 ? 'bad' : ''),
    statcard('Peserta', s.users, `${s.total} komentar total`),
    statcard('Lama lelang', fmtDuration(s.span),
      s.first != null ? `${fmtTime(s.first, state.tz)} sampai ${fmtTime(s.last, state.tz)}` : '')
  ];
  if (state.diff) {
    html.push(statcard('Dihapus', state.diff.deleted.length,
      'antara dua penarikan kamu',
      state.diff.deleted.length ? 'bad' : 'ok'));
  }
  $('cards').innerHTML = html.join('');
}

const TAGS = {
  'lewat-cutoff': ['late', (r) => `telat ${fmtDuration(r.late)}`,
    'Masuk setelah jam tutup yang kamu isi.'],
  'detik-akhir': ['snipe', (r) => `${fmtDuration(r.snipe)} sebelum tutup`,
    'Masuk di detik-detik terakhir sebelum tutup.'],
  'detik-kembar': ['tie', (r) => `detik sama ${r.tieIndex} dari ${r.tieSize}`,
    'Ada tawaran lain di detik yang sama persis. Urutan diambil dari nomor komentar.'],
  'bid-turun': ['down', () => 'nilai turun',
    'Angkanya lebih kecil dari tawaran tertinggi sebelumnya.'],
  'bid-sama': ['same', () => 'nilai sama',
    'Angkanya sama persis dengan tawaran tertinggi sebelumnya.'],
  beruntun: ['burst', () => 'beruntun',
    'Akun yang sama berkomentar lagi dalam 5 detik.']
};

function tags(r) {
  return r.flags.map((f) => {
    const t = TAGS[f];
    return t ? `<span class="tag ${t[0]}">${esc(t[1](r))}</span>` : '';
  }).join('');
}

function renderLegend() {
  $('legend').innerHTML = Object.entries(TAGS).map(([, [cls, , desc]]) =>
    `<div><span class="tag ${cls}">${cls === 'late' ? 'telat' : cls === 'snipe' ? 'detik akhir'
      : cls === 'tie' ? 'detik sama' : cls === 'down' ? 'nilai turun'
      : cls === 'same' ? 'nilai sama' : 'beruntun'}</span>${desc}</div>`).join('');
}

function visibleRows() {
  let rows = state.result.rows;
  if (state.onlyFlagged) rows = rows.filter((r) => r.flags.length);
  if (state.query) {
    const q = state.query;
    rows = rows.filter((r) =>
      (r.username || '').toLowerCase().includes(q) ||
      (r.text || '').toLowerCase().includes(q) || r.pk.includes(q));
  }
  const { key, dir } = state.sort.chrono;
  if (key !== 'seq') {
    rows = rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
    });
  } else if (dir === -1) {
    rows = rows.slice().sort((a, b) => chronoCompare(b, a));
  }
  return rows;
}

function sortHeader(cols, which) {
  const st = state.sort[which];
  return '<tr>' + cols.map(([key, label]) => {
    if (!key) return `<th class="nosort">${label}</th>`;
    const on = st.key === key;
    return `<th data-sort="${key}" data-which="${which}">${label}` +
      (on ? ` <span class="dir">${st.dir === 1 ? '▲' : '▼'}</span>` : '') + '</th>';
  }).join('') + '</tr>';
}

function renderChrono() {
  const rows = visibleRows();
  $('c-chrono').textContent = rows.length;

  const cols = [
    ['seq', 'Ke-'], ['created_at', 'Jam'], ['gap', 'Selisih'], ['username', 'Akun'],
    ['bid', 'Nilai'],
    ...(state.tech ? [['increment', 'Naik'], [null, 'Jam mentah']] : []),
    [null, 'Tanda'], [null, 'Komentar'],
    ...(state.tech ? [[null, 'Nomor komentar']] : [])
  ];
  const span = cols.length;
  $('tbl-chrono').tHead.innerHTML = sortHeader(cols, 'chrono');

  if (!rows.length) {
    $('tbl-chrono').tBodies[0].innerHTML =
      `<tr><td colspan="${span}" class="empty">Tidak ada komentar yang cocok dengan pencarian atau saringan kamu.</td></tr>`;
    return;
  }

  let prevDay = null;
  const out = [];
  for (const r of rows) {
    const day = fmtDate(r.created_at, state.tz);
    if (day !== prevDay) {
      out.push(`<tr class="daysep"><td colspan="${span}">${day}</td></tr>`);
      prevDay = day;
    }
    const cls = r.flags.includes('lewat-cutoff') ? 'r-late'
      : r.flags.includes('detik-akhir') ? 'r-snipe' : '';

    out.push(`<tr class="${cls}">` +
      `<td class="num soft">${r.seq}</td>` +
      `<td class="time">${fmtTime(r.created_at, state.tz)}</td>` +
      `<td class="num soft">${r.gap != null ? fmtDuration(r.gap) : '—'}</td>` +
      `<td class="acct">${esc(r.username || '—')}${r.is_reply ? ' <span class="soft">(balasan)</span>' : ''}</td>` +
      `<td class="amt">${r.bid != null ? 'Rp' + fmtRupiah(r.bid) : '<span class="soft">—</span>'}</td>` +
      (state.tech
        ? `<td class="num soft">${r.increment != null ? (r.increment > 0 ? '+' : '') + fmtRupiah(r.increment) : ''}</td>` +
          `<td class="mono soft">${r.created_at}</td>`
        : '') +
      `<td>${tags(r)}</td>` +
      `<td class="msg">${esc(r.text)}</td>` +
      (state.tech ? `<td class="mono soft">${esc(r.pk)}</td>` : '') +
      '</tr>');
  }
  $('tbl-chrono').tBodies[0].innerHTML = out.join('');
}

const ACC_COLS = [
  ['username', 'Akun'], ['count', 'Komentar'], ['first', 'Tawaran pertama'],
  ['last', 'Tawaran terakhir'], ['maxBid', 'Nilai tertinggi'],
  ['lateBidCount', 'Telat'], ['snipeCount', 'Detik akhir'], ['downCount', 'Nilai turun'],
  [null, 'Catatan']
];

function renderAccounts() {
  const { key, dir } = state.sort.accounts;
  const accs = state.result.accounts.slice().sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * dir;
  });
  $('c-accounts').textContent = accs.length;
  $('tbl-accounts').tHead.innerHTML = sortHeader(ACC_COLS, 'accounts');
  $('tbl-accounts').tBodies[0].innerHTML = accs.map((a) => {
    const notes = [];
    if (a.lateEntrant) notes.push('<span class="tag snipe">baru muncul di akhir</span>');
    if (a.count === 1) notes.push('<span class="tag same">sekali komentar</span>');
    if (a.lateBidCount) notes.push('<span class="tag late">menawar setelah tutup</span>');
    else if (a.lateCount) notes.push('<span class="tag same">bicara setelah tutup</span>');
    const cell = (n, color) =>
      `<td class="num" style="color:${n ? color : 'var(--muted)'}">${n || '—'}</td>`;
    return '<tr>' +
      `<td class="acct">${esc(a.username)}` +
      (a.full_name ? `<div class="soft" style="font-weight:400;font-size:13px">${esc(a.full_name)}</div>` : '') +
      '</td>' +
      `<td class="num">${a.count}${a.replies ? ` <span class="soft">(${a.replies} balasan)</span>` : ''}</td>` +
      `<td class="time">${fmtTime(a.first, state.tz)}</td>` +
      `<td class="time">${fmtTime(a.last, state.tz)}</td>` +
      `<td class="amt">${a.maxBid != null ? 'Rp' + fmtRupiah(a.maxBid) : '<span class="soft">—</span>'}</td>` +
      cell(a.lateBidCount, 'var(--danger)') +
      cell(a.snipeCount, 'var(--warn)') +
      cell(a.downCount, 'var(--danger)') +
      `<td>${notes.join('')}</td>` +
      '</tr>';
  }).join('');
}

function renderDiff() {
  if (!state.diff) { $('c-diff').textContent = '0'; return; }
  const d = state.diff;
  $('c-diff').textContent = d.deleted.length + d.added.length + d.changed.length;

  const info = [];
  if (!d.sameSource) {
    info.push('<p class="alert danger">Dua file ini berasal dari postingan yang berbeda, ' +
      'jadi perbandingannya tidak berarti apa-apa.</p>');
  }
  info.push('<p class="tabintro">' +
    `Membandingkan tarikan <b>${d.beforeAt ? fmtDateTime(d.beforeAt, state.tz) : 'lebih awal'}</b> ` +
    `(${d.beforeCount} komentar) dengan <b>${d.afterAt ? fmtDateTime(d.afterAt, state.tz) : 'lebih akhir'}</b> ` +
    `(${d.afterCount} komentar). Yang ada di tarikan pertama tapi hilang di tarikan kedua ` +
    'berarti dihapus di antara keduanya.</p>');
  $('diffinfo').innerHTML = info.join('');

  $('tbl-diff').tHead.innerHTML =
    '<tr><th class="nosort">Status</th><th class="nosort">Jam</th><th class="nosort">Akun</th>' +
    '<th class="nosort">Komentar</th></tr>';

  const row = (tag, c, extra = '') => '<tr>' +
    `<td>${tag}</td><td class="time">${fmtDateTime(c.created_at, state.tz)}</td>` +
    `<td class="acct">${esc(c.username || '—')}</td>` +
    `<td class="msg">${esc(c.text)}${extra}</td></tr>`;

  const body = [
    ...d.deleted.map((c) => row('<span class="tag del">dihapus</span>', c)),
    ...d.changed.map((ch) => row('<span class="tag snipe">diubah</span>', ch.before,
      `<div class="soft" style="font-size:13px;margin-top:4px">menjadi: ${esc(ch.after.text)}</div>`)),
    ...d.added.map((c) => row('<span class="tag new">baru</span>', c))
  ];
  $('tbl-diff').tBodies[0].innerHTML = body.length ? body.join('')
    : '<tr><td colspan="4" class="empty">Tidak ada bedanya. Tidak ada komentar yang dihapus di antara dua tarikan kamu.</td></tr>';
}

function renderEvidence() {
  $('sumtext').textContent = summaryText(
    state.result.summary, state.primary.source, state.tz, state.hash);
}

// ================================================================ ekspor

function baseName() {
  const s = state.primary.source || {};
  return `ketok_${s.shortcode || s.media_id || 'lelang'}`;
}

function copy(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = 'Tersalin';
    setTimeout(() => { btn.textContent = old; }, 1400);
  });
}

// ================================================================ event

function wire() {
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files);
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    if (!$('landing').classList.contains('hidden')) return;
    e.preventDefault();
    if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files);
  });

  $('pick').onclick = () => $('file').click();
  $('file').onchange = (e) => { if (e.target.files.length) loadFiles(e.target.files); };
  $('demo').onclick = loadDemo;
  $('reset').onclick = () => location.reload();
  $('go').onclick = runPaste;
  $('iglink').addEventListener('keydown', (e) => { if (e.key === 'Enter') runPaste(); });

  for (const el of ['cutoff', 'reps', 'onlyflag', 'tech']) $(el).onchange = render;
  $('q').oninput = render;
  $('tz').onchange = () => {
    const prev = datetimeLocalToEpoch($('cutoff').value, state.tz);
    state.tz = $('tz').value;
    if (prev != null) $('cutoff').value = epochToDatetimeLocal(prev, state.tz);
    render();
  };
  $('cutoff').addEventListener('input', () => { state.guessedCutoff = false; });

  $('legendtoggle').onclick = () => {
    const l = $('legend');
    l.classList.toggle('hidden');
    $('legendtoggle').textContent = l.classList.contains('hidden')
      ? 'Apa arti tanda-tandanya?' : 'Sembunyikan keterangan';
  };

  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('tab-body-' + b.dataset.tab).classList.add('on');
    };
  });

  document.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const st = state.sort[th.dataset.which];
    if (st.key === th.dataset.sort) st.dir *= -1;
    else { st.key = th.dataset.sort; st.dir = th.dataset.which === 'accounts' ? -1 : 1; }
    th.dataset.which === 'accounts' ? renderAccounts() : renderChrono();
  });

  $('dlchrono').onclick = () =>
    download(`${baseName()}_urutan.csv`, commentsCsv(visibleRows(), state.tz), 'text/csv;charset=utf-8');
  $('dlacc').onclick = () =>
    download(`${baseName()}_akun.csv`, accountsCsv(state.result.accounts, state.tz), 'text/csv;charset=utf-8');
  $('dldiff').onclick = () => {
    if (!state.diff) return alert('Jatuhkan dua file hasil tarikan dulu untuk bisa membandingkan.');
    download(`${baseName()}_dihapus.csv`, diffCsv(state.diff, state.tz), 'text/csv;charset=utf-8');
  };
  $('dlraw').onclick = () =>
    download(`${baseName()}_asli.json`, JSON.stringify(state.primary.original, null, 2), 'application/json');
  $('dlsum').onclick = () => download(`${baseName()}_ringkasan.txt`, $('sumtext').textContent);
  $('copysum').onclick = () => copy($('sumtext').textContent, $('copysum'));
  $('copyhash').onclick = () => copy(state.hash || '', $('copyhash'));
}

function wireHandoff() {
  window.addEventListener('message', (ev) => {
    if (!/^https?:\/\/([a-z0-9-]+\.)*instagram\.com$/i.test(ev.origin)) return;
    if (!ev.data || ev.data.ketok !== 'dump' || !ev.data.payload) return;
    if (state.primary) return;
    try { activate([parseDump(ev.data.payload, 'dari bookmarklet')]); }
    catch (e) { showError('Data dari bookmarklet tidak terbaca: ' + e.message); }
  });
  if (window.opener) {
    try { window.opener.postMessage({ ketok: 'ready' }, '*'); } catch { /* diabaikan */ }
  }
}

initTz();
initBookmarklet();
wire();
wireHandoff();
initPaste();
tzNote();
