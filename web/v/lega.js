/**
 * Tampilan "Lega & tenang".
 *
 * Semua angka sudah jadi dari harness. Berkas ini hanya menyusun tata letak
 * dan memasang satu perilaku: melipat komentar yang kepanjangan.
 */
import { buildModel, esc, mountSwitcher } from './harness.js';

const m = await buildModel('Asia/Jakarta');
document.getElementById('app').innerHTML = susun(m);
mountSwitcher('lega');

/* ---------- lipat komentar ----------
   Tombol hanya muncul kalau teksnya memang terpotong, jadi tidak ada tombol
   sia-sia di baris pendek. Diukur ulang saat lebar berubah: kolom komentar
   ikut menyempit, jadi jumlah baris bisa berubah. */
function segarkanLipat() {
  document.querySelectorAll('.cmt').forEach((box) => {
    const p = box.querySelector('p');
    const btn = box.querySelector('.lipat');
    if (!p || !btn) return;
    if (p.classList.contains('buka')) return;   // sedang dibuka, jangan disembunyikan
    btn.hidden = p.scrollHeight - p.clientHeight <= 2;
  });
}

segarkanLipat();
addEventListener('load', segarkanLipat);

let ukurUlang;
addEventListener('resize', () => {
  clearTimeout(ukurUlang);
  ukurUlang = setTimeout(segarkanLipat, 150);
});

document.getElementById('app').addEventListener('click', (e) => {
  const btn = e.target.closest('.lipat');
  if (!btn) return;
  const p = btn.parentElement.querySelector('p');
  const buka = p.classList.toggle('buka');
  btn.textContent = buka ? 'tutup' : 'selengkapnya';
  btn.setAttribute('aria-expanded', String(buka));
});

/* ============================================================
   Penyusun
   ============================================================ */

function susun(m) {
  return layarPertama(m) + ringkasan(m) + urutan(m) + akun(m) + sumber(m);
}

/** Layar pertama: satu pernyataan, sisanya ruang kosong. */
function layarPertama(m) {
  const w = m.winner;

  const inti = w
    ? `<p class="ovl">Pemenang sah</p>
       <h1 class="hero-name"><span class="hero-at">@</span>${esc(w.username)}</h1>
       <p class="hero-amt">${esc(w.amount)}</p>
       ${w.quote ? `<p class="hero-quote">&ldquo;${esc(w.quote)}&rdquo;</p>` : ''}
       <p class="hero-when">
         <b>${esc(w.time)}</b> ${esc(m.tzShort)}
         <small>${esc(w.date)}${w.rel ? ' &middot; ' + esc(w.rel) : ''}${
           m.meta.cutoffTime ? ' &middot; tutup ' + esc(m.meta.cutoffTime) : ''}</small>
       </p>`
    : `<p class="ovl">Pemenang sah</p>
       <h1 class="hero-name">Tidak dapat ditentukan</h1>
       <p class="hero-quote">Tidak ada tawaran sah sebelum lelang ditutup.</p>`;

  return `<section class="hero sec">
    <div class="wrap">
      ${inti}
      <ul class="temuan">${m.findings.map(temuan).join('')}</ul>
    </div>
    <div class="wrap">
      <a class="turun" href="#ringkasan"><i></i>Rincian di bawah</a>
    </div>
  </section>`;
}

/** Satu temuan = satu kalimat. Titiknya sengaja ada supaya terbaca tenang. */
function temuan(f) {
  const inti = `<strong>${esc(f.text)}</strong>`;
  const sisa = f.sub ? ' &mdash; ' + esc(f.sub) : '';
  return `<li class="${f.tone}">${inti}${sisa}.</li>`;
}

function ringkasan(m) {
  const kotak = m.stats.map((s) => {
    const teks = /[a-z]/i.test(String(s.n));          // "1 jam 6 menit" vs "12"
    const warna = s.tone === 'off' ? ' mati' : (s.tone === 'bad' ? ' awas' : '');
    return `<div>
      <span class="stat-n${teks ? ' teks' : ''}${warna}">${esc(s.n)}</span>
      <span class="stat-k">${esc(s.k)}</span>
    </div>`;
  }).join('');

  return `<section class="sec" id="ringkasan">
    <div class="wrap">
      <p class="ovl">01</p>
      <h2 class="h2">Ringkasan</h2>
      <p class="lead">${m.meta.total} komentar dari ${m.meta.users} akun, ${
        esc(m.meta.first)} sampai ${esc(m.meta.last)}.</p>
      <div class="angka">${kotak}</div>
    </div>
  </section>`;
}

function urutan(m) {
  const baris = m.rows.map((r, i) => {
    const id = 'k' + i;

    const tanda = r.tags.length
      ? `<span class="tanda">${r.tags.map((t) =>
          `<span class="${t.key === 'lewat-cutoff' ? 'telat' : ''}">${esc(t.label)}</span>`
        ).join(' &middot; ')}</span>`
      : '';

    const juara = r.isWinner ? '<span class="tanda juara">Pemenang</span>' : '';

    return `<tr role="row" class="${r.isWinner ? 'menang' : ''}">
      <td role="cell" class="t">${esc(r.time)}${r.gap ? `<small>+${esc(r.gap)}</small>` : ''}</td>
      <td role="cell" class="u"><b>${esc(r.user)}</b>${juara}${tanda}</td>
      <td role="cell" class="amt kanan${r.amount ? '' : ' kosong'}">${esc(r.amount) || '&mdash;'}</td>
      <td role="cell" class="cmt">
        <p id="${id}">${esc(r.text)}</p>
        <button class="lipat" type="button" hidden aria-controls="${id}" aria-expanded="false">selengkapnya</button>
      </td>
    </tr>`;
  }).join('');

  return `<section class="sec">
    <div class="wrap">
      <p class="ovl">02</p>
      <h2 class="h2">Urutan tawaran</h2>
      <p class="lead">Urut waktu Instagram, ${esc(m.tzShort)}.</p>
      <table class="tbl urut" role="table">
        <thead><tr role="row">
          <th role="columnheader">Waktu</th>
          <th role="columnheader">Akun</th>
          <th role="columnheader" class="kanan">Nilai</th>
          <th role="columnheader">Komentar</th>
        </tr></thead>
        <tbody>${baris}</tbody>
      </table>
    </div>
  </section>`;
}

function akun(m) {
  const baris = m.accounts.map((a) => `<tr role="row">
    <td role="cell" class="u"><b>${esc(a.user)}</b>${
      a.lateEntrant ? '<span class="tanda">baru muncul di akhir</span>' : ''}</td>
    <td role="cell" class="num">${a.count}</td>
    <td role="cell" class="amt${a.max ? '' : ' kosong'}">${esc(a.max) || '&mdash;'}</td>
    <td role="cell" class="num">${
      a.late ? `<span class="tanda"><span class="telat">${a.late} telat</span></span>` : ''}</td>
  </tr>`).join('');

  return `<section class="sec">
    <div class="wrap">
      <p class="ovl">03</p>
      <h2 class="h2">Akun</h2>
      <table class="tbl akun" role="table">
        <thead><tr role="row">
          <th role="columnheader">Akun</th>
          <th role="columnheader">Tawaran</th>
          <th role="columnheader">Tertinggi</th>
          <th role="columnheader">Catatan</th>
        </tr></thead>
        <tbody>${baris}</tbody>
      </table>
    </div>
  </section>`;
}

function sumber(m) {
  const s = m.source;
  const item = [];

  if (s.owner) item.push(['Penyelenggara', '@' + esc(s.owner)]);
  if (s.url) {
    // Hanya http(s) yang dijadikan tautan. Dump berasal dari luar, jangan
    // sampai skema aneh (javascript:) ikut jadi tautan yang bisa diklik.
    const aman = /^https?:\/\//i.test(s.url);
    item.push(['Unggahan', aman
      ? `<a href="${esc(s.url)}" rel="noreferrer noopener">${esc(s.url)}</a>`
      : esc(s.url)]);
  }
  if (m.meta.cutoffTime) {
    item.push(['Jam tutup', esc(m.meta.cutoffTime) + ' ' + esc(m.tzShort) +
      (m.meta.cutoffDate ? ', ' + esc(m.meta.cutoffDate) : '')]);
  }
  if (s.caption) item.push(['Keterangan', esc(s.caption)]);
  if (s.pulledAt) item.push(['Diambil', esc(s.pulledAt) + ' ' + esc(m.tzShort)]);
  item.push(['Zona waktu', esc(m.tz)]);

  return `<section class="sec sumber">
    <div class="wrap">
      <p class="ovl">04</p>
      <h2 class="h2">Sumber</h2>
      <dl>${item.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    </div>
  </section>`;
}
