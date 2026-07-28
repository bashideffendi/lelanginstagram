import { parseDump, readFileAsDump } from './dump.js';
import { analyze, chronoCompare, fmtRupiah } from './analysis.js';
import { diffDumps } from './diff.js';
import {
  browserTz, tzOptions, tzOffsetLabel, fmtDateTime, fmtTime, fmtDate,
  fmtIsoUtc, fmtDuration, datetimeLocalToEpoch, epochToDatetimeLocal
} from './time.js';
import {
  download, sha256Hex, commentsCsv, accountsCsv, diffCsv, summaryText
} from './export.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  dumps: [],
  primary: null,
  diff: null,
  tz: browserTz(),
  cutoff: null,
  grace: 60,
  query: '',
  includeReplies: true,
  onlyFlagged: false,
  result: null,
  hash: null,
  sort: { chrono: { key: 'seq', dir: 1 }, accounts: { key: 'count', dir: -1 } }
};

// ================================================================ timezone

function initTz() {
  const sel = $('tz');
  const { pinned, rest } = tzOptions();
  const g1 = document.createElement('optgroup');
  g1.label = 'Sering dipakai';
  for (const [id, label] of pinned) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = label;
    g1.appendChild(o);
  }
  sel.appendChild(g1);

  const g2 = document.createElement('optgroup');
  g2.label = 'Semua zona';
  for (const id of rest) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id.replace(/_/g, ' ');
    g2.appendChild(o);
  }
  sel.appendChild(g2);

  // Default: ikut jam laptop kalau zonanya dikenali, kalau tidak WIB.
  const opts = [...sel.options].map((o) => o.value);
  sel.value = opts.includes(state.tz) ? state.tz : 'Asia/Jakarta';
  state.tz = sel.value;
}

function tzNote() {
  const ref = state.result?.summary.first ?? Math.floor(Date.now() / 1000);
  const auto = browserTz();
  const same = state.tz === auto;
  $('tznote').textContent =
    `${tzOffsetLabel(ref, state.tz)}${same ? ' — sama dengan jam laptop' : ` — jam laptop: ${auto}`}`;
}

// ================================================================ muat data

function showError(msg) {
  const el = $('loaderr');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function loadFiles(files) {
  $('loaderr').classList.add('hidden');
  const list = [...files].slice(0, 2);
  try {
    const parsed = [];
    for (const f of list) parsed.push(await readFileAsDump(f));
    activate(parsed);
  } catch (e) {
    showError(e.message);
  }
}

function activate(dumps) {
  state.dumps = dumps;

  // Snapshot terbaru jadi acuan analisis; yang lama dipakai untuk mendeteksi hapusan.
  const sorted = dumps
    .slice()
    .sort((a, b) => (a.meta?.extracted_at ?? 0) - (b.meta?.extracted_at ?? 0));
  state.primary = sorted[sorted.length - 1];
  state.diff = dumps.length === 2 ? diffDumps(sorted[0], sorted[1]) : null;

  $('loader').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('reset').classList.remove('hidden');
  $('tab-diff').classList.toggle('hidden', !state.diff);

  // Tebakan cutoff: komentar terakhir, supaya kolomnya tidak kosong melompong.
  const last = Math.max(...state.primary.comments.map((c) => c.created_at));
  $('cutoff').placeholder = epochToDatetimeLocal(last, state.tz);

  computeHash();
  render();
}

async function computeHash() {
  try {
    state.hash = await sha256Hex(JSON.stringify(state.primary.original));
  } catch {
    state.hash = null;
  }
  if ($('hash')) $('hash').textContent = state.hash || 'tidak tersedia';
}

// ================================================================ render

function render() {
  state.cutoff = datetimeLocalToEpoch($('cutoff').value, state.tz);
  state.grace = Math.max(0, +$('grace').value || 0);
  state.includeReplies = $('reps').checked;
  state.onlyFlagged = $('onlyflag').checked;
  state.query = $('q').value.trim().toLowerCase();

  state.result = analyze(state.primary.comments, {
    cutoffEpoch: state.cutoff,
    graceSec: state.grace,
    includeReplies: state.includeReplies
  });

  tzNote();
  renderSource();
  renderCards();
  renderWinner();
  renderChrono();
  renderAccounts();
  renderDiff();
  renderEvidence();
}

function visibleRows() {
  let rows = state.result.rows;
  if (state.onlyFlagged) rows = rows.filter((r) => r.flags.length);
  if (state.query) {
    const q = state.query;
    rows = rows.filter(
      (r) =>
        (r.username || '').toLowerCase().includes(q) ||
        (r.text || '').toLowerCase().includes(q) ||
        r.pk.includes(q)
    );
  }
  const { key, dir } = state.sort.chrono;
  if (key !== 'seq') {
    rows = rows.slice().sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return c * dir;
    });
  } else if (dir === -1) {
    rows = rows.slice().sort((a, b) => chronoCompare(b, a));
  }
  return rows;
}

function renderSource() {
  const s = state.primary.source || {};
  const m = state.primary.meta || {};
  const bits = [];
  if (s.url) bits.push(`Post <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.shortcode || s.url)}</a>`);
  if (s.owner_username) bits.push(`Pemilik <b>@${esc(s.owner_username)}</b>`);
  if (s.post_taken_at) bits.push(`Diunggah <b>${fmtDateTime(s.post_taken_at, state.tz)}</b>`);
  if (m.extracted_at) bits.push(`Ditarik <b>${fmtDateTime(m.extracted_at, state.tz)}</b>`);
  if (s.reported_comment_count != null) {
    const got = state.primary.comments.length;
    const gap = s.reported_comment_count - got;
    bits.push(
      `IG melaporkan <b>${s.reported_comment_count}</b>, terambil <b>${got}</b>` +
      (gap > 0 ? ` <span style="color:var(--warn)">(selisih ${gap})</span>` : '')
    );
  }
  if (state.dumps.length === 2) bits.push(`<b>2 snapshot dimuat</b>`);
  $('src').innerHTML = bits.join('<span class="dimtxt">&nbsp;·&nbsp;</span>');
}

function card(k, v, s, cls = '') {
  return `<div class="card ${cls}"><div class="k">${k}</div><div class="v">${v}</div>` +
    (s ? `<div class="s">${s}</div>` : '') + '</div>';
}

function renderCards() {
  const s = state.result.summary;
  const html = [
    card('Komentar', s.total, `${s.topLevel} utama · ${s.replies} balasan`),
    card('Peserta', s.users, 'akun unik'),
    card('Rentang', fmtDuration(s.span),
      s.first != null ? `${fmtTime(s.first, state.tz)} – ${fmtTime(s.last, state.tz)}` : ''),
    card('Bid lewat cutoff', s.lateBids,
      s.cutoff == null ? 'cutoff belum diisi'
        : `${s.late} komentar setelah tutup, ${s.lateBids} membawa nilai`,
      s.lateBids > 0 ? 'hot' : ''),
    card('Detik akhir', s.snipe, `≤ ${state.grace} dtk sebelum tutup`, s.snipe > 0 ? 'warm' : ''),
    card('Detik kembar', s.tieRows, `dalam ${s.tieGroups} detik`, s.tieRows > 0 ? 'warm' : ''),
    card('Bid turun', s.bidDown, `${s.bidSame} bid sama`, s.bidDown > 0 ? 'hot' : ''),
    card('Nilai terbaca', s.parsedBids, `dari ${s.total} komentar`)
  ];
  if (state.diff) {
    html.push(card('Terhapus', state.diff.deleted.length, 'antar snapshot',
      state.diff.deleted.length > 0 ? 'hot' : 'good'));
  }
  $('cards').innerHTML = html.join('');
}

function renderWinner() {
  const w = state.result.summary.winner;
  if (!w) { $('winner').innerHTML = ''; return; }
  $('winner').innerHTML =
    '<div class="winner">' +
    `<div class="k">Bid sah tertinggi${state.cutoff != null ? ' (sebelum cutoff)' : ''}</div>` +
    `<div class="who">@${esc(w.username || '—')}</div>` +
    `<div class="amt">${w.bid != null ? fmtRupiah(w.bid) : '—'}</div>` +
    `<div class="meta">${fmtDateTime(w.created_at, state.tz)} · epoch ${w.created_at} · ID ${esc(w.pk)}</div>` +
    '</div>';
}

const CHRONO_COLS = [
  ['seq', '#'],
  ['created_at', 'Waktu'],
  [null, 'Epoch'],
  ['gap', 'Jeda'],
  ['username', 'Akun'],
  ['bid', 'Nilai bid'],
  ['increment', 'Naik'],
  [null, 'Penanda'],
  [null, 'Komentar'],
  [null, 'Comment ID']
];

function sortHeader(cols, which) {
  const st = state.sort[which];
  return '<tr>' + cols.map(([key, label]) => {
    if (!key) return `<th class="nosort">${label}</th>`;
    const on = st.key === key;
    return `<th data-sort="${key}" data-which="${which}">${label}` +
      (on ? ` <span class="dir">${st.dir === 1 ? '▲' : '▼'}</span>` : '') + '</th>';
  }).join('') + '</tr>';
}

function pills(r) {
  const map = {
    'lewat-cutoff': ['late', `telat ${fmtDuration(r.late)}`],
    'detik-akhir': ['snipe', `−${fmtDuration(r.snipe)}`],
    'detik-kembar': ['tie', `detik kembar ${r.tieIndex}/${r.tieSize}`],
    'bid-turun': ['down', 'bid turun'],
    'bid-sama': ['same', 'bid sama'],
    beruntun: ['burst', 'beruntun']
  };
  return r.flags.map((f) => {
    const [cls, label] = map[f] || ['same', f];
    return `<span class="pill ${cls}">${esc(label)}</span>`;
  }).join('');
}

function renderChrono() {
  const rows = visibleRows();
  $('c-chrono').textContent = rows.length;
  $('tbl-chrono').tHead.innerHTML = sortHeader(CHRONO_COLS, 'chrono');

  if (!rows.length) {
    $('tbl-chrono').tBodies[0].innerHTML =
      '<tr><td colspan="10" class="empty">Tidak ada komentar yang cocok dengan filter.</td></tr>';
    return;
  }

  let prevDay = null;
  const out = [];
  for (const r of rows) {
    const day = fmtDate(r.created_at, state.tz);
    if (day !== prevDay) {
      out.push(`<tr><td colspan="10" class="mono dimtxt" style="background:#0f1318;font-size:11px;padding:5px 10px">${day}</td></tr>`);
      prevDay = day;
    }
    const cls = [
      r.flags.includes('lewat-cutoff') ? 'late' : '',
      r.flags.includes('detik-akhir') ? 'snipe' : '',
      r.tie ? 'tie' : ''
    ].filter(Boolean).join(' ');

    out.push(
      `<tr class="${cls}">` +
      `<td class="num dimtxt">${r.seq}</td>` +
      `<td class="num">${fmtTime(r.created_at, state.tz)}</td>` +
      `<td class="num dimtxt">${r.created_at}</td>` +
      `<td class="num dimtxt">${r.gap != null ? fmtDuration(r.gap) : '—'}</td>` +
      `<td class="mono user">${esc(r.username || '—')}${r.is_reply ? '<span class="dimtxt"> ↳</span>' : ''}</td>` +
      `<td class="num conf-${r.bidConfidence || 'low'}">${r.bid != null ? fmtRupiah(r.bid) : '<span class="dimtxt">—</span>'}</td>` +
      `<td class="num dimtxt">${r.increment != null ? (r.increment > 0 ? '+' : '') + fmtRupiah(r.increment) : ''}</td>` +
      `<td>${pills(r)}</td>` +
      `<td class="txt">${esc(r.text)}</td>` +
      `<td class="num dimtxt">${esc(r.pk)}</td>` +
      '</tr>'
    );
  }
  $('tbl-chrono').tBodies[0].innerHTML = out.join('');
}

const ACC_COLS = [
  ['username', 'Akun'],
  ['count', 'Komen'],
  ['first', 'Pertama'],
  ['last', 'Terakhir'],
  ['span', 'Rentang'],
  ['avgGap', 'Rata jeda'],
  ['maxBid', 'Bid tertinggi'],
  ['lateBidCount', 'Bid lewat cutoff'],
  ['snipeCount', 'Detik akhir'],
  ['downCount', 'Bid turun'],
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
    if (a.lateEntrant) notes.push('<span class="pill snipe">masuk belakangan</span>');
    if (a.count === 1) notes.push('<span class="pill same">sekali komen</span>');
    if (a.lateBidCount) notes.push('<span class="pill late">bid setelah tutup</span>');
    else if (a.lateCount) notes.push('<span class="pill same">komen setelah tutup</span>');
    return '<tr>' +
      `<td class="mono user">${esc(a.username)}${a.full_name ? `<div class="dimtxt" style="font-size:11px">${esc(a.full_name)}</div>` : ''}</td>` +
      `<td class="num">${a.count}${a.replies ? `<span class="dimtxt"> (${a.replies}↳)</span>` : ''}</td>` +
      `<td class="num">${fmtTime(a.first, state.tz)}</td>` +
      `<td class="num">${fmtTime(a.last, state.tz)}</td>` +
      `<td class="num dimtxt">${fmtDuration(a.span)}</td>` +
      `<td class="num dimtxt">${a.avgGap != null ? fmtDuration(a.avgGap) : '—'}</td>` +
      `<td class="num">${a.maxBid != null ? fmtRupiah(a.maxBid) : '<span class="dimtxt">—</span>'}</td>` +
      `<td class="num" style="color:${a.lateBidCount ? 'var(--danger)' : 'var(--dim-2)'}">` +
      `${a.lateBidCount || '—'}${a.lateCount > a.lateBidCount ? `<span class="dimtxt"> (+${a.lateCount - a.lateBidCount} komen)</span>` : ''}</td>` +
      `<td class="num" style="color:${a.snipeCount ? 'var(--warn)' : 'var(--dim-2)'}">${a.snipeCount || '—'}</td>` +
      `<td class="num" style="color:${a.downCount ? 'var(--danger)' : 'var(--dim-2)'}">${a.downCount || '—'}</td>` +
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
    info.push('<div class="warnbox">Dua snapshot ini berasal dari post yang berbeda. Perbandingannya tidak berarti.</div>');
  }
  info.push(
    '<div class="infobox">' +
    `<b>${esc(d.beforeLabel)}</b> (${d.beforeCount} komentar${d.beforeAt ? ', ' + fmtDateTime(d.beforeAt, state.tz) : ''})` +
    ' &rarr; ' +
    `<b>${esc(d.afterLabel)}</b> (${d.afterCount} komentar${d.afterAt ? ', ' + fmtDateTime(d.afterAt, state.tz) : ''})<br>` +
    `<b style="color:var(--danger)">${d.deleted.length} dihapus</b> · ` +
    `${d.added.length} baru · ${d.changed.length} berubah` +
    (d.swapped ? '<br><span style="font-size:12px">Urutan file ditukar otomatis berdasarkan waktu penarikan.</span>' : '') +
    '</div>'
  );
  $('diffinfo').innerHTML = info.join('');

  $('tbl-diff').tHead.innerHTML =
    '<tr><th class="nosort">Status</th><th class="nosort">Waktu</th><th class="nosort">Epoch</th>' +
    '<th class="nosort">Akun</th><th class="nosort">Komentar</th><th class="nosort">Comment ID</th></tr>';

  const row = (pill, c, extra = '') =>
    '<tr>' +
    `<td>${pill}</td>` +
    `<td class="num">${fmtDateTime(c.created_at, state.tz)}</td>` +
    `<td class="num dimtxt">${c.created_at}</td>` +
    `<td class="mono user">${esc(c.username || '—')}</td>` +
    `<td class="txt">${esc(c.text)}${extra}</td>` +
    `<td class="num dimtxt">${esc(c.pk)}</td>` +
    '</tr>';

  const body = [
    ...d.deleted.map((c) => row('<span class="pill del">dihapus</span>', c)),
    ...d.changed.map((ch) =>
      row('<span class="pill snipe">berubah</span>', ch.before,
        `<div class="dimtxt" style="font-size:11px;margin-top:4px">&rarr; ${esc(ch.after.text)}</div>`)),
    ...d.added.map((c) => row('<span class="pill new">baru</span>', c))
  ];

  $('tbl-diff').tBodies[0].innerHTML = body.length
    ? body.join('')
    : '<tr><td colspan="6" class="empty">Tidak ada perbedaan. Tidak ada komentar yang dihapus di antara dua penarikan.</td></tr>';
}

function renderEvidence() {
  $('sumtext').textContent = summaryText(
    state.result.summary, state.primary.source, state.tz, state.hash
  );
  if (state.hash) $('hash').textContent = state.hash;
}

// ================================================================ ekspor

function baseName() {
  const s = state.primary.source || {};
  return `ketok_${s.shortcode || s.media_id || 'dump'}_${state.primary.meta?.extracted_at || 'x'}`;
}

function wireExports() {
  $('dlchrono').onclick = () =>
    download(`${baseName()}_kronologi.csv`, commentsCsv(visibleRows(), state.tz), 'text/csv;charset=utf-8');
  $('dlacc').onclick = () =>
    download(`${baseName()}_akun.csv`, accountsCsv(state.result.accounts, state.tz), 'text/csv;charset=utf-8');
  $('dldiff').onclick = () => {
    if (!state.diff) return alert('Muat dua snapshot dulu untuk mode perbandingan.');
    download(`${baseName()}_perbandingan.csv`, diffCsv(state.diff, state.tz), 'text/csv;charset=utf-8');
  };
  $('dlraw').onclick = () =>
    download(`${baseName()}_mentah.json`, JSON.stringify(state.primary.original, null, 2), 'application/json');
  $('dlsum').onclick = () =>
    download(`${baseName()}_ringkasan.txt`, $('sumtext').textContent);
  $('copysum').onclick = () => copy($('sumtext').textContent, $('copysum'));
  $('copyhash').onclick = () => copy(state.hash || '', $('copyhash'));
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

  $('pick').onclick = () => $('file').click();
  $('file').onchange = (e) => { if (e.target.files.length) loadFiles(e.target.files); };

  $('reset').onclick = (e) => {
    e.preventDefault();
    location.hash = '';
    location.reload();
  };

  for (const el of ['cutoff', 'grace', 'reps', 'onlyflag']) $(el).onchange = render;
  $('q').oninput = () => { render(); };
  $('tz').onchange = () => {
    // Pertahankan momen cutoff yang sama saat pindah timezone.
    const prevEpoch = datetimeLocalToEpoch($('cutoff').value, state.tz);
    state.tz = $('tz').value;
    if (prevEpoch != null) $('cutoff').value = epochToDatetimeLocal(prevEpoch, state.tz);
    render();
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
    const which = th.dataset.which;
    const st = state.sort[which];
    if (st.key === th.dataset.sort) st.dir *= -1;
    else { st.key = th.dataset.sort; st.dir = which === 'accounts' ? -1 : 1; }
    which === 'accounts' ? renderAccounts() : renderChrono();
  });

  wireExports();
}

// ---------------------------------------------------------------- handoff

function wireHandoff() {
  window.addEventListener('message', (ev) => {
    if (!/^https?:\/\/([a-z0-9-]+\.)*instagram\.com$/i.test(ev.origin)) return;
    if (!ev.data || ev.data.ketok !== 'dump' || !ev.data.payload) return;
    if (state.primary) return;                       // sudah ada data, abaikan kiriman ulang
    try {
      activate([parseDump(ev.data.payload, 'dari bookmarklet')]);
    } catch (e) {
      showError('Data dari bookmarklet tidak terbaca: ' + e.message);
    }
  });

  if (window.opener) {
    try { window.opener.postMessage({ ketok: 'ready' }, '*'); } catch { /* diabaikan */ }
  }
}

initTz();
wire();
wireHandoff();
tzNote();
