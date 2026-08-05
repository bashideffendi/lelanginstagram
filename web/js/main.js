import { parseDump, readFileAsDump } from './dump.js';
import { analyze, chronoCompare, fmtRupiah, isAnnouncement } from './analysis.js';
import { diffDumps } from './diff.js';
import {
  browserTz, tzOptions, tzOffsetLabel, fmtDateTime, fmtTime, fmtDate,
  fmtDuration, wallTimeToEpoch, parseClock, maskClock, fmtClock, applyMask
} from './time.js';
import {
  download, sha256Hex, commentsCsv, accountsCsv, diffCsv, summaryText
} from './export.js';
import {
  pingExtension, extractViaExtension, looksLikePostUrl,
  probeServer, extractViaServer, savedKey, saveKey
} from './ext.js';
import { gambarBukti } from './gambar.js';
import * as PantauUI from './pantau-ui.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Alamat hanya boleh http/https. Berkas dump bisa datang dari mana saja —
 * termasuk dari orang lain — dan `javascript:` di dalam href akan berjalan
 * begitu diklik. esc() menutup pelarian atribut, bukan skema.
 */
const safeUrl = (u) => {
  try {
    const p = new URL(String(u), location.href);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : null;
  } catch {
    return null;
  }
};

const state = {
  dumps: [], primary: null, diff: null, isDemo: false,
  tz: browserTz(), cutoff: null, captionGuess: null, grace: 60,
  query: '', includeReplies: true, onlyFlagged: false, tech: false, rulesOpen: false,
  owner: '', sniperMin: 0, hideHost: true, view: 'cek', wrap: false,
  result: null, hash: null, hashToken: 0, canonicalJson: null, guessedCutoff: false,
  // Tawaran terakhir paling atas: itu yang menentukan hasil lelang,
  // dan yang pertama dicari orang saat membuka bukti.
  sort: { chrono: { key: 'seq', dir: -1 }, accounts: { key: 'count', dir: -1 } }
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
    picks.push({ label: fmtTime(state.captionGuess.epoch, state.tz), sub: 'dari caption', epoch: state.captionGuess.epoch });
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
    timeIn.value = state.cutoff != null ? fmtTime(state.cutoff, state.tz) : '';
  }

  // Keterangan tebakan menempel di kolomnya, tidak jadi pita sendiri.
  if (state.guessedCutoff && state.cutoff != null) {
    $('cutoffTime').title = `Ditebak ${state.guessedCutoff} dari caption postingan — perbaiki kalau salah`;
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

/**
 * Tebak jam tutup dari caption postingan.
 *
 * Dua jebakan yang harus dihindari, keduanya menghasilkan tuduhan palsu:
 *
 * 1. Menjangkarkan jam ke tanggal komentar TERAKHIR. Lelang yang tutup 21.00
 *    tapi masih diramaikan sampai lewat tengah malam akan menaruh cutoff di
 *    hari berikutnya — telat 24 jam, dan semua pelanggaran raib.
 * 2. Mengambil angka pertama sesudah kata "close". Caption seperti
 *    "CLOSED YA! kelipatan bid 2.50, tutup 21.00" akan memilih 02:50.
 *
 * Karena itu setiap angka jam dicoba pada setiap hari yang benar-benar ada
 * komentarnya, lalu dipilih yang paling masuk akal sebagai penutup lelang.
 */
function guessCutoff(caption, comments, tz) {
  if (!caption || !comments.length) return null;

  const re = /(?<!\d)([01]?\d|2[0-3])[.:]([0-5]\d)(?!\d)/g;
  const found = [];
  let m;
  while ((m = re.exec(caption)) !== null) found.push({ h: +m[1], mi: +m[2], at: m.index });
  if (!found.length) return null;

  // Angka yang menempel pada kata penutupan lebih dipercaya, tapi jaraknya
  // dipersempit supaya harga atau kelipatan bid tidak ikut tersedot.
  const kw = /(clos\w*|tutup|\bcd\b|\bco\b|berakhir|selesai)/gi;
  const berlabel = new Set();
  let k;
  while ((k = kw.exec(caption)) !== null) {
    for (const f of found) {
      if (f.at >= k.index && f.at - (k.index + k[0].length) <= 12) berlabel.add(f);
    }
  }

  const first = Math.min(...comments.map((c) => c.created_at));
  const last = Math.max(...comments.map((c) => c.created_at));

  // Hari-hari yang punya komentar, ditambah sehari sesudah yang terakhir
  // untuk lelang yang memang tutup lewat tengah malam.
  const hari = [];
  for (const c of comments) {
    const d = fmtDate(c.created_at, tz);
    if (!hari.includes(d)) hari.push(d);
  }
  const besok = fmtDate(last + 86400, tz);
  if (!hari.includes(besok)) hari.push(besok);

  const kandidat = [];
  for (const f of found) {
    for (const d of hari) {
      const [dd, mm, yy] = d.split('/').map(Number);
      const epoch = wallTimeToEpoch(yy, mm, dd, f.h, f.mi, 0, tz);
      // Penutup lelang harus berada di dalam rentang komentar, atau sedikit
      // sesudahnya — bukan sebelum tawaran pertama masuk.
      if (epoch < first || epoch > last + 6 * 3600) continue;
      kandidat.push({ f, epoch, berlabel: berlabel.has(f) });
    }
  }
  if (!kandidat.length) return null;

  /*
   * Yang berlabel menang, lalu yang PALING AWAL — bukan yang paling dekat
   * dengan komentar terakhir.
   *
   * Ini jebakan yang komentar fungsi ini sendiri klaim sudah dicegah, padahal
   * belum. Kalau obrolan berlanjut ke hari berikutnya, hari 'besok' ikut jadi
   * kandidat, dan "paling dekat dengan komentar terakhir" memilih penutup yang
   * telat 24 jam. Akibatnya setiap tawaran yang masuk sesudah lelang tutup
   * terlihat masih di dalam waktu — seluruh pelanggaran raib, dan berkas
   * buktinya justru membenarkan orang yang mau kamu sanggah.
   *
   * Penutup lelang adalah kemunculan PERTAMA jam itu yang tidak mendahului
   * tawaran terakhir yang masuk akal, bukan yang terakhir.
   */
  kandidat.sort((a, b) => {
    if (a.berlabel !== b.berlabel) return a.berlabel ? -1 : 1;
    return a.epoch - b.epoch;
  });

  const pilih = kandidat[0];
  return {
    epoch: pilih.epoch,
    label: `${String(pilih.f.h).padStart(2, '0')}.${String(pilih.f.mi).padStart(2, '0')}`
  };
}

// ================================================================ muat

function showError(msg) {
  $('loaderr').textContent = msg;
  $('loaderr').classList.remove('hidden');
}

/**
 * Dua pekerjaan berbeda dalam satu aplikasi: memeriksa hasil lelang yang sudah
 * lewat, dan memantau lelang yang belum tutup. Keduanya berbagi mesin penarik
 * komentar yang sama, jadi tidak ada yang disalin.
 */
/**
 * Halaman yang sedang dibuka ditulis ke alamat (#pantau).
 *
 * Tanpa ini, memuat ulang halaman Pantauan selalu melempar balik ke Cek
 * pemenang — dan memuat ulang itu justru yang paling sering dilakukan di
 * halaman pantauan, karena di situlah keadaan lelang diperbarui. Menaruhnya
 * di alamat sekaligus membuat tombol maju-mundur peramban bekerja seperti
 * yang orang harapkan, dan halaman pantauan bisa ditandai (bookmark).
 */
const VIEW_SAH = new Set(['cek', 'pantau']);

/** Halaman yang diminta alamat. Nama asing diabaikan — alamat bisa dari mana saja. */
function dariAlamat() {
  const n = location.hash.replace(/^#/, '');
  return VIEW_SAH.has(n) ? n : 'cek';
}

function pilihView(nama, { tulisAlamat = true } = {}) {
  state.view = nama;
  if (tulisAlamat) {
    const tujuan = nama === 'cek' ? ' ' : '#' + nama;
    if (location.hash !== (nama === 'cek' ? '' : '#' + nama)) {
      history.replaceState(null, '', tujuan);
    }
  }
  document.querySelectorAll('#nav-utama button').forEach((b) =>
    b.classList.toggle('on', b.dataset.view === nama));

  const cek = nama === 'cek';
  $('pantau').classList.toggle('hidden', cek);
  $('landing').classList.toggle('hidden', !cek || !!state.primary);
  $('app').classList.toggle('hidden', !cek || !state.primary);
  $('tabs').classList.toggle('hidden', !cek || !state.primary);
  $('reset').classList.toggle('hidden', !cek || !state.primary);

  if (!cek) PantauUI.render();
  PantauUI.mulaiDetak(!cek);
  window.scrollTo(0, 0);
}

function pilihTab(nama) {
  document.querySelectorAll('.tabs button').forEach((x) =>
    x.classList.toggle('on', x.dataset.tab === nama));
  document.querySelectorAll('.tab').forEach((x) =>
    x.classList.toggle('on', x.id === 'tab-body-' + nama));
}

async function loadFiles(files) {
  $('loaderr').classList.add('hidden');
  try {
    const parsed = [];
    for (const f of [...files].slice(0, 2)) parsed.push(await readFileAsDump(f));
    state.isDemo = false;                    // berkas asli, bukan peragaan lagi
    activate(parsed);
  } catch (e) {
    showError(e.message);
    // Galat pada halaman hasil tidak terlihat kalau kotaknya tertinggal di
    // halaman awal, jadi pastikan pengguna tetap membacanya.
    if ($('landing').classList.contains('hidden')) alert(e.message);
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

  // Kalau tab "Yang dihapus" sedang terbuka lalu data baru tidak punya
  // pembanding, tabnya menghilang tapi isinya tertinggal di layar.
  if (!state.diff && $('tab-body-diff').classList.contains('on')) pilihTab('chrono');

  $('democue').innerHTML = state.isDemo
    ? '<div class="democue"><b>Ini lelang contoh, bukan data asli.</b> ' +
      'Angkanya dibuat-buat supaya kamu bisa melihat cara kerjanya. ' +
      'Klik &ldquo;Cek lelang lain&rdquo; di kanan atas untuk memakai data sungguhan.</div>'
    : '';

  // Instagram tidak selalu memberi tahu pemilik postingan. Kalau begitu,
  // penulis komentar aturan lelang praktis pasti penyelenggaranya —
  // tidak masuk akal peserta yang mengumumkan harga awal dan kelipatan.
  const dariIg = state.primary.source?.owner_username || '';
  const dariAturan = (() => {
    const p = state.primary.comments
      .filter((c) => c.username && isAnnouncement(c.text))
      .sort((a, b) => a.created_at - b.created_at)[0];
    return p ? p.username : '';
  })();

  state.owner = dariIg || dariAturan || '';
  state.ownerSource = dariIg ? 'ig' : (dariAturan ? 'aturan' : 'none');

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

/**
 * Sidik jari dihitung atas teks yang PERSIS SAMA dengan berkas yang bisa
 * diunduh lewat tombol "Data asli (JSON)". Sebelumnya ia dihitung atas
 * bentuk lain, sehingga tidak cocok dengan berkas mana pun — sidik jari yang
 * tidak bisa dicocokkan orang lain tidak ada gunanya sebagai bukti.
 */
async function computeHash() {
  const token = ++state.hashToken;
  state.hash = null;
  state.canonicalJson = JSON.stringify(state.primary.original, null, 2);
  $('hash').textContent = 'menghitung…';

  let hash = null;
  try { hash = await sha256Hex(state.canonicalJson); } catch { hash = null; }

  // Data lain mungkin sudah dimuat selagi ini berjalan.
  if (token !== state.hashToken) return;

  state.hash = hash;
  $('hash').textContent = hash || 'tidak tersedia';
  if (state.result) renderEvidence();
}

// ================================================================ gambar ulang

function render() {
  state.sniperMin = Math.max(0, Math.min(120, +$('sniper').value || 0));
  state.includeReplies = $('reps').checked;
  state.hideHost = $('nohost').checked;
  state.onlyFlagged = $('onlyflag').checked;
  state.tech = $('tech').checked;
  state.wrap = $('wrap').checked;
  state.query = $('q').value.trim().toLowerCase();

  state.result = analyze(state.primary.comments, {
    cutoffEpoch: state.cutoff,
    graceSec: state.grace,
    includeReplies: state.includeReplies,
    ownerUsername: state.owner || null,
    sniperSec: state.sniperMin * 60,
    captionText: state.primary.source?.caption || null
  });

  tzNote();
  syncCutoffUI();
  renderPeringatanTarikan();
  kunciEksporKalauBolong();
  renderProof();
  renderCaption();          // butuh state.result untuk cadangan komentar aturan
  renderChips();
  renderChrono();
  renderAccounts();
  renderDiff();
  renderLegend();
  renderEvidence();
}

/** Dipanggil ulang saat sidik jari selesai dihitung, karena datang belakangan. */
function renderEvidence() {
  if (!state.result) return;
  $('sumtext').textContent = summaryText(
    state.result.summary, state.primary.source, state.tz, state.hash);
}

/**
 * Aturan lelang dari caption postingan.
 *
 * Ini bagian dari bukti: di situlah penyelenggara menuliskan jam tutup, harga
 * awal, dan kelipatannya. Terlipat sejak awal supaya tidak mendorong kartu
 * bukti keluar layar, tapi tetap satu klik dari pandangan.
 */
function renderCaption() {
  const cap = state.primary.source?.caption;
  const owner = state.primary.source?.owner_username;

  let teks = cap;
  let asal = owner ? 'Caption postingan &middot; @' + esc(owner) : 'Caption postingan';

  // Caption tidak selalu ikut tertarik. Komentar aturan lelang memuat
  // keterangan yang sama, jadi ia dipakai sebagai gantinya — dengan label
  // yang jujur, supaya tidak disangka caption asli.
  if (!teks) {
    const p = (state.result?.rows || []).find((r) => r.isAnnouncement || r.isOwner);
    if (p && String(p.text || '').length > 60) {
      teks = p.text;
      asal = 'Aturan lelang, dari komentar' + (p.username ? ' @' + esc(p.username) : '');
    }
  }
  if (!teks) { $('caption').innerHTML = ''; return; }

  // Tanpa tombol lipat: isinya sudah dibatasi tinggi dan bergulir sendiri,
  // jadi ia tidak pernah mendorong apa pun keluar layar.
  $('caption').innerHTML =
    '<section class="rules">' +
    '<div class="rules-top"><span class="label">' + asal + '</span>' +
    '<span class="rules-scroll">gulir untuk baca semua</span></div>' +
    '<div class="rules-body">' + esc(teks) + '</div>' +
    '<div class="rules-fade"></div>' +
    '</section>';

  // Isi yang terpotong tanpa tanda apa pun tidak terbaca sebagai bisa digulir,
  // apalagi di layar sentuh yang tidak menampilkan batang gulir.
  const body = $('caption').querySelector('.rules-body');
  const fade = $('caption').querySelector('.rules-fade');
  const kartu = $('caption').querySelector('.rules');
  const tandai = () => {
    const bisaGulir = body.scrollHeight > body.clientHeight + 2;
    const diUjung = body.scrollTop + body.clientHeight >= body.scrollHeight - 2;
    kartu.classList.toggle('ada-gulir', bisaGulir);
    // Pudarnya disetel langsung, bukan lewat kelas: nilainya jadi pasti dan
    // bisa diperiksa, tidak bergantung pada urutan aturan gaya.
    fade.style.opacity = bisaGulir && !diUjung ? '1' : '0';
  };
  body.addEventListener('scroll', tandai, { passive: true });
  window.addEventListener('resize', tandai);

  // Tinggi isi baru pasti setelah tata letak dan huruf selesai; sekali di
  // bingkai berikutnya saja terlalu cepat, jadi diukur ulang saat berubah.
  requestAnimationFrame(tandai);
  if (window.ResizeObserver) new ResizeObserver(tandai).observe(body);
  document.fonts?.ready?.then(tandai);
}

/**
 * Gambar bukti dibuat saat diminta, karena menggambar kanvas tidak murah —
 * dan sebagian besar orang tidak selalu membutuhkannya.
 */
async function buatGambar(tombol) {
  const semula = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = 'Menggambar…';
  try {
    // Pastikan hurufnya sudah termuat, kalau tidak kanvas memakai huruf cadangan.
    if (document.fonts?.ready) await document.fonts.ready;
    return await gambarBukti({
      result: state.result, primary: state.primary, diff: state.diff,
      tz: state.tz, tzShort: tzShort(state.result.summary.first),
      hash: state.hash, sniperMin: state.sniperMin
    });
  } finally {
    tombol.disabled = false;
    tombol.textContent = semula;
  }
}

/** Kartu bukti — bagian yang difoto layar dan dikirim ke penyelenggara. */
/**
 * Peringatan kalau penarikannya tidak lengkap.
 *
 * ig-core mencatat tiap kegagalan ke stats.errors — halaman komentar yang
 * gagal, utas balasan yang ditolak, paginasi yang berhenti di tengah. Sampai
 * sekarang tidak ada satu baris pun yang membacanya, jadi tarikan bolong
 * tampil persis seperti tarikan utuh: tabelnya rapi, pemenangnya tercetak,
 * dan tidak ada yang memberi tahu bahwa sebagian komentar tidak pernah
 * sampai. Itu berbahaya justru karena hasilnya meyakinkan.
 *
 * Satu utas balasan yang gagal bisa berisi tawaran tertinggi.
 */
function tarikanBolong() {
  const st = state.primary?.stats;
  const errs = Array.isArray(st?.errors) ? st.errors : [];
  const partial = errs.some((e) => e && e.partial);
  return { errs, partial, ada: errs.length > 0 };
}

function renderPeringatanTarikan() {
  const kotak = $('tarikstat');
  if (!kotak) return;

  const { errs, partial } = tarikanBolong();
  if (!errs.length) { kotak.innerHTML = ''; return; }

  const rinci = errs.slice(0, 4).map((e) =>
    `<li>${esc(e.stage || 'tarik')}: ${esc(e.message || String(e))}</li>`).join('');

  kotak.innerHTML =
    `<div class="alert bad"><b>Penarikan ini tidak lengkap — ${errs.length} bagian gagal diambil.</b>
      <ul class="tarik-galat">${rinci}${errs.length > 4 ? `<li>dan ${errs.length - 4} lagi</li>` : ''}</ul>
      <p>Komentar yang tidak terambil bisa berisi tawaran tertinggi, jadi hasil di bawah
      <b>belum layak dipakai sebagai bukti</b>. Tarik ulang lelangnya.
      ${partial ? '<b>Sebagian halaman komentar berhenti di tengah.</b>' : ''}</p></div>`;
}

/**
 * Kunci ekspor selama tarikannya bolong.
 *
 * Menghalangi lebih baik daripada memperingatkan: berkas bukti dipakai
 * berbulan kemudian, jauh dari layar tempat peringatannya muncul, dan tidak
 * ada apa pun di dalam berkas itu yang mengingatkan bahwa isinya tidak utuh.
 */
function kunciEksporKalauBolong() {
  const { ada } = tarikanBolong();
  for (const id of ['dlimg', 'copyimg', 'copysum', 'dlsum', 'dlchrono', 'dlacc', 'dldiff', 'dlraw']) {
    const el = $(id);
    if (!el) continue;
    el.disabled = ada;
    el.title = ada ? 'Penarikan tidak lengkap — tarik ulang dulu sebelum dipakai jadi bukti.' : '';
  }
}

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
    // Kutipan hanya berguna kalau komentarnya memuat lebih dari angkanya
    // sendiri. Kalau isinya persis "750", ia cuma mengulang nilai di atasnya.
    const polos = String(w.text || '').replace(/[^\dA-Za-z]/g, '');
    const angka = String(w.bidMatched || '').replace(/[^\dA-Za-z]/g, '');
    if (polos && polos !== angka) {
      out.push(`<div class="pcard-quote">${esc(w.text)}</div>`);
    }
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
  if (s.sniperIlegal > 0) {
    flags.push(['bad', `${s.sniperIlegal} tawaran masuk di sniper zone tanpa berhak.`,
      'Akunnya belum pernah menawar sebelum zona itu dimulai.']);
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
  const url = safeUrl(src.url);
  if (url) meta.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">buka postingannya</a>`);
  out.push(`<div class="pcard-meta">${meta.join('')}</div>`);

  out.push('<div class="pcard-act">' +
    '<button class="btn solid" id="proofimg">Simpan gambar bukti</button>' +
    '<button class="btn" id="proofcopy">Salin ringkasan</button>' +
    '<button class="btn" id="proofjump">Lihat urutan lengkap</button>' +
    '</div>');

  out.push('</div>');

  // Cara membaca yang dipakai — skala angka dan sniper zone — memang harus
  // dinyatakan, tapi tempatnya satu baris kecil, bukan pita kuning berjajar.
  const cara = [];
  const sn = s.sniper;
  if (sn && sn.aktif) {
    cara.push(`sniper zone ${state.sniperMin} menit sejak ` +
      `<b>${fmtTime(sn.mulai, state.tz)}</b>` +
      (sn.pelanggar.length ? ` — ${sn.pelanggar.length} tawaran tidak berhak` : ''));
  }
  if (s.bidScale && s.bidScale !== 1) {
    cara.push(`angka tanpa satuan dibaca <b>${s.bidScale === 1e6 ? 'jutaan' : 'ribuan'}</b>`);
  }
  if (cara.length) {
    out.push(`<p class="pcard-how">Cara baca: ${cara.join(' &middot; ')}. ` +
      '<button class="link" id="howmore">Rinciannya</button></p>');
  }

  $('proof').innerHTML = out.join('');

  if ($('howmore')) {
    $('howmore').onclick = () => {
      const p = [];
      if (sn && sn.aktif) {
        p.push('Sniper zone ' + state.sniperMin + ' menit: ' +
          fmtTime(sn.mulai, state.tz) + ' sampai ' + fmtTime(s.cutoff, state.tz));
        p.push('  Yang boleh menawar di dalamnya hanya akun yang sudah pernah');
        p.push('  menawar sebelum zona dimulai.');
        if (sn.pelanggar.length) {
          p.push('  Tidak berhak:');
          for (const x of sn.pelanggar) {
            p.push('    ' + fmtTime(x.created_at, state.tz) + '  @' + (x.username || '?') +
              '  Rp' + fmtRupiah(x.bid));
          }
        } else {
          p.push('  Tidak ada pelanggaran.');
        }
      }
      if (s.bidScale && s.bidScale !== 1) {
        const c = state.result.rows.find((r) => r.bidScaled);
        p.push('Skala angka telanjang: x' + fmtRupiah(s.bidScale) +
          (c ? ' — "' + c.bidMatched + '" jadi Rp' + fmtRupiah(c.bid) : ''));
        p.push('  Diambil dari tawaran lain yang menyebut satuannya.');
        p.push('  Teks asli tiap komentar tetap tampil apa adanya di tabel.');
      }
      alert(p.join('\n'));
    };
  }
  $('proofcopy').onclick = () => copy($('sumtext').textContent, $('proofcopy'));
  $('proofimg').onclick = async () => {
    const blob = await buatGambar($('proofimg'));
    download(`${baseName()}_bukti.png`, blob, 'image/png');
  };
  $('proofjump').onclick = () => {
    document.querySelector('.tabs button[data-tab="chrono"]').click();
    $('tab-body-chrono').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

/** Nol dibiarkan kelabu; hanya angka yang berarti sesuatu yang diberi warna. */
function chip(n, k, cls = '') {
  return `<div class="chip ${cls}"><div class="n">${n}</div><div class="k">${k}</div></div>`;
}

/**
 * Hanya angka yang benar-benar mengatakan sesuatu yang dapat kotak sendiri.
 * Deretan nol memenuhi layar tanpa memberi tahu apa pun, dan justru membuat
 * satu temuan sungguhan tenggelam di antaranya.
 */
function renderChips() {
  const s = state.result.summary;
  const out = [];

  if (s.cutoff != null && s.lateBids > 0) out.push(chip(s.lateBids, 'Tawaran telat', 'bad'));
  if (s.snipe > 0) out.push(chip(s.snipe, 'Detik terakhir', 'warn'));
  if (s.tieRows > 0) out.push(chip(s.tieRows, 'Detik kembar', 'warn'));
  if (s.bidDown > 0) out.push(chip(s.bidDown, 'Nilai turun', 'bad'));
  if (state.diff && state.diff.deleted.length) {
    out.push(chip(state.diff.deleted.length, 'Dihapus', 'bad'));
  }

  out.push(chip(s.parsedBids, 'Tawaran', 'on'));
  out.push(chip(s.users, 'Peserta', 'on'));
  out.push(chip(fmtDuration(s.span), 'Lama lelang', 'on'));

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
  beruntun: ['burst', () => 'beruntun', 'Akun yang sama berkomentar lagi dalam 5 detik.'],
  'sniper-ilegal': ['late', () => 'sniper zone',
    'Menawar di dalam sniper zone padahal akunnya belum pernah menawar sebelum ' +
    'zona itu dimulai. Tawaran ini tidak berhak menang.'],
  pengumuman: ['host', () => 'pengumuman',
    'Komentar aturan lelang, dikenali dari bentuknya: panjang, bergaris pemisah, ' +
    'dan memuat istilah seperti OB, kelipatan, atau BIN. Angkanya bukan tawaran.'],
  penyelenggara: ['host', () => 'penyelenggara',
    'Komentar pemilik postingan. Angkanya tidak dihitung sebagai tawaran, karena ' +
    'pengumuman aturan lelang hampir selalu memuat angka seperti harga awal dan kelipatan.']
};

function tags(r) {
  return r.flags.map((f) => {
    const t = TAGS[f];
    return t ? `<span class="tag ${t[0]}">${esc(t[1](r))}</span>` : '';
  }).join('');
}

function renderLegend() {
  // Nama tanda diambil dari sumber yang sama dengan tabelnya. Daftar nama
  // terpisah pernah ketinggalan saat tanda baru ditambahkan, dan keterangannya
  // menampilkan "undefined".
  const contoh = { late: 5, snipe: 5, tie: 1, tieSize: 2, tieIndex: 1 };
  $('legend').innerHTML = Object.values(TAGS)
    .map(([cls, nama, desc]) =>
      `<div><span class="tag ${cls}">${esc(nama(contoh))}</span> ${desc}</div>`)
    .join('');
}

function visibleRows() {
  let rows = state.result.rows;
  // Komentar penyelenggara dan pengumuman aturan bukan tawaran, jadi secara
  // bawaan tidak ikut memenuhi daftar. Tetap bisa dimunculkan untuk diperiksa.
  if (state.hideHost) rows = rows.filter((r) => !r.isOwner && !r.isAnnouncement);
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
  return '<td class="msg" data-l="Komentar">' +
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
  // data-l dipakai tampilan layar kecil: di sana tabel berubah jadi kartu
  // bertumpuk, dan tiap nilai harus membawa nama kolomnya sendiri.
  return `<tr class="${cls}">` +
    `<td class="n dim" data-l="Ke-">${lead || r.seq}</td>` +
    `<td class="clock" data-l="Jam">${fmtTime(r.created_at, state.tz)}</td>` +
    `<td class="n dim" data-l="Selisih">${lead ? '—' : (r.gap != null ? fmtDuration(r.gap) : '—')}</td>` +
    `<td class="who" data-l="Akun">${esc(r.username || '—')}${r.is_reply ? ' <span class="dim">(balasan)</span>' : ''}</td>` +
    // Angka di komentar penyelenggara bukan tawaran, jadi jangan ditampilkan
    // seolah-olah tawaran — itu yang tadinya membuatnya tampak sebagai pemenang.
    `<td class="money" data-l="Nilai">${r.bid != null && !r.isOwner
      ? 'Rp' + fmtRupiah(r.bid) : '<span class="dim">—</span>'}</td>` +
    (state.tech
      ? `<td class="n dim" data-l="Naik">${r.increment != null ? (r.increment > 0 ? '+' : '') + fmtRupiah(r.increment) : ''}</td>` +
        `<td class="mn" data-l="Jam mentah">${r.created_at}</td>`
      : '') +
    `<td data-l="Tanda">${tags(r)}</td>` +
    msgCell(r) +
    (state.tech ? `<td class="mn" data-l="Nomor komentar">${esc(r.pk)}</td>` : '') +
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

  // Garis penutupan: pembatas antara tawaran yang masih sah dan yang telat.
  // Hanya berarti kalau tabelnya memang urut waktu — kalau diurutkan menurut
  // nama akun atau nilai, letaknya tidak punya makna apa pun.
  const cutoff = state.result.summary.cutoff;
  const urutWaktu = state.sort.chrono.key === 'seq' || state.sort.chrono.key === 'created_at';
  const posisiTutup = cutoff != null && urutWaktu
    ? (state.sort.chrono.dir === -1
        ? rows.filter((r) => r.created_at > cutoff).length     // terbaru di atas
        : rows.filter((r) => r.created_at <= cutoff).length)   // terlama di atas
    : -1;

  const barisTutup = () =>
    `<tr class="closed"><td colspan="${span}">` +
    `Lelang ditutup ${fmtTime(cutoff, state.tz)} ${tzShort(cutoff)}</td></tr>`;

  // Batas mulainya sniper zone: di dalamnya hanya penawar lama yang berhak.
  const sn = state.result.summary.sniper;
  const posisiZona = sn && sn.aktif && urutWaktu
    ? (state.sort.chrono.dir === -1
        ? rows.filter((r) => r.created_at > sn.mulai).length
        : rows.filter((r) => r.created_at < sn.mulai).length)
    : -1;

  const barisZona = () =>
    `<tr class="zone"><td colspan="${span}">` +
    `Sniper zone mulai ${fmtTime(sn.mulai, state.tz)} &middot; ` +
    'hanya akun yang sudah menawar sebelum ini yang berhak</td></tr>';

  let prevDay = null;
  rows.forEach((r, i) => {
    if (i === posisiTutup) { out.push(barisTutup()); prevDay = null; }
    if (i === posisiZona) { out.push(barisZona()); prevDay = null; }

    const day = fmtDate(r.created_at, state.tz);
    if (day !== prevDay) {
      out.push(`<tr class="day"><td colspan="${span}">${day}</td></tr>`);
      prevDay = day;
    }
    out.push(rowHtml(r, span, w && r.pk === w.pk ? 'pinned' : ''));
  });
  if (posisiTutup === rows.length) out.push(barisTutup());
  if (posisiZona === rows.length) out.push(barisZona());

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
  if (!d.sameSource && !d.sumberTidakDikenal) {
    info.push('<p class="alert bad">Dua berkas ini dari postingan yang berbeda, ' +
      'jadi perbandingannya tidak berarti apa-apa.</p>');
  } else if (d.sumberTidakDikenal) {
    info.push('<p class="alert warn">Salah satu berkas tidak mencantumkan postingan asalnya, ' +
      'jadi Lelang Insta tidak bisa memastikan keduanya dari lelang yang sama. ' +
      'Periksa sendiri sebelum memakai hasil ini sebagai bukti.</p>');
  }
  if (d.waktuTidakPasti) {
    info.push('<p class="alert warn">Salah satu berkas tidak mencantumkan waktu penarikan, ' +
      'jadi urutan mana yang lebih dulu hanya mengikuti urutan kamu menjatuhkannya. ' +
      'Kalau terbalik, komentar baru akan salah dilaporkan sebagai dihapus.</p>');
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
  // Satu penangan untuk seluruh halaman. Tanpa preventDefault di mana pun
  // berkas dijatuhkan, browser akan meninggalkan halaman ini dan membuka
  // JSON mentahnya — pekerjaan yang sedang berjalan hilang.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
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

  for (const el of ['reps', 'nohost', 'onlyflag', 'tech', 'wrap', 'sniper']) $(el).onchange = render;
  $('sniper').addEventListener('input', render);
  $('q').oninput = render;

  // Zona waktu hanya mengubah cara menampilkan; momen tutupnya tidak bergeser.
  $('tz').onchange = () => { state.tz = $('tz').value; render(); };

  $('cutoffTime').addEventListener('input', (e) => {
    applyMask(e.target);
    readCutoffFromUI();
    render();
  });
  // Saat fokus lepas, kolom dikembalikan ke nilai yang benar-benar dipakai —
  // lengkap sampai detik, dan tanda merahnya ikut hilang.
  $('cutoffTime').addEventListener('blur', () => {
    readCutoffFromUI();
    const c = parseClock($('cutoffTime').value);
    if (c) $('cutoffTime').value = fmtClock(c.h, c.mi, c.sec);
    $('cutoffTime').classList.remove('bad');
    render();
  });
  $('cutoffDate').addEventListener('change', () => { readCutoffFromUI(); render(); });

  $('legendtoggle').onclick = () => {
    const l = $('legend');
    l.classList.toggle('hidden');
    $('legendtoggle').textContent = l.classList.contains('hidden') ? 'Arti tanda' : 'Sembunyikan';
  };

  document.querySelectorAll('#tabs button').forEach((b) => {
    b.onclick = () => pilihTab(b.dataset.tab);
  });
  document.querySelectorAll('#nav-utama button').forEach((b) => {
    b.onclick = () => pilihView(b.dataset.view);
  });

  window.addEventListener('hashchange', () => pilihView(dariAlamat(), { tulisAlamat: false }));

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
  // Teks yang sama persis dengan yang disidikjarikan, supaya penerima bisa
  // menghitung ulang SHA-256 berkas ini dan mendapat angka yang identik.
  $('dlraw').onclick = () =>
    download(`${baseName()}_asli.json`,
      state.canonicalJson ?? JSON.stringify(state.primary.original, null, 2),
      'application/json');
  $('dlimg').onclick = async () => {
    const blob = await buatGambar($('dlimg'));
    download(`${baseName()}_bukti.png`, blob, 'image/png');
    $('imgprev').innerHTML =
      `<img class="imgprev" src="${URL.createObjectURL(blob)}" alt="Pratinjau gambar bukti">`;
  };

  $('copyimg').onclick = async () => {
    const blob = await buatGambar($('copyimg'));
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      const b = $('copyimg');
      b.textContent = 'Tersalin';
      setTimeout(() => { b.textContent = 'Salin gambar'; }, 1400);
    } catch {
      // Sebagian browser menolak menyalin gambar; unduh saja supaya tetap dapat.
      download(`${baseName()}_bukti.png`, blob, 'image/png');
    }
  };

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

/**
 * Pantauan memakai mesin yang sudah ada lewat titipan ini, bukan salinannya:
 * satu jalur penarikan, satu penebak jam tutup, satu tempat yang perlu
 * diperbaiki kalau Instagram berubah.
 */
function initPantauan() {
  PantauUI.initPantau({
    tz: () => state.tz,
    unduh: download,
    linkSah: looksLikePostUrl,

    tarik: async (url, onProgress) => {
      if (!extVersion) extVersion = await pingExtension();
      if (extVersion) return extractViaExtension(url, onProgress || (() => {}));

      if (serverState !== 'ready') serverState = await probeServer(savedKey());
      if (serverState === 'ready') return extractViaServer(url, savedKey());

      throw new Error(
        'Belum ada cara penarikan yang siap. Pasang extension Lelang Insta, ' +
        'atau isi kunci mode server di halaman Cek pemenang.'
      );
    },

    hitungTutup: (caption, comments) => guessCutoff(caption, comments, state.tz),

    // Penanda extension dipasang lewat atribut oleh bridge.js sebelum ping
    // dijawab, jadi bisa ditanya seketika tanpa menunggu.
    punyaExtension: () => !!extVersion ||
      document.documentElement.hasAttribute('data-ketok-ext'),

    tampilPantau: () => state.view === 'pantau',

    /**
     * Buka halaman analisis. Kalau hasil tarikannya sudah ada, dipakai
     * langsung — tidak masuk akal menembak Instagram lagi untuk data yang
     * baru saja diambil, apalagi ada batas laju.
     */
    bukaAnalisis: (url, dump, item) => {
      pilihView('cek');
      if (dump) {
        state.isDemo = false;
        activate([parseDump(dump, 'dari pantauan')]);
        // Jam tutup dan sniper zone yang sudah kamu tetapkan di pantauan
        // ikut terbawa, bukan ditebak ulang dari caption.
        if (item?.closeAt != null) {
          state.cutoff = item.closeAt;
          state.guessedCutoff = false;
        }
        if (item?.sniperMin) {
          state.sniperMin = item.sniperMin;
          $('sniper').value = String(item.sniperMin);
        }
        render();
        return;
      }
      $('iglink').value = url || '';
      runTake();
    }
  });
  PantauUI.render();
}

initTz();
initBookmarklet();
wire();
wireHandoff();
initTake();
initPantauan();
tzNote();

/*
 * Pemulihan halaman dari alamat dilakukan PALING AKHIR.
 *
 * pilihView('pantau') memanggil PantauUI.render(), dan render butuh mesin yang
 * baru dititipkan oleh initPantauan(). Sebelumnya baris ini ada di tengah
 * penyiapan: memuat ulang di #pantau membuat render dipanggil sebelum
 * mesinnya ada, penyiapannya berhenti di situ, dan sisanya — termasuk
 * initPantauan itu sendiri — tidak pernah jalan. Hasilnya halaman putih,
 * persis di satu-satunya keadaan yang perbaikan alamat ini mau tolong.
 */
pilihView(dariAlamat(), { tulisAlamat: false });
