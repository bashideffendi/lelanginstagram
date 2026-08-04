# Lelang Insta

**Cek Pemenang Lelang Instagram.** Buka jam persis tiap komentar sampai ke detik,
urutkan tawarannya, dan buktikan siapa yang menawar setelah lelang ditutup.

Dibuat karena alat sejenis menampilkan waktu dalam zona waktu server mereka tanpa
keterangan, sehingga tidak bisa dipakai membandingkan urutan tawaran. Lelang Insta
menyimpan **epoch mentah** dari Instagram dan memperlakukan zona waktu murni
sebagai lapisan tampilan.

Live: <https://lelanginsta.tempuscollective.com>

## Empat bagian

| Bagian | Isi | Jalan di mana |
|---|---|---|
| **Web app** | Analisis, jam tutup, perbandingan snapshot, ekspor | Browser, tanpa server |
| **Extension** | Isi kotak tempel-link dari browsermu sendiri | Chrome, izin ke instagram.com |
| **Mode server** | Isi kotak tempel-link tanpa pasang apa pun (mis. dari HP) | Fungsi Vercel, opsional |
| **Bookmarklet** | Menarik dari post yang sedang dibuka, tanpa pasang apa pun | Tab Instagram |

Kotak tempel-link memilih sendiri: extension dulu kalau ada, mode server kalau
tidak. Extension diutamakan karena penarikannya dari browsermu sendiri, jadi
tidak ada akun lain yang menanggung risiko.

Extension dan bookmarklet sama-sama memakai sesi login browser kamu sendiri.
Tidak ada server perantara, dan tidak ada kredensial yang dibaca atau keluar
dari browser. Web app tidak pernah menerima data lewat jaringan — hasil
berpindah lewat `postMessage` di dalam browser, atau lewat berkas.

### Kenapa kotak tempel-link tidak bisa berdiri sendiri

Halaman web biasa tidak bisa mengambil komentar dari instagram.com: browser
memblokirnya lewat CORS, dan halaman itu juga tidak punya akses ke sesi login
siapa pun. Jadi kotak tempel-link selalu butuh salah satu dari dua hal — sebuah
extension yang punya izin host ke instagram.com, atau sebuah server yang
menyimpan sesi Instagram.

Logika penarikannya sendiri hanya ada di `shared/ig-core.js`, dipakai bersama
oleh extension, bookmarklet, dan mode server — jadi kalau Instagram mengubah
endpoint, perbaikannya cukup di satu tempat.

## Pakai

### Jalankan

```bash
python -m http.server 8777 --directory web
```

Buka <http://localhost:8777>. Klik **Lihat contoh hasilnya** — halaman langsung
terisi data lelang contoh, tanpa perlu memasang apa pun. Ini cara tercepat
memahami tampilannya.

Kalau di-deploy (Vercel, `outputDirectory` = `web`), langkah ini tidak perlu
sama sekali.

### Pasang extension (untuk kotak tempel-link)

Belum lewat Chrome Web Store, jadi pasangnya manual — sekali saja:

1. `chrome://extensions` → nyalakan **Developer mode** (pojok kanan atas)
2. **Load unpacked** → pilih folder `extension/` di repo ini
3. Muat ulang halaman Lelang Insta

Setelah itu kotak di halaman utama akan berubah jadi "Extension terpasang", dan
kamu tinggal menempel link postingan lalu menekan **Ambil komentar**.

**Extension juga menyegarkan sesi Instagram di server** (izin `cookies`, sejak
v1.1.0). Sesi Instagram mati sendiri tiap beberapa minggu, dan sebelumnya
satu-satunya cara menghidupkannya adalah membuka DevTools, menyalin tiga
cookie, lalu menjalankan `server/isi-cookie.ps1` — pekerjaan yang tidak masuk
akal dituntut dari alat yang gunanya justru mengurangi kerepotan.

Sekarang, saat halaman **Pantauan** dibuka dan servernya melaporkan sesinya
ditolak, extension membaca cookie dari sesi Instagram di browser ini dan
mengirimkannya ke servermu sendiri. Diam-diam, tanpa satu klik pun. Syaratnya
dua: browser ini masih login Instagram dengan akun khusus, dan kamu sudah masuk
di Lelang Insta (endpoint `/sesi-ig` menolak tanpa itu — kalau tidak, siapa pun
yang tahu alamat servermu bisa menanamkan sesi Instagram milik siapa pun).

Nilai cookienya berjalan dari extension langsung ke servermu, tidak melewati
halaman web, tidak pernah masuk log, dan tidak pernah dikembalikan lewat
jawaban apa pun. Yang dilaporkan cuma diterima atau tidak oleh Instagram.

Karena izinnya bertambah, extension yang sudah terpasang perlu **Reload** sekali
di `chrome://extensions` dan izinnya diterima lagi.

Kalau menambah alamat baru tempat web app di-hosting, daftarkan di
`content_scripts.matches` pada `extension/manifest.json` — bridge hanya
disuntikkan ke alamat yang terdaftar di sana.

### Mode server

Dipakai otomatis kalau extension tidak terpasang — misalnya saat membuka Lelang Insta
dari HP. Inilah cara kerja commentgrid: server yang menarik, bukan browsermu.

**Pakai akun Instagram khusus, bukan akun yang kamu pakai ikut lelang.** Semua
permintaan lewat sini terlihat oleh Instagram sebagai perbuatan akun itu, dari
IP pusat data — pola yang memang rutin dibatasi. Kalau akun itu kena, tidak ada
yang hilang; kalau yang kena akun lelangmu, kamu kehilangan akses ke lelang yang
sedang kamu selidiki.

Setel di Vercel → Settings → Environment Variables:

| Variabel | Wajib | Isi |
|---|---|---|
| `IG_SESSIONID` | ya | Cookie `sessionid` dari akun khusus tadi |
| `IG_DS_USER_ID` | ya dalam praktiknya | Cookie `ds_user_id` |
| `IG_CSRFTOKEN` | ya dalam praktiknya | Cookie `csrftoken` |
| `KETOK_KEY` | tidak | Kalau diisi, endpoint terkunci dan hanya bisa dipakai yang tahu kuncinya. Kalau dikosongkan, terbuka untuk umum |

Ketiga cookie diambil dari sesi yang sama. Mengirim `sessionid` sendirian
membuat Instagram menganggap sesinya cacat lalu mengalihkan permintaan ke
halaman login berulang-ulang &mdash; yang muncul sebagai
`redirect count exceeded`, bukan sebagai penolakan yang jelas.

Mengambil `sessionid`: login dengan akun khusus itu → DevTools (`F12`) →
Application → Cookies → `https://www.instagram.com` → salin nilai `sessionid`
apa adanya, termasuk `%3A` di dalamnya.

**Membuka untuk umum ada harganya.** Setiap penarikan orang lain memakai akun
Instagram kamu, jadi trafiknya menumpuk di satu akun dan risiko pembatasan naik.
Ada pengaman bawaan — maksimal 20 penarikan per IP tiap 10 menit dan 60 halaman
komentar per penarikan — tapi ingatannya per instance lambda, jadi longgar.
Kalau kamu lebih suka tertutup, isi `KETOK_KEY`.

Sesi Instagram kedaluwarsa berkala. Kalau kotak tempel-link menjawab "sesi sudah
kedaluwarsa", login ulang dengan akun khusus itu dan perbarui `IG_SESSIONID`.

**Environment variable dipanggang saat deploy.** Menambah atau mengubahnya tidak
berpengaruh sampai ada deploy baru.

Selama `IG_SESSIONID` belum disetel, endpoint menjawab 503 dan halaman otomatis
menyarankan extension. Tidak ada yang rusak.

### Alternatif tanpa extension: bookmarklet

1. Di halaman awal, seret tombol oranye **Lelang Insta** ke bar bookmark — sekali saja
2. Buka permalink post lelang: `instagram.com/p/XXXX/`, bukan feed atau story
3. Klik bookmark **Lelang Insta**, tunggu panel selesai menarik
4. Klik **Buka hasilnya** — hasilnya pindah sendiri ke web app

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
detik yang sama tidak bisa diurutkan dari waktunya; Lelang Insta memakai comment ID
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
tandanya bentuk endpoint berubah — perbaiki di `shared/ig-core.js`.

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
  src/Lelang Insta.js       panel dan penyerahan hasil (intinya ditanam saat build)
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
Kalau menambah kode di `src/Lelang Insta.js`, hindari string seperti `*` `/` `*`
berdempetan.
