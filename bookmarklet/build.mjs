/**
 * Build bookmarklet Ketok.
 *
 *   node build.mjs                          -> target produksi
 *   node build.mjs http://localhost:8080    -> target web app lokal
 *
 * Menghasilkan:
 *   dist/bookmarklet.txt   URL javascript: siap tempel
 *   dist/install.html      halaman drag-to-bookmark
 *
 * Tanpa dependensi. Minifikasi seadanya (buang komentar + rapatkan whitespace);
 * cukup karena sumbernya sudah ditulis agar aman diminifikasi secara naif.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WEB_APP = process.argv[2] || 'https://ketok.masbash.id';

const src = readFileSync(join(here, 'src', 'ketok.js'), 'utf8')
  .replace('__KETOK_WEB_APP__', WEB_APP);

const min = src
  .replace(/\/\*![\s\S]*?\*\//g, '')            // banner
  .replace(/\/\*[\s\S]*?\*\//g, '')             // blok komentar
  .replace(/(^|[\s;{}()])\/\/[^\n]*/g, '$1')    // komentar baris (bukan di dalam string/regex)
  .replace(/\n\s*/g, '\n')                      // indentasi
  .replace(/\n{2,}/g, '\n')
  .trim();

// Minifikasi naif bisa merusak kode kalau ada string yang menyerupai penanda
// komentar (mis. '*''/''*'). Kompilasi hasilnya dulu; kalau gagal, hentikan build.
try {
  new Function(min);
} catch (e) {
  console.error('BUILD GAGAL — hasil minifikasi tidak bisa diparse: ' + e.message);
  console.error('Cari string di src/ketok.js yang mengandung penanda komentar.');
  writeFileSync(join(here, 'dist', '_gagal.js'), min, 'utf8');
  console.error('Hasil minifikasi ditulis ke dist/_gagal.js untuk diperiksa.');
  process.exit(1);
}

const bookmarklet = 'javascript:' + encodeURIComponent(min);

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'bookmarklet.txt'), bookmarklet, 'utf8');

const installHtml = `<!doctype html>
<html lang="id">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pasang Ketok</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:48px 24px;background:#0b0d10;color:#e6edf3;
       font:15px/1.65 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
  main{max-width:640px;margin:0 auto}
  h1{font-size:22px;letter-spacing:.02em;margin:0 0 4px}
  h1 span{color:#f0b429}
  p.sub{color:#8b98a5;margin:0 0 32px}
  .drag{display:block;text-align:center;background:#f0b429;color:#0b0d10;text-decoration:none;
        font-weight:700;padding:16px;border-radius:10px;margin:0 0 8px;cursor:grab}
  .hint{color:#6e7b8a;font-size:13px;text-align:center;margin:0 0 32px}
  ol{padding-left:20px;color:#c3ccd6}
  li{margin:0 0 10px}
  code{background:#151a21;border:1px solid #222a33;border-radius:4px;padding:2px 6px;
       font:12px ui-monospace,Consolas,monospace;color:#f0b429}
  .box{background:#12161b;border:1px solid #222a33;border-left:3px solid #f0b429;
       border-radius:6px;padding:14px 16px;margin:28px 0;color:#8b98a5;font-size:13px}
  .box b{color:#e6edf3}
  textarea{width:100%;height:90px;background:#12161b;color:#8b98a5;border:1px solid #222a33;
           border-radius:6px;padding:10px;font:11px ui-monospace,Consolas,monospace;resize:vertical}
</style>
<main>
  <h1>Pasang <span>Ketok</span></h1>
  <p class="sub">Ekstraktor komentar Instagram &mdash; target: <code>${WEB_APP}</code></p>

  <a class="drag" href="${bookmarklet.replace(/"/g, '&quot;')}" onclick="return false">Ketok &mdash; seret ke bookmark bar</a>
  <p class="hint">Seret tombol di atas ke bookmark bar. Jangan diklik dari halaman ini.</p>

  <ol>
    <li>Tampilkan bookmark bar: <code>Ctrl</code> + <code>Shift</code> + <code>B</code></li>
    <li>Seret tombol kuning di atas ke bookmark bar</li>
    <li>Buka halaman permalink post lelang &mdash; <code>instagram.com/p/XXXX/</code>, bukan feed</li>
    <li>Klik bookmark <b>Ketok</b>. Panel muncul di kanan atas dan mulai menarik komentar</li>
    <li>Setelah selesai, klik <b>Buka di Ketok</b> untuk analisis, atau <b>Simpan JSON</b> untuk arsip bukti</li>
  </ol>

  <div class="box">
    <b>Tarik dua kali untuk mendeteksi komentar terhapus.</b><br>
    Satu dump saat lelang berjalan, satu lagi setelah tutup. Ketok membandingkan
    keduanya dan menampilkan bid yang hilang. Kalau hanya menarik sekali setelah
    kejadian, komentar yang sudah dihapus tidak bisa dipulihkan.
  </div>

  <p style="color:#6e7b8a;font-size:13px">Kalau seret-ke-bookmark tidak jalan, salin teks ini sebagai URL bookmark:</p>
  <textarea readonly onclick="this.select()">${bookmarklet.replace(/</g, '&lt;')}</textarea>
</main>
</html>
`;

writeFileSync(join(here, 'dist', 'install.html'), installHtml, 'utf8');

console.log('Target web app : ' + WEB_APP);
console.log('Sumber         : ' + src.length.toLocaleString() + ' byte');
console.log('Bookmarklet    : ' + bookmarklet.length.toLocaleString() + ' byte' +
  (bookmarklet.length > 60000 ? '  [!] besar, sebagian browser lawas bisa menolak' : ''));
console.log('Output         : dist/bookmarklet.txt, dist/install.html');
