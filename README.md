# Ketok

Baca waktu asli komentar Instagram dalam timezone apa pun, urutkan bid secara
kronologis, dan periksa pelanggaran cutoff lelang.

Dibuat karena tool sejenis (mis. commentgrid) menampilkan waktu dalam timezone
server mereka tanpa keterangan, sehingga tidak bisa dipakai membandingkan urutan
bid. Ketok menyimpan **epoch mentah** dari Instagram dan memperlakukan timezone
murni sebagai lapisan tampilan.

Live: <https://lelanginsta.tempuscollective.com>

## Tiga bagian

| Bagian | Isi | Jalan di mana |
|---|---|---|
| **Web app** | Analisis, jam tutup, perbandingan snapshot, ekspor | Browser, tanpa server |
| **Extension** | Kotak tempel-link: menarik komentar dari alamat yang kamu tempel | Chrome, izin ke instagram.com |
| **Bookmarklet** | Alternatif tanpa pasang apa pun: menarik dari post yang sedang dibuka | Tab Instagram |

Extension dan bookmarklet sama-sama memakai sesi login browser kamu sendiri.
Tidak ada server perantara, dan tidak ada kredensial yang dibaca atau keluar
dari browser. Web app tidak pernah menerima data lewat jaringan — hasil
berpindah lewat `postMessage` di dalam browser, atau lewat berkas.

### Kenapa kotak tempel-link butuh extension

Halaman web biasa tidak bisa mengambil komentar dari instagram.com: browser
memblokirnya lewat CORS, dan halaman itu juga tidak punya akses ke sesi login
kamu. Satu-satunya cara memberi kotak tempel-link kemampuan itu tanpa
menitipkan cookie Instagram ke sebuah server adalah lewat extension, yang
punya izin host ke instagram.com dan menarik data langsung dari browser kamu.

Logika penarikannya sendiri hanya ada di `shared/ig-core.js`, dipakai bersama
oleh extension dan bookmarklet — jadi kalau Instagram mengubah endpoint,
perbaikannya cukup di satu tempat.

## Pakai

### Jalankan

```bash
python -m http.server 8777 --directory web
```

Buka <http://localhost:8777>. Klik **Lihat contoh hasilnya** — tool langsung
terisi data lelang contoh, tanpa perlu memasang apa pun. Ini cara tercepat
memahami tampilannya.

Kalau di-deploy (Vercel, `outputDirectory` = `web`), langkah ini tidak perlu
sama sekali.

### Pasang extension (untuk kotak tempel-link)

Belum lewat Chrome Web Store, jadi pasangnya manual — sekali saja:

1. `chrome://extensions` → nyalakan **Developer mode** (pojok kanan atas)
2. **Load unpacked** → pilih folder `extension/` di repo ini
3. Muat ulang halaman Ketok

Setelah itu kotak di halaman utama akan menyala hijau (`Extension aktif`), dan
kamu tinggal menempel link postingan lalu menekan **Ambil komentar**.

Kalau menambah alamat baru tempat web app di-hosting, daftarkan di
`content_scripts.matches` pada `extension/manifest.json` — bridge hanya
disuntikkan ke alamat yang terdaftar di sana.

### Alternatif tanpa extension: bookmarklet

1. Di halaman awal, seret tombol oranye **Ketok** ke bar bookmark — sekali saja
2. Buka permalink post lelang: `instagram.com/p/XXXX/`, bukan feed atau story
3. Klik bookmark **Ketok**, tunggu panel selesai menarik
4. Klik **Buka di Ketok** — hasilnya pindah sendiri ke web app

Jam tutup lelang ditebak otomatis dari caption postingan (`CLOSED 21.00 WIB`
dan sejenisnya) lalu ditandai jelas sebagai tebakan. Perbaiki kalau salah;
semua tanda merah bergantung pada angka itu.

### Membangun ulang bookmarklet

Tombol seret di halaman awal berasal dari `web/bookmarklet.js`, yang dihasilkan
oleh:

```bash
node bookmarklet/build.mjs
```

Untuk menargetkan web app lokal saat pengembangan:

```bash
node bookmarklet/build.mjs http://localhost:8777
```

Perintah yang sama juga menulis `bookmarklet/dist/install.html`, halaman
pemasangan berdiri sendiri kalau web app-nya belum jalan.

Data contoh (`web/contoh/`) dan berkas uji lengkap (`samples/`) dihasilkan oleh
`node samples/generate.mjs`.

## Yang dideteksi

- **Bid lewat cutoff** — dipisahkan dari komentar biasa yang lewat cutoff
- **Detik-detik akhir** — bid dalam jendela N detik sebelum tutup
- **Detik kembar** — bid pada detik yang sama, diurutkan dengan comment ID
- **Bid turun / bid sama** — nilai tidak naik dari tertinggi berjalan
- **Beruntun** — akun yang sama komentar dua kali dalam ≤5 detik
- **Masuk belakangan** — akun yang bid pertamanya di 10% waktu terakhir
- **Komentar terhapus** — hanya lewat perbandingan dua snapshot

## Batasan yang perlu diketahui

**Presisi hanya detik.** Instagram tidak menyediakan milidetik. Dua bid pada
detik yang sama tidak bisa diurutkan dari waktunya; Ketok memakai comment ID
sebagai pemecah seri karena ID Instagram naik monoton.

**Komentar terhapus tidak bisa dipulihkan.** Sekali dihapus, tidak ada jejaknya
di endpoint mana pun yang bisa diakses. Satu-satunya cara membuktikannya adalah
menarik dua kali — satu saat lelang berjalan, satu setelah tutup — lalu
membandingkan. Kalau baru menarik setelah kejadian, yang hilang tetap hilang.

**Nilai bid ditebak dari teks.** Format `1,5jt`, `500rb`, `500k`, `1.500.000`,
dan angka telanjang dikenali, tapi hasilnya diberi tingkat keyakinan dan tetap
perlu dibaca manual. Kolom `keyakinan_bid` di CSV menandai yang lemah.

**Endpoint Instagram tidak resmi dan bisa berubah.** Biasanya perlu perbaikan
satu-dua kali setahun. Kalau panel bookmarklet menampilkan HTTP 404, itu
tandanya bentuk endpoint berubah — perbaiki di `bookmarklet/src/ketok.js`.

**Menarik terlalu sering berisiko rate limit.** Bookmarklet sudah memberi jeda
antar-request. HTTP 429 berarti tunggu beberapa menit.

## Bukti

Setiap ekspor menyertakan epoch mentah dan waktu UTC di samping waktu lokal,
supaya bisa diverifikasi ulang tanpa perlu tahu timezone apa yang dipakai saat
ekspor. Tab **Bukti** menampilkan SHA-256 dari file JSON mentah — siapa pun yang
memegang file yang sama akan menghitung nilai yang sama.

## Struktur

```
shared/
  ig-core.js         INTI PENARIKAN — satu-satunya tempat memperbaiki
                     kalau Instagram mengubah endpoint
extension/
  manifest.json      izin host + daftar alamat web app
  background.js      satu-satunya yang menyentuh instagram.com
  bridge.js          jembatan halaman <-> extension (tanpa perlu ID extension)
  ig-core.js         salinan shared/ — dihasilkan build.mjs
bookmarklet/
  src/ketok.js       panel dan penyerahan hasil (intinya ditanam saat build)
  build.mjs          tanam inti + minifikasi + cek sintaks + salin ke extension
  dist/              hasil build
web/
  index.html
  styles.css
  bookmarklet.js     dihasilkan build.mjs — sumber tombol seret di halaman awal
  contoh/            data peraga tombol "Lihat contoh"
  js/
    main.js          UI dan perkabelan
    dump.js          pembacaan & validasi dump
    time.js          konversi timezone (epoch <-> waktu dinding)
    analysis.js      urutan bid, penanda, rekap akun, parsing nilai
    diff.js          perbandingan dua snapshot
    export.js        CSV, ringkasan, SHA-256
samples/
  generate.mjs       pembuat data uji
```

Tanpa dependensi, tanpa langkah build untuk web app. `web/` adalah situs statis
biasa — deploy dengan mengarahkan Vercel ke folder itu.

## Catatan build

`build.mjs` memakai minifikasi naif (buang komentar, rapatkan whitespace).
String yang mengandung penanda komentar bisa merusaknya, jadi hasilnya
dikompilasi dulu dengan `new Function` dan build berhenti kalau gagal.
Kalau menambah kode di `src/ketok.js`, hindari string seperti `*` `/` `*`
berdempetan.
