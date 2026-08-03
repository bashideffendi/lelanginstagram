# Server penarik di VPS

Isinya sama dengan fungsi Vercel di `api/comments.js`, tapi berjalan sebagai
proses Node biasa. Alasannya satu: **Instagram menolak sesi yang dipakai dari
IP pusat data Vercel** — permintaannya dijawab dengan pengalihan ke beranda,
tanda sesi dianggap tidak sah. IP VPS biasanya diterima.

Tanpa dependensi. Memakai `shared/ig-core.js` yang sama dengan extension dan
bookmarklet, jadi perubahan endpoint Instagram tetap diperbaiki di satu tempat.

## Pasang

Semua dijalankan di VPS. Ganti nama host sesuai domain yang kamu pakai.

```bash
# 1. Ambil kodenya
cd ~
git clone https://github.com/bashideffendi/lelanginstagram.git
cd lelanginstagram

# 2. Isi cookie Instagram dari akun KHUSUS, bukan akun yang dipakai ikut lelang
cp server/lelanginsta.env.contoh server/lelanginsta.env
nano server/lelanginsta.env
chmod 600 server/lelanginsta.env

# 3. Coba jalan dulu di depan mata, jangan langsung jadi layanan
set -a && . server/lelanginsta.env && set +a
node server/api-server.mjs
```

Di terminal lain, uji dari VPS itu sendiri:

```bash
curl -s localhost:8791/sehat
curl -s "localhost:8791/api/comments?url=https://www.instagram.com/p/XXXX/" | head -c 400
```

Kalau yang keluar JSON berisi `comments`, sesinya diterima. Kalau muncul
"Instagram menolak sesi server", cookie-nya perlu diambil ulang — dan itu
harus beres **sebelum** dijadikan layanan, supaya tidak mengejar masalah lain.

```bash
# 4. Jadikan layanan
sudo cp server/lelanginsta-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lelanginsta-api
systemctl status lelanginsta-api --no-pager
journalctl -u lelanginsta-api -n 30 --no-pager

# 5. Hadapkan ke internet lewat Apache
sudo cp server/apache-lelanginsta.conf /etc/apache2/sites-available/lelanginsta-api.conf
sudo a2enmod proxy proxy_http headers remoteip
sudo a2ensite lelanginsta-api
sudo systemctl reload apache2
sudo certbot --apache -d api.lelanginsta.masbash.id
```

Arahkan dulu A record `api.lelanginsta.masbash.id` ke IP VPS sebelum menjalankan
`certbot`, kalau tidak verifikasinya gagal.

## Sambungkan ke halaman

Setelah `https://api.lelanginsta.masbash.id/sehat` menjawab, ubah satu baris di
`web/config.js`:

```js
export const API_BASE = 'https://api.lelanginsta.masbash.id';
```

Commit dan push — Vercel menerbitkannya sendiri. Halaman tetap di Vercel;
hanya penarikan komentar yang pindah ke VPS.

Untuk mencobanya lebih dulu tanpa mengubah berkas, jalankan ini di konsol
peramban lalu muat ulang:

```js
localStorage.setItem('lelanginsta_api', 'https://api.lelanginsta.masbash.id')
```

## Yang perlu diingat

**Pakai akun Instagram khusus.** Semua penarikan terlihat oleh Instagram
sebagai perbuatan akun itu. Kalau dibatasi, tidak ada yang hilang — asal
bukan akun yang kamu pakai ikut lelang.

**Sesi kedaluwarsa berkala.** Kalau kotak tempel-link mulai menjawab "sesi
ditolak", ambil ulang ketiga cookie lalu:

```bash
sudo systemctl restart lelanginsta-api
```

**`ASAL_DIIZINKAN` menentukan siapa yang boleh memanggil.** Halaman dari asal
lain akan ditolak peramban sebelum permintaannya sampai. Tambahkan alamat baru
di situ kalau memindahkan halamannya.

**Endpoint ini terbuka untuk umum** kalau `KETOK_KEY` dikosongkan. Pembatasnya
20 penarikan per IP tiap 10 menit dan 60 halaman per penarikan. Isi `KETOK_KEY`
kalau ingin dikunci.

## Memperbarui

```bash
cd ~/lelanginstagram && git pull
sudo systemctl restart lelanginsta-api
```
