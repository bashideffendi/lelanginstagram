/**
 * Build Ketok.
 *
 *   node build.mjs                          -> target produksi
 *   node build.mjs http://localhost:8777    -> target web app lokal
 *
 * Menghasilkan:
 *   dist/bookmarklet.txt   URL javascript: siap tempel
 *   dist/install.html      halaman drag-to-bookmark berdiri sendiri
 *   ../web/bookmarklet.js  sumber tombol seret di halaman utama web app
 *   ../extension/ig-core.js  salinan inti penarikan untuk extension
 *
 * Tanpa dependensi. Minifikasi seadanya (buang komentar + rapatkan whitespace);
 * hasilnya dikompilasi dulu supaya kerusakan ketahuan saat build, bukan nanti.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const WEB_APP = process.argv[2] || 'https://lelanginsta.tempuscollective.com';
const VERSION = '1.0.0';

const core = readFileSync(join(root, 'shared', 'ig-core.js'), 'utf8');

// Extension memuat inti itu sebagai modul apa adanya.
mkdirSync(join(root, 'extension'), { recursive: true });
writeFileSync(
  join(root, 'extension', 'ig-core.js'),
  '/* Disalin dari shared/ig-core.js oleh bookmarklet/build.mjs — jangan diedit di sini. */\n' + core,
  'utf8'
);

// Bookmarklet tidak bisa memuat modul, jadi intinya ditanam langsung.
const coreInline = core.replace(/^export\s+/gm, '');

const shell = readFileSync(join(here, 'src', 'ketok.js'), 'utf8')
  .replace('__KETOK_WEB_APP__', WEB_APP)
  .replace('__KETOK_VERSION__', VERSION);

// Sisipkan inti tepat setelah 'use strict' supaya tetap di dalam IIFE.
const marker = "'use strict';";
const at = shell.indexOf(marker) + marker.length;
const src = shell.slice(0, at) + '\n\n' + coreInline + '\n' + shell.slice(at);

const min = src
  .replace(/\/\*![\s\S]*?\*\//g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[\s;{}()])\/\/[^\n]*/g, '$1')
  .replace(/\n\s*/g, '\n')
  .replace(/\n{2,}/g, '\n')
  .trim();

// Minifikasi naif bisa merusak kode kalau ada string yang menyerupai penanda
// komentar. Kompilasi hasilnya dulu; kalau gagal, hentikan build.
try {
  new Function(min);
} catch (e) {
  console.error('BUILD GAGAL — hasil minifikasi tidak bisa diparse: ' + e.message);
  writeFileSync(join(here, 'dist', '_gagal.js'), min, 'utf8');
  console.error('Hasil minifikasi ditulis ke dist/_gagal.js untuk diperiksa.');
  process.exit(1);
}

const bookmarklet = 'javascript:' + encodeURIComponent(min);

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'bookmarklet.txt'), bookmarklet, 'utf8');

writeFileSync(
  join(root, 'web', 'bookmarklet.js'),
  '// Dihasilkan oleh bookmarklet/build.mjs — jangan diedit langsung.\n' +
  'export const BOOKMARKLET = ' + JSON.stringify(bookmarklet) + ';\n' +
  'export const TARGET = ' + JSON.stringify(WEB_APP) + ';\n' +
  'export const VERSION = ' + JSON.stringify(VERSION) + ';\n',
  'utf8'
);

const installHtml = `<!doctype html>
<html lang="id">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pasang Ketok</title>
<style>
  body{margin:0;padding:48px 24px;background:#f6f7f9;color:#16191d;
       font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
  main{max-width:620px;margin:0 auto}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
  p.sub{color:#6b7684;margin:0 0 34px}
  .drag{display:block;text-align:center;background:#c2620a;color:#fff;text-decoration:none;
        font-weight:700;padding:15px;border-radius:10px;margin:0 0 10px;cursor:grab}
  .hint{color:#6b7684;font-size:14px;text-align:center;margin:0 0 34px}
  ol{padding-left:20px;color:#4a5460} li{margin:0 0 10px}
  code{background:#fff;border:1px solid #e3e6eb;border-radius:5px;padding:1px 6px;
       font:13px ui-monospace,Consolas,monospace;color:#c2620a}
  .box{background:#fff;border:1px solid #e3e6eb;border-left:3px solid #c2620a;
       border-radius:8px;padding:15px 17px;margin:28px 0;color:#4a5460;font-size:14.5px}
  .box b{color:#16191d}
  textarea{width:100%;height:80px;background:#fff;color:#6b7684;border:1px solid #e3e6eb;
           border-radius:8px;padding:11px;font:11px ui-monospace,Consolas,monospace}
</style>
<main>
  <h1>Pasang Ketok</h1>
  <p class="sub">Menuju <code>${WEB_APP}</code></p>

  <a class="drag" href="${bookmarklet.replace(/"/g, '&quot;')}" onclick="return false">🔨 Ketok — seret ke bar bookmark</a>
  <p class="hint">Seret tombol di atas ke bar bookmark. Jangan diklik dari halaman ini.</p>

  <ol>
    <li>Tampilkan bar bookmark: <code>Ctrl</code> + <code>Shift</code> + <code>B</code></li>
    <li>Seret tombol oranye di atas ke bar itu</li>
    <li>Buka permalink post lelang — <code>instagram.com/p/XXXX/</code>, bukan beranda</li>
    <li>Klik bookmark <b>Ketok</b>, tunggu penarikan selesai</li>
    <li>Klik <b>Buka di Ketok</b> untuk analisis, atau <b>Simpan berkas</b> untuk arsip</li>
  </ol>

  <div class="box">
    <b>Halaman ini cadangan.</b> Cara yang lebih mudah: buka
    <a href="${WEB_APP}">${WEB_APP}</a> dan seret tombolnya langsung dari sana,
    atau tempel link postingan di kotak paste kalau extension Ketok sudah terpasang.
  </div>

  <p style="color:#6b7684;font-size:14px">Kalau seret-ke-bookmark tidak jalan, salin teks ini sebagai alamat bookmark:</p>
  <textarea readonly onclick="this.select()">${bookmarklet.replace(/</g, '&lt;')}</textarea>
</main>
</html>
`;

writeFileSync(join(here, 'dist', 'install.html'), installHtml, 'utf8');

console.log('Versi          : ' + VERSION);
console.log('Target web app : ' + WEB_APP);
console.log('Inti bersama   : ' + core.length.toLocaleString() + ' byte -> extension/ig-core.js');
console.log('Bookmarklet    : ' + bookmarklet.length.toLocaleString() + ' byte' +
  (bookmarklet.length > 60000 ? '  [!] besar, sebagian browser lawas bisa menolak' : ''));
console.log('Output         : dist/, web/bookmarklet.js, extension/ig-core.js');
