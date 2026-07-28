# Ketok

Baca waktu asli komentar Instagram dalam timezone apa pun, urutkan bid secara
kronologis, dan periksa pelanggaran cutoff lelang.

Dibuat karena tool sejenis (mis. commentgrid) menampilkan waktu dalam timezone
server mereka tanpa keterangan, sehingga tidak bisa dipakai membandingkan urutan
bid. Ketok menyimpan **epoch mentah** dari Instagram dan memperlakukan timezone
murni sebagai lapisan tampilan.

## Dua bagian

| Bagian | Isi | Jalan di mana |
|---|---|---|
| **Bookmarklet** | Menarik komentar dari post yang sedang kamu buka | Tab Instagram, pakai sesi login kamu |
| **Web app** | Analisis, cutoff, perbandingan snapshot, ekspor | Browser, tanpa server |

Tidak ada server perantara dan tidak ada kredensial yang keluar dari browser.
Web app tidak pernah menerima data lewat jaringan — dump berpindah lewat file
atau `postMessage` antar tab.

## Pakai

### 1. Pasang bookmarklet

```bash
cd bookmarklet && node build.mjs
```

Buka `bookmarklet/dist/install.html`, seret tombol kuning ke bookmark bar.

Untuk menargetkan web app lokal saat pengembangan:

```bash
node build.mjs http://localhost:8777
```

### 2. Tarik komentar

1. Buka **permalink** post lelang — `instagram.com/p/XXXX/`, bukan feed atau story
2. Klik bookmark **Ketok**
3. Tunggu panel selesai menarik
4. **Buka di Ketok** (langsung ke web app) atau **Simpan JSON** (arsip bukti)

### 3. Analisis

```bash
python -m http.server 8777 --directory web
```

Buka <http://localhost:8777>, jatuhkan file JSON. Isi jam tutup lelang untuk
mengaktifkan deteksi pelanggaran.

Untuk mencoba tanpa menyentuh Instagram, jatuhkan dua file di `samples/`
(buat dulu dengan `node samples/generate.mjs`). Keduanya berisi skenario lelang
lengkap dengan setiap kelainan yang dideteksi Ketok.

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
bookmarklet/
  src/ketok.js       sumber (baca ini kalau endpoint berubah)
  build.mjs          minifikasi + cek sintaks + halaman pemasangan
  dist/              hasil build
web/
  index.html
  styles.css
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
