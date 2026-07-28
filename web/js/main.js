import { parseDump, readFileAsDump } from './dump.js';
import { analyze, chronoCompare, fmtRupiah } from './analysis.js';
import { diffDumps } from './diff.js';
import {
  browserTz, tzOptions, tzOffsetLabel, fmtDateTime, fmtTime, fmtDate,
  fmtDuration, wallTimeToEpoch
} from './time.js';
import {
  download, sha256Hex, commentsCsv, accountsCsv, diffCsv, summaryText
} from './export.js';
import {
  pingExtension, extractViaExtension, looksLikePostUrl,
  probeServer, extractViaServer, savedKey, saveKey
} from './ext.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  dumps: [], primary: null, diff: null, isDemo: false,
  tz: browserTz(), cutoff: null, captionGuess: null, grace: 60,
  query: '', includeReplies: true, onlyFlagged: false, tech: false, wrap: false,
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
    $('bmnote').innerHTML =
      'Belum dibuat — jalankan <code>node bookmarklet/build.mjs</code> sekali.';
  }
  $('bm').addEventListener('click', (e) => {
    e.preventDefault();
    $('bmnote').textContent = 'Tombol ini harus diseret ke bar bookmark, bukan diklik di sini.';
    $('bmnote').style.color = 'var(--bad)';
  });
}

// ================================================================ kotak ambil

let extVersion = null;
let serverState = 'off';     // 'off' | 'need-key' | 'no-session' | 'ready'

function setStat(text, cls = '') {
  $('paststat').className = 'take-stat ' + cls;
  $('paststat').innerHTML = text;
}

function openFine() {
  $('extinfo').open = true;
  $('extinfo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Extension diutamakan kalau ada: penarikannya dari browser pengguna sendiri,
 * jadi lebih cepat, tanpa batas laju, dan tidak membebani sesi milik server.
 */
async function initTake() {
  setStat('Menyiapkan&hellip;');

  extVersion = await pingExtension();
  if (extVersion) {
    setStat('Siap. Extension terpasang, penarikan berjalan dari browser kamu sendiri.', 'ready');
    return;
  }

  serverState = await probeServer(savedKey());

  if (serverState === 'ready') {
    setStat('Siap. Tempel link postingan lelangnya di atas.', 'ready');
  } else if (serverState === 'need-key') {
    setStat('Terkunci. Isi kunci di bawah, sekali saja.', 'warn');
    $('keybox').classList.remove('hidden');
    $('ketokkey').value = savedKey();
  } else if (serverState === 'no-session') {
    setStat('Server belum disetel sesi Instagram-nya. ' +
      '<button class="link" id="whyext">Pakai cara lain</button>', 'warn');
    $('whyext').onclick = openFine;
  } else {
    setStat('Server sedang tidak tersedia. ' +
      '<button class="link" id="whyext">Pakai cara lain</button>', 'warn');
    $('whyext').onclick = openFine;
  }
}

async function applyKey() {
  const k = $('ketokkey').value.trim();
  if (!k) { setStat('Kunci masih kosong.', 'bad'); return; }
  saveKey(k);
  setStat('Memeriksa kunci&hellip;');
  serverState = await probeServer(k);
  if (serverState === 'ready') {
    $('keybox').classList.add('hidden');
    setStat('Kunci diterima. Tempel link postingannya di atas.', 'ready');
  } else if (serverState === 'no-session') {
    $('keybox').classList.add('hidden');
    setStat('Kunci diterima, tapi sesi Instagram belum disetel di server.', 'warn');
  } else {
    setStat('Kunci ditolak server.', 'bad');
  }
}

async function runTake() {
  const url = $('iglink').value.trim();

  if (!url) { setStat('Tempel dulu link postingannya.', 'bad'); return; }
  if (!looksLikePostUrl(url)) {
    setStat('Itu bukan link postingan. Bentuknya <code>instagram.com/p/XXXX/</code> — ' +
      'buka postingannya, lalu salin alamat dari bilah alamat browser.', 'bad');
    return;
  }

  // Extension bisa dipasang setelah halaman terbuka, jadi selalu cek ulang.
  if (!extVersion) extVersion = await pingExtension();

  if (!extVersion && serverState !== 'ready') {
    serverState = await probeServer(savedKey());
    if (serverState === 'need-key') {
      setStat('Terkunci. Isi kunci di bawah dulu.', 'bad');
      $('keybox').classList.remove('hidden');
      return;
    }
    if (serverState !== 'ready') {
      setStat('Server sedang tidak tersedia. Pakai extension atau bookmarklet di bawah.', 'bad');
      openFine();
      return;
    }
  }

  const btn = $('go');
  btn.disabled = true;
  $('pasteprog').classList.remove('hidden');
  const fill = $('pasteprog').querySelector('i');
  fill.style.width = '0%';

  try {
    let dump;
    if (extVersion) {
      dump = await extractViaExtension(url, (p) => {
        if (p.stage === 'info') setStat('Membaca keterangan postingan&hellip;');
        else if (p.stage === 'comments') {
          setStat(`Menarik komentar&hellip; ${p.count} terkumpul` + (p.total ? ` dari sekitar ${p.total}` : ''));
          fill.style.width = (p.total ? Math.min(95, (p.count / p.total) * 100) : Math.min(90, (p.page || 0) * 8)) + '%';
        } else if (p.stage === 'replies') {
          setStat(`Menarik balasan&hellip; utas ${p.page} dari ${p.total}`);
        }
      });
      fill.style.width = '100%';
      activate([parseDump(dump, 'lewat extension')]);
    } else {
      setStat('Menarik komentar&hellip; postingan ramai bisa makan sekitar satu menit.');
      fill.style.width = '60%';
      dump = await extractViaServer(url, savedKey());
      fill.style.width = '100%';
      activate([parseDump(dump, 'lewat server')]);
    }
  } catch (e) {
    setStat('Gagal: ' + esc(e.message) + failHint(e), 'bad');
    if (e.code === 'sesi_kosong') openFine();
    if (e.httpStatus === 401) $('keybox').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    setTimeout(() => $('pasteprog').classList.add('hidden'), 800);
  }
}

function failHint(e) {
  const s = e.status ?? e.igStatus;
  if (s === 401 || s === 403) return ' Buka instagram.com di tab lain dan pastikan kamu sudah login.';
  if (s === 429) return ' Tunggu beberapa menit.';
  if (s === 404) return ' Postingannya mungkin sudah dihapus, atau akunnya privat.';
  return '';
}

// ================================================================ zona waktu

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
    : `${tzOffsetLabel(ref, state.tz)} — jam laptop kamu: ${auto}.`;
}

/** Singkatan zona untuk kartu bukti: WIB lebih dimengerti daripada UTC+07:00. */
function tzShort(epoch) {
  const map = {
    'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB',
    'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT', UTC: 'UTC'
  };
  return map[state.tz] || tzOffsetLabel(epoch, state.tz);
}

// ================================================================ kendali jam tutup

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

const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (h, mi, sec) => `${pad(h)}:${pad(mi)}` + (sec ? `:${pad(sec)}` : '');

/** Hari-hari yang benar-benar ada komentarnya, dalam zona waktu terpilih. */
function commentDays() {
  const days = [];
  for (const c of state.primary.comments) {
    const d = fmtDate(c.created_at, state.tz);
    if (!days.includes(d)) days.push(d);
  }
  return days.sort((a, b) => {
    const [da, ma, ya] = a.split('/'); const [db, mb, yb] = b.split('/');
    return `${ya}${ma}${da}`.localeCompare(`${yb}${mb}${db}`);
  });
}

function dayClockToEpoch(day, clock) {
  const [d, mo, y] = day.split('/').map(Number);
  return wallTimeToEpoch(y, mo, d, clock.h, clock.mi, clock.sec, state.tz);
}

/** Pilihan cepat, diturunkan dari data supaya sekali klik biasanya sudah benar. */
function cutoffPicks() {
  const rows = state.result?.rows || [];
  if (!rows.length) return [];
  const last = rows[rows.length - 1].created_at;
  const picks = [];

  if (state.captionGuess) {
    picks.push({ label: state.captionGuess.label.replace('.', ':'), sub: 'dari caption', epoch: state.captionGuess.epoch });
  }

  // Jam bulat terdekat sebelum atau tepat pada komentar terakhir.
  const day = fmtDate(last, state.tz);
  const [hh] = fmtTime(last, state.tz).split(':').map(Number);
  const roundEpoch = dayClockToEpoch(day, { h: hh, mi: 0, sec: 0 });
  if (!picks.some((p) => p.epoch === roundEpoch)) {
    picks.push({ label: fmtClock(hh, 0, 0), sub: 'jam bulat', epoch: roundEpoch });
  }

  if (!picks.some((p) => p.epoch === last)) {
    picks.push({ label: fmtTime(last, state.tz), sub: 'komentar terakhir', epoch: last });
  }
  return picks;
}

function syncCutoffUI() {
  const dateSel = $('cutoffDate');
  const timeIn = $('cutoffTime');

  const days = commentDays();
  const cutoffDay = state.cutoff != null ? fmtDate(state.cutoff, state.tz) : null;
  const opts = cutoffDay && !days.includes(cutoffDay) ? [...days, cutoffDay] : days;

  const wanted = cutoffDay || days[days.length - 1] || '';
  if (dateSel.dataset.built !== opts.join('|')) {
    dateSel.innerHTML = opts.map((d) => `<option value="${d}">${d}</option>`).join('');
    dateSel.dataset.built = opts.join('|');
  }
  dateSel.value = wanted;
  dateSel.classList.toggle('hidden', opts.length < 2 && !cutoffDay);

  // Jangan menimpa ketikan yang sedang berlangsung.
  if (document.activeElement !== timeIn) {
    timeIn.value = state.cutoff != null
      ? fmtTime(state.cutoff, state.tz).replace(/:00$/, '')
      : '';
  }

  const picks = cutoffPicks();
  $('cutoffPicks').innerHTML = picks.length
    ? '<span class="picklbl">Cepat:</span>' + picks.map((p) =>
        `<button type="button" data-epoch="${p.epoch}"${p.epoch === state.cutoff ? ' class="on"' : ''}` +
        ` title="${esc(p.sub)}">${esc(p.label)}</button>`).join('')
    : '';
  for (const b of $('cutoffPicks').querySelectorAll('button')) {
    b.onclick = () => {
      state.cutoff = +b.dataset.epoch;
      state.guessedCutoff = false;
      render();
    };
  }
}

function readCutoffFromUI() {
  const timeIn = $('cutoffTime');
  const raw = timeIn.value.trim();

  if (!raw) {
    timeIn.classList.remove('bad');
    state.cutoff = null;
    return;
  }
  const clock = parseClock(raw);
  timeIn.classList.toggle('bad', !clock);
  if (!clock) return;                       // biarkan nilai lama sampai ketikannya sah

  const day = $('cutoffDate').value || commentDays().slice(-1)[0];
  if (!day) return;
  state.cutoff = dayClockToEpoch(day, clock);
  state.guessedCutoff = false;
}

// ================================================================ tebak jam tutup

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
  const epoch = wallTimeToEpoch(y, mo, d, pick.h, pick.mi, 0, tz);
  const first = Math.min(...comments.map((c) => c.created_at));
  if (epoch < first || epoch > last + 86400) return null;
  return { epoch, label: `${String(pick.h).padStart(2, '0')}.${String(pick.mi).padStart(2, '0')}` };
}

// ================================================================ muat

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
    showError('Gagal memuat contoh: ' + e.message);
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
      'Angkanya dibuat-buat supaya kamu bisa melihat cara kerjanya. ' +
      'Klik &ldquo;Cek lelang lain&rdquo; di kanan atas untuk memakai data sungguhan.</div>'
    : '';

  const g = guessCutoff(state.primary.source?.caption, state.primary.comments, state.tz);
  state.captionGuess = g;
  if (g) {
    state.cutoff = g.epoch;
    state.guessedCutoff = g.label;
  } else {
    state.cutoff = null;
    state.guessedCutoff = false;
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

// ================================================================ gambar ulang

function render() {
  state.includeReplies = $('reps').checked;
  state.onlyFlagged = $('onlyflag').checked;
  state.tech = $('tech').checked;
  state.wrap = $('wrap').checked;
  state.query = $('q').value.trim().toLowerCase();

  state.result = analyze(state.primary.comments, {
    cutoffEpoch: state.cutoff,
    graceSec: state.grace,
    includeReplies: state.includeReplies
  });

  tzNote();
  syncCutoffUI();
  renderProof();
  renderChips();
  renderChrono();
  renderAccounts();
  renderDiff();
  renderLegend();
  $('sumtext').textContent = summaryText(
    state.result.summary, state.primary.source, state.tz, state.hash);
}

/** Kartu bukti — bagian yang difoto layar dan dikirim ke penyelenggara. */
function renderProof() {
  const s = state.result.summary;
  const w = s.winner;
  const src = state.primary.source || {};
  const out = ['<div class="pcard">'];

  out.push('<div class="pcard-top">');
  if (w) {
    out.push('<div class="pcard-kicker">Tawaran tertinggi yang sah' +
      (s.cutoff != null ? ' &mdash; masuk sebelum lelang ditutup' : '') + '</div>');
    out.push('<div class="pcard-row">' +
      `<span class="pcard-who">@${esc(w.username || '—')}</span>` +
      `<span class="pcard-amt">${w.bid != null ? 'Rp' + fmtRupiah(w.bid) : '—'}</span>` +
      '</div>');
    const rel = s.cutoff != null && w.created_at <= s.cutoff
      ? ` &middot; ${fmtDuration(s.cutoff - w.created_at)} sebelum tutup` : '';
    out.push(`<div class="pcard-when"><b>${fmtDateTime(w.created_at, state.tz)} ` +
      `${tzShort(w.created_at)}</b>${rel}</div>`);
    out.push(`<div class="pcard-quote">${esc(w.text)}</div>`);
  } else {
    out.push('<div class="pcard-kicker">Belum ada tawaran yang terbaca</div>');
    out.push('<div class="pcard-row"><span class="pcard-who">Tidak ada angka yang bisa dikenali</span></div>');
    out.push('<div class="pcard-when">Komentarnya mungkin tidak memuat nilai tawaran ' +
      'dalam format yang dikenali.</div>');
  }
  out.push('</div>');

  // Temuan, paling penting di atas.
  // Penandanya sengaja bukan angka: jumlahnya sudah disebut di kalimatnya,
  // dan dua angka berdampingan terbaca sebagai satu bilangan ("2 2").
  const flags = [];
  if (s.cutoff == null) {
    flags.push(['warn', 'Jam tutup lelang belum diisi.',
      'Tanpa itu, tawaran yang telat tidak bisa ditandai. Kotaknya ada tepat di bawah kartu ini.']);
  } else if (s.lateBids > 0) {
    const worst = Math.max(...state.result.rows
      .filter((r) => r.flags.includes('lewat-cutoff') && r.bid != null).map((r) => r.late));
    flags.push(['bad', `${s.lateBids} tawaran masuk setelah lelang ditutup.`,
      `Yang paling telat lewat ${fmtDuration(worst)}.`]);
  }
  if (state.diff && state.diff.deleted.length) {
    flags.push(['bad', `${state.diff.deleted.length} komentar dihapus di antara dua tarikan kamu.`,
      'Isinya masih tersimpan di tab &ldquo;Yang dihapus&rdquo;.']);
  }
  if (s.tieGroups > 0) {
    flags.push(['warn', `${s.tieRows} tawaran jatuh pada detik yang sama persis.`,
      'Urutannya diambil dari nomor komentar Instagram, bukan dari jam.']);
  }
  if (s.bidDown > 0) {
    flags.push(['warn', `${s.bidDown} tawaran nilainya lebih rendah dari tawaran tertinggi saat itu.`, '']);
  }
  if (s.cutoff != null && !flags.length) {
    flags.push(['good', 'Tidak ditemukan kejanggalan.',
      'Semua tawaran masuk sebelum tutup, tidak ada nilai yang turun, tidak ada detik kembar.']);
  }

  if (flags.length) {
    out.push('<div class="pflags">');
    for (const [cls, head, sub] of flags) {
      out.push(`<div class="pflag ${cls}"><span class="pflag-mark">${cls === 'good' ? '✓' : '!'}</span>` +
        `<span><b>${head}</b>${sub ? ' ' + sub : ''}</span></div>`);
    }
    out.push('</div>');
  }

  const meta = [];
  meta.push(`<span>${s.total} komentar &middot; ${s.users} peserta</span>`);
  if (s.cutoff != null) meta.push(`<span>Ditutup <b>${fmtTime(s.cutoff, state.tz)} ${tzShort(s.cutoff)}</b></span>`);
  if (src.owner_username) meta.push(`<span>Lelang oleh <b>@${esc(src.owner_username)}</b></span>`);
  if (src.url) meta.push(`<a href="${esc(src.url)}" target="_blank" rel="noopener">buka postingannya</a>`);
  out.push(`<div class="pcard-meta">${meta.join('')}</div>`);

  out.push('<div class="pcard-act">' +
    '<button class="btn solid" id="proofcopy">Salin bukti</button>' +
    '<button class="btn" id="proofjump">Lihat urutan lengkap</button>' +
    '</div>');

  out.push('</div>');

  if (state.guessedCutoff && state.cutoff != null) {
    out.push(`<p class="alert warn">Jam tutup <b>${esc(state.guessedCutoff)}</b> ditebak dari ` +
      'caption postingannya. Periksa dan perbaiki kalau salah &mdash; semua penandaan bergantung padanya.</p>');
  }

  $('proof').innerHTML = out.join('');
  $('proofcopy').onclick = () => copy($('sumtext').textContent, $('proofcopy'));
  $('proofjump').onclick = () => {
    document.querySelector('.tabs button[data-tab="chrono"]').click();
    $('tab-body-chrono').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

/** Nol dibiarkan kelabu; hanya angka yang berarti sesuatu yang diberi warna. */
function chip(n, k, cls = '') {
  return `<div class="chip ${cls}"><div class="n">${n}</div><div class="k">${k}</div></div>`;
}

function renderChips() {
  const s = state.result.summary;
  const out = [
    chip(s.cutoff == null ? '—' : s.lateBids, 'Tawaran telat',
      s.cutoff != null && s.lateBids > 0 ? 'bad' : ''),
    chip(s.cutoff == null ? '—' : s.snipe, 'Detik terakhir', s.snipe > 0 ? 'warn' : ''),
    chip(s.tieRows, 'Detik kembar', s.tieRows > 0 ? 'warn' : ''),
    chip(s.bidDown, 'Nilai turun', s.bidDown > 0 ? 'bad' : ''),
    chip(s.users, 'Peserta', 'on'),
    chip(fmtDuration(s.span), 'Lama lelang', 'on')
  ];
  if (state.diff) {
    out.push(chip(state.diff.deleted.length, 'Dihapus',
      state.diff.deleted.length ? 'bad' : 'good'));
  }
  $('cards').innerHTML = out.join('');
}

const TAGS = {
  'lewat-cutoff': ['late', (r) => `telat ${fmtDuration(r.late)}`,
    'Masuk setelah jam tutup yang kamu isi.'],
  'detik-akhir': ['snipe', (r) => `${fmtDuration(r.snipe)} sebelum tutup`,
    'Masuk di detik-detik terakhir sebelum tutup.'],
  'detik-kembar': ['tie', (r) => `detik sama ${r.tieIndex} dari ${r.tieSize}`,
    'Ada tawaran lain di detik yang sama persis; urutan diambil dari nomor komentar.'],
  'bid-turun': ['down', () => 'nilai turun', 'Lebih kecil dari tawaran tertinggi sebelumnya.'],
  'bid-sama': ['same', () => 'nilai sama', 'Sama persis dengan tawaran tertinggi sebelumnya.'],
  beruntun: ['burst', () => 'beruntun', 'Akun yang sama berkomentar lagi dalam 5 detik.']
};

function tags(r) {
  return r.flags.map((f) => {
    const t = TAGS[f];
    return t ? `<span class="tag ${t[0]}">${esc(t[1](r))}</span>` : '';
  }).join('');
}

function renderLegend() {
  const label = { late: 'telat', snipe: 'detik akhir', tie: 'detik sama',
    down: 'nilai turun', same: 'nilai sama', burst: 'beruntun' };
  $('legend').innerHTML = Object.values(TAGS)
    .map(([cls, , desc]) => `<div><span class="tag ${cls}">${label[cls]}</span> ${desc}</div>`)
    .join('');
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

/** Komentar dilipat kalau panjang, supaya satu layar memuat seluruh urutan. */
function msgCell(r) {
  const long = (r.text || '').length > 90 || (r.text || '').includes('\n');
  return '<td class="msg">' +
    `<div class="txt${long ? ' clip' : ''}">${esc(r.text)}</div>` +
    (long ? '<button class="more" type="button">selengkapnya</button>' : '') +
    '</td>';
}

function rowHtml(r, span, extraCls = '', lead = '') {
  const cls = [extraCls,
    r.flags.includes('lewat-cutoff') ? 'r-late' : '',
    r.flags.includes('detik-akhir') ? 'r-snipe' : ''].filter(Boolean).join(' ');

  // Di baris pemenang yang dipatok, "selisih" tidak punya arti — barisnya
  // dicabut dari urutannya.
  return `<tr class="${cls}">` +
    `<td class="n dim">${lead || r.seq}</td>` +
    `<td class="clock">${fmtTime(r.created_at, state.tz)}</td>` +
    `<td class="n dim">${lead ? '—' : (r.gap != null ? fmtDuration(r.gap) : '—')}</td>` +
    `<td class="who">${esc(r.username || '—')}${r.is_reply ? ' <span class="dim">(balasan)</span>' : ''}</td>` +
    `<td class="money">${r.bid != null ? 'Rp' + fmtRupiah(r.bid) : '<span class="dim">—</span>'}</td>` +
    (state.tech
      ? `<td class="n dim">${r.increment != null ? (r.increment > 0 ? '+' : '') + fmtRupiah(r.increment) : ''}</td>` +
        `<td class="mn">${r.created_at}</td>`
      : '') +
    `<td>${tags(r)}</td>` +
    msgCell(r) +
    (state.tech ? `<td class="mn">${esc(r.pk)}</td>` : '') +
    '</tr>';
}

function renderChrono() {
  const rows = visibleRows();
  $('c-chrono').textContent = rows.length;

  const cols = [
    ['seq', 'Ke-'], ['created_at', 'Jam'], ['gap', 'Selisih'], ['username', 'Akun'], ['bid', 'Nilai'],
    ...(state.tech ? [['increment', 'Naik'], [null, 'Jam mentah']] : []),
    [null, 'Tanda'], [null, 'Komentar'],
    ...(state.tech ? [[null, 'Nomor komentar']] : [])
  ];
  const span = cols.length;
  const tbl = $('tbl-chrono');
  tbl.tHead.innerHTML = sortHeader(cols, 'chrono');
  tbl.classList.toggle('wrapall', state.wrap);

  if (!rows.length) {
    tbl.tBodies[0].innerHTML =
      `<tr><td colspan="${span}" class="empty">Tidak ada komentar yang cocok dengan pencarian atau saringan kamu.</td></tr>`;
    return;
  }

  const out = [];

  // Pemenang dipatok di baris teratas — inilah yang dicari orang lebih dulu.
  const w = state.result.summary.winner;
  if (w) {
    out.push(`<tr class="day"><td colspan="${span}">Tawaran pemenang</td></tr>`);
    out.push(rowHtml(w, span, 'pinned', '<span class="tag win">menang</span>'));
    out.push(`<tr class="day"><td colspan="${span}">Urutan lengkap</td></tr>`);
  }

  let prevDay = null;
  for (const r of rows) {
    const day = fmtDate(r.created_at, state.tz);
    if (day !== prevDay) {
      out.push(`<tr class="day"><td colspan="${span}">${day}</td></tr>`);
      prevDay = day;
    }
    out.push(rowHtml(r, span, w && r.pk === w.pk ? 'pinned' : ''));
  }
  tbl.tBodies[0].innerHTML = out.join('');
}

const ACC_COLS = [
  ['username', 'Akun'], ['count', 'Komentar'], ['first', 'Pertama'], ['last', 'Terakhir'],
  ['maxBid', 'Nilai tertinggi'], ['lateBidCount', 'Telat'], ['snipeCount', 'Detik akhir'],
  ['downCount', 'Nilai turun'], [null, 'Catatan']
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
    const cell = (n, color) => `<td class="n" style="color:${n ? color : 'var(--mute)'}">${n || '—'}</td>`;
    return '<tr>' +
      `<td class="who">${esc(a.username)}` +
      (a.full_name ? `<div class="dim" style="font-weight:400;font-size:13px">${esc(a.full_name)}</div>` : '') +
      '</td>' +
      `<td class="n">${a.count}${a.replies ? ` <span class="dim">(${a.replies} balasan)</span>` : ''}</td>` +
      `<td class="clock">${fmtTime(a.first, state.tz)}</td>` +
      `<td class="clock">${fmtTime(a.last, state.tz)}</td>` +
      `<td class="money">${a.maxBid != null ? 'Rp' + fmtRupiah(a.maxBid) : '<span class="dim">—</span>'}</td>` +
      cell(a.lateBidCount, 'var(--bad)') +
      cell(a.snipeCount, 'var(--warn)') +
      cell(a.downCount, 'var(--bad)') +
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
    info.push('<p class="alert bad">Dua berkas ini dari postingan yang berbeda, ' +
      'jadi perbandingannya tidak berarti apa-apa.</p>');
  }
  info.push('<p class="tabnote">' +
    `Membandingkan tarikan <b>${d.beforeAt ? fmtDateTime(d.beforeAt, state.tz) : 'lebih awal'}</b> ` +
    `(${d.beforeCount} komentar) dengan <b>${d.afterAt ? fmtDateTime(d.afterAt, state.tz) : 'lebih akhir'}</b> ` +
    `(${d.afterCount} komentar). Yang ada di tarikan pertama tapi hilang di tarikan kedua berarti dihapus.</p>`);
  $('diffinfo').innerHTML = info.join('');

  $('tbl-diff').tHead.innerHTML =
    '<tr><th class="nosort">Status</th><th class="nosort">Jam</th>' +
    '<th class="nosort">Akun</th><th class="nosort">Komentar</th></tr>';

  const row = (tag, c, extra = '') => '<tr>' +
    `<td>${tag}</td><td class="clock">${fmtDateTime(c.created_at, state.tz)}</td>` +
    `<td class="who">${esc(c.username || '—')}</td>` +
    `<td class="msg"><div class="txt">${esc(c.text)}${extra}</div></td></tr>`;

  const body = [
    ...d.deleted.map((c) => row('<span class="tag del">dihapus</span>', c)),
    ...d.changed.map((ch) => row('<span class="tag snipe">diubah</span>', ch.before,
      `<div class="dim" style="font-size:13px;margin-top:4px">menjadi: ${esc(ch.after.text)}</div>`)),
    ...d.added.map((c) => row('<span class="tag new">baru</span>', c))
  ];
  $('tbl-diff').tBodies[0].innerHTML = body.length ? body.join('')
    : '<tr><td colspan="4" class="empty">Tidak ada bedanya. Tidak ada komentar yang dihapus di antara dua tarikan kamu.</td></tr>';
}

// ================================================================ ekspor

function baseName() {
  const s = state.primary.source || {};
  return `lelanginsta_${s.shortcode || s.media_id || 'lelang'}`;
}

function copy(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent;
    btn.textContent = 'Tersalin';
    setTimeout(() => { btn.textContent = old; }, 1400);
  });
}

// ================================================================ perkabelan

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
  $('go').onclick = runTake;
  $('iglink').addEventListener('keydown', (e) => { if (e.key === 'Enter') runTake(); });
  $('keysave').onclick = applyKey;
  $('ketokkey').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyKey(); });

  for (const el of ['reps', 'onlyflag', 'tech', 'wrap']) $(el).onchange = render;
  $('q').oninput = render;

  // Zona waktu hanya mengubah cara menampilkan; momen tutupnya tidak bergeser.
  $('tz').onchange = () => { state.tz = $('tz').value; render(); };

  $('cutoffTime').addEventListener('input', () => { readCutoffFromUI(); render(); });
  $('cutoffTime').addEventListener('blur', () => { readCutoffFromUI(); render(); });
  $('cutoffDate').addEventListener('change', () => { readCutoffFromUI(); render(); });

  $('legendtoggle').onclick = () => {
    const l = $('legend');
    l.classList.toggle('hidden');
    $('legendtoggle').textContent = l.classList.contains('hidden') ? 'Arti tanda' : 'Sembunyikan';
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
    const more = e.target.closest('.more');
    if (more) {
      const txt = more.previousElementSibling;
      const open = txt.classList.toggle('clip');
      more.textContent = open ? 'selengkapnya' : 'ringkas';
      return;
    }
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
    if (!state.diff) return alert('Jatuhkan dua berkas hasil tarikan dulu untuk bisa membandingkan.');
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
initTake();
tzNote();
