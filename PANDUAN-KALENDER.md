# Menyiapkan sinkron Google Calendar

Sekali saja, sekitar lima menit. Setelah ini selesai selamanya: lelang yang
kamu tambahkan langsung muncul di kalender, jam yang kamu perbaiki ikut
berubah, dan yang kamu hapus ikut terhapus.

**Kenapa harus repot sekali di awal?** Google tidak mengizinkan aplikasi mana
pun menulis ke kalender orang tanpa izin resmi. Izin itu berbentuk sebuah
"client ID" yang harus dibuat atas namamu sendiri. Tidak ada jalan pintasnya,
dan itu justru bagus — artinya tidak ada aplikasi asing yang bisa diam-diam
mengubah kalendermu.

Semua langkah di bawah dilakukan sambil login dengan **akun Google yang
kalendernya mau dipakai**.

---

## 1. Buat wadahnya

Buka <https://console.cloud.google.com/projectcreate>

- **Project name**: `Lelang Insta`
- Tekan **Create**, tunggu sebentar sampai selesai

## 2. Nyalakan Kalender

Buka <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>

- Pastikan project `Lelang Insta` yang terpilih di kotak atas
- Tekan **Enable**

## 3. Beri tahu Google aplikasinya milik siapa

Buka <https://console.cloud.google.com/auth/overview>

- Tekan **Get started**
- **App name**: `Lelang Insta`
- **User support email**: pilih emailmu
- **Audience**: pilih **External**
- **Contact email**: emailmu
- Setujui, lalu **Create**

Setelah jadi, buka tab **Audience**, cari **Test users**, tekan **Add users**,
lalu masukkan alamat Gmail-mu sendiri. Tanpa langkah ini Google akan menolak
saat kamu menekan Hubungkan.

## 4. Buat kuncinya

Buka <https://console.cloud.google.com/auth/clients>

- Tekan **Create client**
- **Application type**: **Web application**
- **Name**: `Lelang Insta`
- Di bagian **Authorized JavaScript origins**, tekan **Add URI** lalu isi:

```
https://lelanginsta.tempuscollective.com
```

- Tekan **Create**

Akan muncul **Client ID** berbentuk seperti:

```
1234567890-abcdefghijklmnop.apps.googleusercontent.com
```

Salin itu. **Client secret tidak dipakai** — abaikan saja.

## 5. Pasang di Lelang Insta

**Sudah terpasang** di `web/config.js`, jadi semua perangkat langsung dapat —
tidak ada yang perlu ditempel di HP maupun di laptop lain.

Client ID memang publik: aplikasi browser tidak memakai client secret, dan
Client ID-nya terbaca dari kode halaman situs mana pun yang memakainya. Yang
menjaganya adalah daftar **Authorized JavaScript origins** di langkah 4 —
selama di situ hanya ada alamat situs ini, Client ID yang disalin orang tidak
bisa dipakai dari domain lain.

Kalau suatu saat perlu menguji Client ID lain tanpa mengubah berkasnya, buka
`F12` → tab **Console**, lalu:

```js
localStorage.setItem('lelanginsta_gcal_id', 'CLIENT-ID-LAIN')   // nilai ini menang
localStorage.removeItem('lelanginsta_gcal_id')                  // kembali ke config.js
```

Yang ini hanya berlaku di browser itu saja, tidak ikut ke perangkat lain.

## 6. Hubungkan

Buka menu **Pantauan**, tekan **Hubungkan Google Calendar**, pilih akunmu,
lalu izinkan.

Google akan menampilkan peringatan **"Google hasn't verified this app"**. Itu
wajar dan tidak berbahaya: aplikasinya memang belum melewati proses verifikasi
Google, karena verifikasi hanya diperlukan untuk aplikasi yang dipakai publik
luas. Tekan **Advanced**, lalu **Go to Lelang Insta (unsafe)**.

Kalau ragu: yang kamu izinkan adalah aplikasi buatanmu sendiri, dengan client
ID yang baru saja kamu buat, dan izinnya terbatas pada acara kalender saja.

---

## Sesudahnya

Tidak ada tombol sinkron yang harus ditekan. Setiap perubahan di halaman
Pantauan langsung menyusul ke kalender dengan sendirinya.

Tiap lelang jadi satu acara pada jam tutupnya, dengan **alarm 30 menit dan
5 menit sebelumnya**.

**Kalau sambungannya terputus** — biasanya karena lama tidak dibuka — cukup
tekan Hubungkan lagi. Tidak ada yang perlu diulang dari awal.

**Kalau kamu ingin berhenti**: tekan Putuskan. Acara yang sudah ada di kalender
sengaja tidak ikut dihapus, supaya pengingat lelang yang sedang berjalan tidak
hilang mendadak. Hapus sendiri dari kalender kalau memang tidak diinginkan.
