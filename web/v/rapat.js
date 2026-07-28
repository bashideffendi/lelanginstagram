/**
 * Lelang Insta — tampilan "satu layar rapat".
 *
 * Semua angka datang jadi dari harness.js. Berkas ini hanya menyusun tata letak
 * dan memasang dua perilaku kecil: melipat komentar panjang dan menyorot baris
 * pemenang.
 */
import { buildModel, esc, safeUrl, mountSwitcher } from './harness.js';

const m = await buildModel('Asia/Jakarta');
document.getElementById('app').innerHTML = susun(m);
mountSwitcher('rapat');

pasangLipat();
sorotPemenang();

/* ------------------------------------------------------------------ susunan */

function susun(m) {
  return bilahAtas(m) + pita(m) + angka(m) + temuan(m) +
    '<div class="main">' + panelTawaran(m) + panelAkun(m) + '</div>';
}

/** Bilah tipis: nama alat di kiri, ringkasan penting di kanan. */
function bilahAtas(m) {
  const asal = m.source.owner ? esc('@' + m.source.owner) : 'sumber tidak dikenal';
  const url = safeUrl(m.source.url);
  const tautan = url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${asal}</a>` : asal;

  const ringkas = [
    `<b class="num">${m.meta.total}</b> komentar`,
    `<b class="num">${m.meta.users}</b> akun`,
    m.meta.cutoffTime ? `tutup <b class="num">${esc(m.meta.cutoffTime)}</b> ${esc(m.tzShort)}` : '',
    `rentang <b class="num">${esc(m.meta.first)}–${esc(m.meta.last)}</b>`
  ].filter(Boolean);

  return '<header class="top">' +
    '<span class="nama">Lelang Insta</span>' +
    `<span class="asal">${tautan}</span>` +
    '<span class="kanan">' +
    ringkas.map((s, i) => (i ? '<span class="dot">·</span>' : '') + `<span>${s}</span>`).join('') +
    '</span>' +
    '</header>';
}

/** Pita mendatar: jawaban utama — siapa, berapa, jam berapa. */
function pita(m) {
  const w = m.winner;
  if (!w) {
    return '<div class="pita"><span class="cap">Pemenang</span>' +
      '<span class="akun">tidak terbaca</span></div>';
  }
  return '<div class="pita">' +
    '<span class="cap">Pemenang</span>' +
    `<span class="akun">@${esc(w.username)}</span>` +
    `<span class="nilai num">${esc(w.amount)}</span>` +
    `<span class="jam num">${esc(w.time)}</span>` +
    `<span class="ket num">${esc(w.date)} ${esc(m.tzShort)}</span>` +
    (w.rel ? `<span class="ket">${esc(w.rel)}</span>` : '') +
    (w.quote ? `<span class="kutip">${esc(w.quote)}</span>` : '') +
    '</div>';
}

/** Angka ringkas berjajar, dipisah garis tipis vertikal. */
function angka(m) {
  return '<div class="angka">' + m.stats.map((s) =>
    '<div class="sel">' +
    `<div class="n num ${s.tone}">${esc(s.n)}</div>` +
    `<div class="k">${esc(s.k)}</div>` +
    '</div>').join('') + '</div>';
}

/** Kejanggalan, satu baris mendatar. Kalimat pendek saja. */
function temuan(m) {
  return '<div class="temuan">' + m.findings.map((f) =>
    `<div class="t ${f.tone}">` +
    '<span class="bul"></span>' +
    `<span class="p">${esc(f.text)}</span>` +
    (f.sub ? `<span class="s">${esc(f.sub)}</span>` : '') +
    '</div>').join('') + '</div>';
}

/* -------------------------------------------------------------------- tabel */

/** Warna penanda. Ditulis sebagai fungsi supaya aman dipanggil lebih awal. */
function nadaTag(key) {
  if (key === 'lewat-cutoff' || key === 'bid-turun') return 'bad';
  return 'warn';
}

function panelTawaran(m) {
  const baris = m.rows.map((r) => {
    // Penanda dipakai dua kali: kolom sendiri di layar lebar, sisipan di sempit.
    const tanda = (r.isWinner ? '<span class="tag pick">pemenang</span>' : '') +
      r.tags.map((t) => `<span class="tag ${nadaTag(t.key)}">${esc(t.label)}</span>`).join('');

    const kelas = [
      r.isWinner ? 'menang' : '',
      r.isLate ? 'late' : '',
      !r.isLate && r.isSnipe ? 'snipe' : ''
    ].filter(Boolean).join(' ');

    const teks = r.text
      ? `<div class="teks">${esc(r.text)}</div><button class="lipat" type="button" aria-expanded="false">buka</button>`
      : '';

    return `<tr${kelas ? ` class="${kelas}"` : ''} data-menang="${r.isWinner ? 1 : 0}">` +
      `<td class="c-seq num">${esc(r.seq)}</td>` +
      `<td class="c-jam num">${esc(r.time)}</td>` +
      `<td class="c-sel num">${esc(r.gap)}</td>` +
      `<td class="c-akun">${esc(r.user)}${r.isReply ? ' <span class="balas">balasan</span>' : ''}</td>` +
      `<td class="c-nilai num r">${esc(r.amount)}</td>` +
      `<td class="c-teks">${teks}${tanda ? `<div class="sisip">${tanda}</div>` : ''}</td>` +
      `<td class="c-tag">${tanda}</td>` +
      '</tr>';
  }).join('');

  return '<section class="panel">' +
    `<div class="phead">Urutan tawaran <b class="num">${m.rows.length}</b></div>` +
    '<div class="pbody" id="tbody-wrap"><table>' +
    '<thead><tr>' +
    '<th class="c-seq">#</th>' +
    `<th class="c-jam">Jam</th>` +
    '<th class="c-sel">Selisih</th>' +
    '<th class="c-akun">Akun</th>' +
    '<th class="c-nilai r">Nilai</th>' +
    '<th>Komentar</th>' +
    '<th class="c-tag">Tanda</th>' +
    '</tr></thead>' +
    `<tbody>${baris}</tbody></table></div></section>`;
}

function panelAkun(m) {
  const baris = m.accounts.map((a) =>
    `<tr${a.late || a.lateEntrant ? ' class="telat"' : ''}>` +
    `<td class="c-au">${esc(a.user)}` +
    `<span class="jejak num">${esc(a.first)}–${esc(a.last)}` +
    (a.lateEntrant ? ' · masuk telat' : '') +
    (a.late ? ` · ${esc(a.late)} telat` : '') +
    '</span></td>' +
    `<td class="c-an num r">${esc(a.count)}</td>` +
    `<td class="c-am num r">${esc(a.max)}</td>` +
    '</tr>').join('');

  return '<section class="panel">' +
    `<div class="phead">Akun <b class="num">${m.accounts.length}</b></div>` +
    '<div class="pbody"><table>' +
    '<thead><tr>' +
    '<th class="c-au">Akun</th>' +
    '<th class="c-an r">N</th>' +
    '<th class="c-am r">Tertinggi</th>' +
    '</tr></thead>' +
    `<tbody>${baris}</tbody></table></div></section>`;
}

/* ---------------------------------------------------------------- perilaku */

/** Sembunyikan tombol pada komentar yang memang muat dua baris, lalu pasang klik. */
function pasangLipat() {
  // Kolom menyempit saat jendela dikecilkan, sehingga komentar yang tadinya
  // muat jadi terpotong. Tanpa mengukur ulang, tombol bukanya tetap tersembunyi
  // dan teksnya tidak bisa dibuka sama sekali.
  const ukurUlang = () => {
    document.querySelectorAll('.lipat').forEach((btn) => {
      const sel = btn.closest('td');
      const teks = btn.previousElementSibling;
      if (!teks) return;
      if (sel && sel.classList.contains('buka')) { btn.hidden = false; return; }
      btn.hidden = teks.scrollHeight <= teks.clientHeight + 1;
    });
  };
  ukurUlang();

  let tunda;
  window.addEventListener('resize', () => {
    clearTimeout(tunda);
    tunda = setTimeout(ukurUlang, 120);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.lipat');
    if (!btn) return;
    const sel = btn.closest('td');
    const buka = sel.classList.toggle('buka');
    btn.textContent = buka ? 'tutup' : 'buka';
    btn.setAttribute('aria-expanded', String(buka));
  });
}

/** Bawa baris pemenang ke tengah panel tanpa menggeser halaman. */
function sorotPemenang() {
  const wrap = document.getElementById('tbody-wrap');
  const tr = wrap && wrap.querySelector('tr[data-menang="1"]');
  if (!wrap || !tr || wrap.clientHeight >= wrap.scrollHeight) return;
  // Hitung dari posisi layar supaya tidak bergantung pada offsetParent.
  const atas = tr.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
  wrap.scrollTop = Math.max(0, atas - wrap.clientHeight / 2 + tr.offsetHeight / 2);
}
