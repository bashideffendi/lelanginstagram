import { buildModel, esc, mountSwitcher } from './harness.js';
const m = await buildModel('Asia/Jakarta');
document.getElementById('app').innerHTML = susun(m);
mountSwitcher('dokumen');

/* -------------------------------------------------------------- perilaku */

const app = document.getElementById('app');

/* Buka–tutup komentar panjang. */
app.addEventListener('click', (e) => {
  const b = e.target.closest('.say-b');
  if (!b) return;
  const kotak = b.closest('.say');
  const buka = kotak.classList.toggle('open');
  b.textContent = buka ? 'ringkas' : 'selengkapnya';
  b.setAttribute('aria-expanded', buka ? 'true' : 'false');
});

/* Tombol hanya muncul kalau teksnya memang terpotong. */
function periksaPotongan() {
  for (const kotak of app.querySelectorAll('.say')) {
    if (kotak.classList.contains('open')) continue;
    const teks = kotak.querySelector('.say-t');
    const tombol = kotak.querySelector('.say-b');
    tombol.hidden = teks.scrollHeight - teks.clientHeight <= 2;
  }
}
periksaPotongan();

let jeda;
addEventListener('resize', () => {
  clearTimeout(jeda);
  jeda = setTimeout(periksaPotongan, 150);
});

/* -------------------------------------------------------------- penyusun */

/** Penanda yang dihitung sebagai pelanggaran — satu-satunya pemakai warna aksen. */
function langgar(key) {
  return key === 'lewat-cutoff' || key === 'bid-turun';
}

/** Teks Instagram yang bisa panjang: potong dua baris, sediakan tombolnya. */
function kutipan(teks) {
  if (!teks) return '';
  return `<div class="say"><div class="say-t">${esc(teks)}</div>` +
    '<button class="say-b" type="button" aria-expanded="false" hidden>selengkapnya</button></div>';
}

function barisKet(label, isi) {
  if (!isi) return '';
  return `<div><dt>${label}</dt><dd>${isi}</dd></div>`;
}

function susun(m) {
  return [
    kop(m),
    '<main>',
    bagianPemenang(m),
    bagianCatatan(m),
    bagianIkhtisar(m),
    bagianDaftar(m),
    bagianAkun(m),
    '</main>',
    kaki(m)
  ].join('');
}

/* Kepala dokumen: nama alat di kiri, tanggal penarikan di kanan, lalu garis tebal. */
function kop(m) {
  const s = m.source;
  const objek = [
    s.owner ? `<span>@${esc(s.owner)}</span>` : '',
    s.url ? `<a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">` +
      `${esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : ''
  ].filter(Boolean).join('<span class="sep">/</span>');

  return '<header class="kop">' +
    '<div class="kop-kiri">' +
      '<div class="kop-nama">Lelang Insta</div>' +
      '<div class="kop-sub">Berita acara lelang Instagram</div>' +
      (objek ? `<div class="kop-objek">${objek}</div>` : '') +
    '</div>' +
    '<div class="kop-kanan">' +
      '<div class="lbl">Ditarik</div>' +
      (m.source.pulledAt
        ? `<div class="kop-tanggal mesin">${esc(m.source.pulledAt)} ${esc(m.tzShort)}</div>`
        : '') +
    '</div>' +
  '</header><div class="garis"></div>';
}

/* Layar pertama: siapa pemenangnya, berapa, jam berapa persisnya. */
function bagianPemenang(m) {
  const w = m.winner;
  if (!w) {
    return '<section class="sec"><h2 class="lbl">Pemenang</h2>' +
      '<p class="menang-kosong">Tidak ada tawaran sah.</p></section>';
  }
  const ket =
    barisKet('Jam masuk', `<span class="mesin">${esc(w.time)}</span> &middot; <span class="mesin">${esc(w.date)}</span>`) +
    barisKet('Jam tutup', m.meta.cutoffTime ? `<span class="mesin">${esc(m.meta.cutoffTime)}</span>` : '') +
    barisKet('Selisih', w.rel ? esc(w.rel) : '') +
    barisKet('Nomor komentar', `<span class="mesin kecil">${esc(w.pk)}</span>`);

  return '<section class="sec">' +
    '<h2 class="lbl">Pemenang</h2>' +
    '<div class="menang">' +
      `<div class="menang-nama">@${esc(w.username)}</div>` +
      `<div class="menang-nilai mesin">${esc(w.amount)}</div>` +
    '</div>' +
    (w.quote ? `<p class="menang-kutip">&ldquo;${esc(w.quote)}&rdquo;</p>` : '') +
    `<dl class="ket">${ket}</dl>` +
  '</section>';
}

/* Kejanggalan sebagai daftar bernomor, bukan kotak berwarna. */
function bagianCatatan(m) {
  const isi = m.findings.map((f, i) => {
    const bad = f.tone === 'bad';
    return `<li class="${bad ? 't-bad' : ''}">` +
      `<span class="t-no mesin">${String(i + 1).padStart(2, '0')}${bad ? ' &dagger;' : ''}</span>` +
      '<div>' +
        `<p class="t-teks">${esc(f.text)}</p>` +
        (f.sub ? `<p class="t-sub">${esc(f.sub)}</p>` : '') +
      '</div></li>';
  }).join('');

  return '<section class="sec"><h2 class="lbl">Catatan pemeriksaan</h2>' +
    `<ol class="temu">${isi}</ol></section>`;
}

function bagianIkhtisar(m) {
  const pos = m.stats.map((s) => {
    const kelas = s.tone === 'bad' ? 'i-bad' : s.tone === 'off' ? 'i-off' : '';
    return `<div class="${kelas}"><dt>${esc(s.k)}</dt><dd>${esc(s.n)}</dd></div>`;
  });
  pos.push(`<div><dt>Komentar</dt><dd>${esc(m.meta.total)}</dd></div>`);

  return '<section class="sec"><h2 class="lbl">Ikhtisar</h2>' +
    `<dl class="ikh">${pos.join('')}</dl></section>`;
}

/* Register komentar bergaya dokumen: garis tipis, angka rata kanan. */
function bagianDaftar(m) {
  const baris = m.rows.map((r) => {
    const tanda = [];
    if (r.isWinner) tanda.push('<span class="tag tag-win">Pemenang</span>');
    for (const t of r.tags) {
      const bad = langgar(t.key);
      tanda.push(`<span class="tag${bad ? ' tag-bad' : ''}">` +
        `${bad ? '<span class="salib">&dagger;</span> ' : ''}${esc(t.label)}</span>`);
    }
    return `<tr class="${r.isWinner ? 'win' : ''}">` +
      `<td class="c-no">${esc(String(r.seq).padStart(2, '0'))}</td>` +
      `<td class="c-jam">${esc(r.time)}${r.gap ? `<span class="gap">+${esc(r.gap)}</span>` : ''}</td>` +
      `<td class="c-akun">@${esc(r.user)}${r.isReply ? '<span class="balas">balasan</span>' : ''}</td>` +
      `<td class="c-nilai">${esc(r.amount)}</td>` +
      `<td class="c-say">${kutipan(r.text)}</td>` +
      `<td class="c-tanda">${tanda.join('')}</td>` +
    '</tr>';
  }).join('');

  const jangka = `${esc(m.meta.first)}&ndash;${esc(m.meta.last)}`;
  return '<section class="sec">' +
    '<div class="lbl-sisi"><h2 class="lbl">Daftar komentar</h2>' +
      `<span class="n">${esc(m.meta.total)} baris &middot; ${jangka}</span></div>` +
    '<table class="reg"><thead><tr>' +
      '<th>No</th><th>Jam</th><th>Akun</th><th class="kanan">Nilai</th>' +
      '<th>Komentar</th><th>Tanda</th>' +
    `</tr></thead><tbody>${baris}</tbody></table></section>`;
}

function bagianAkun(m) {
  const baris = m.accounts.map((a) => {
    const telat = a.late
      ? `<td class="a-late ada" data-l="Telat"><span class="salib">&dagger;</span> ${esc(a.late)} telat</td>`
      : '<td class="a-late" data-l="Telat"></td>';
    return '<tr>' +
      `<td class="a-user">@${esc(a.user)}</td>` +
      `<td class="a-n" data-l="Tawaran">${esc(a.count)}</td>` +
      `<td class="a-max">${esc(a.max)}</td>` +
      `<td class="a-rg">${esc(a.first)}&ndash;${esc(a.last)}</td>` +
      telat +
    '</tr>';
  }).join('');

  return '<section class="sec">' +
    '<div class="lbl-sisi"><h2 class="lbl">Ringkasan akun</h2>' +
      `<span class="n">${esc(m.meta.users)} peserta</span></div>` +
    '<table class="acc"><thead><tr>' +
      '<th>Akun</th><th class="kanan">Tawaran</th><th class="kanan">Tertinggi</th>' +
      '<th class="kanan">Rentang</th><th class="kanan">Telat</th>' +
    `</tr></thead><tbody>${baris}</tbody></table></section>`;
}

function kaki(m) {
  const tutup = m.meta.cutoffTime
    ? `Jam tutup ${esc(m.meta.cutoffTime)} dibaca dari keterangan unggahan.`
    : 'Jam tutup tidak ditemukan pada keterangan unggahan.';
  return '<footer class="kaki"><h2 class="lbl">Sumber</h2>' +
    (m.source.caption ? `<div class="cap">${kutipan(m.source.caption)}</div>` : '') +
    `<p class="catatan">Waktu dalam ${esc(m.tzShort)} (${esc(m.tz)}). ` +
      `Urutan mengikuti nomor komentar Instagram. ${tutup} ` +
      'Tanda &dagger; menandai pelanggaran.</p>' +
  '</footer>';
}
