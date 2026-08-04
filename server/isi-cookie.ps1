# Mengisi cookie Instagram ke server VPS.
#
# Jalankan dari laptop ini:  klik kanan berkas ini -> Run with PowerShell
# atau di PowerShell:        .\server\isi-cookie.ps1
#
# Nilai yang kamu ketik langsung dikirim ke servermu sendiri. Tidak disimpan
# di laptop, tidak masuk riwayat perintah, dan tidak lewat pihak mana pun.

$ErrorActionPreference = 'Stop'

$VPS   = 'ubuntu@43.156.46.89'
$KUNCI = "$env:USERPROFILE\.ssh\id_ed25519_tempe"
$ENVF  = '/home/ubuntu/lelanginstagram/server/lelanginsta.env'

Write-Host ''
Write-Host 'Isi cookie Instagram untuk Lelang Insta' -ForegroundColor Cyan
Write-Host '========================================'
Write-Host ''
Write-Host 'Ambil dari browser yang sedang login dengan AKUN KHUSUS:'
Write-Host '  1. Buka instagram.com'
Write-Host '  2. Tekan F12  ->  tab Application  ->  Cookies  ->  https://www.instagram.com'
Write-Host '  3. Salin nilai tiga baris ini satu per satu'
Write-Host ''
Write-Host 'Jangan pakai akun yang kamu pakai ikut lelang.' -ForegroundColor Yellow
Write-Host ''

$sessionid = Read-Host 'sessionid  '
$dsuserid  = Read-Host 'ds_user_id '
$csrftoken = Read-Host 'csrftoken  '

if (-not $sessionid -or -not $dsuserid -or -not $csrftoken) {
  Write-Host ''
  Write-Host 'Ada yang kosong. Ketiganya harus diisi — Instagram menolak sesi yang tidak lengkap.' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $KUNCI)) {
  Write-Host ''
  Write-Host "Kunci SSH tidak ditemukan di $KUNCI" -ForegroundColor Red
  exit 1
}

# Berkas disusun di server lewat stdin, jadi nilainya tidak pernah muncul
# sebagai argumen perintah (argumen terlihat di daftar proses).
$isi = @"
IG_SESSIONID=$sessionid
IG_DS_USER_ID=$dsuserid
IG_CSRFTOKEN=$csrftoken
KETOK_KEY=
ASAL_DIIZINKAN=https://lelanginsta.tempuscollective.com,https://lelanginstagram.vercel.app
HOST=127.0.0.1
PORT=8791
RATE_MAX=20
MAX_PAGES=60
"@

Write-Host ''
Write-Host 'Mengirim ke server...' -NoNewline

# Jeda 6 detik, bukan 3: pemeriksa sesi berjalan sekali saat layanan menyala,
# dan hasilnya baru siap dibaca sesudah Instagram menjawab.
$perintah = "cat > $ENVF && chmod 600 $ENVF && sudo systemctl restart lelanginsta-api && sleep 6 && systemctl is-active lelanginsta-api"
$hasil = $isi | ssh -i $KUNCI -o BatchMode=yes -o StrictHostKeyChecking=accept-new $VPS $perintah 2>&1

if ($hasil -match 'active') {
  Write-Host ' selesai.' -ForegroundColor Green
} else {
  Write-Host ' gagal.' -ForegroundColor Red
  Write-Host $hasil
  exit 1
}

Write-Host ''
Write-Host 'Menguji apakah Instagram menerima sesinya...' -NoNewline

# Dulu diuji dengan menarik satu postingan contoh, dan contohnya sudah tidak
# ada — jadi jawabannya selalu "mungkin berhasil, mungkin tidak". Sekarang
# server punya pemeriksa sesi sendiri yang menjawab tegas.
$uji = ssh -i $KUNCI -o BatchMode=yes $VPS "curl -s -m 45 'localhost:8791/sehat'" 2>&1

Write-Host ''
if ($uji -match '"keadaan"\s*:\s*"hidup"') {
  Write-Host 'BERHASIL — Instagram menerima sesinya.' -ForegroundColor Green
} elseif ($uji -match '"keadaan"\s*:\s*"ditolak"') {
  Write-Host 'DITOLAK — cookie itu sudah kedaluwarsa juga.' -ForegroundColor Red
  Write-Host 'Pastikan kamu menyalinnya dari browser yang MASIH login, bukan dari catatan lama.'
  Write-Host 'Buka instagram.com dulu dan pastikan halamannya terbuka tanpa diminta login.'
} elseif ($uji -match '"keadaan"\s*:\s*"kosong"') {
  Write-Host 'Cookie tidak terbaca di server. Coba jalankan berkas ini sekali lagi.' -ForegroundColor Red
} elseif ($uji -match '"keadaan"\s*:\s*"tak_tentu"') {
  Write-Host 'Server tidak bisa menghubungi Instagram saat ini — bukan berarti cookie-nya salah.' -ForegroundColor Yellow
  Write-Host 'Tunggu sebentar, lalu buka halaman Pantauan untuk melihat keadaannya.'
} else {
  Write-Host 'Jawaban server:' -ForegroundColor Yellow
  Write-Host ($uji.ToString().Substring(0, [Math]::Min(400, $uji.ToString().Length)))
}

Write-Host ''
Read-Host 'Tekan Enter untuk menutup'
