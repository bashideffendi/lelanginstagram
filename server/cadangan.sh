#!/bin/bash
#
# Cadangan harian data pantauan.
#
# Yang dilindungi: berkas rusak, terhapus tak sengaja, atau kesalahan sinkron
# yang menimpa daftar dengan isi yang salah. Yang TIDAK dilindungi: VPS-nya
# sendiri hilang — salinannya ada di mesin yang sama. Salinan luar kotak
# tetap dari tombol Ekspor di halaman Pantauan, dan dari simpanan browsermu
# sendiri yang memang berisi daftar yang sama.
#
# Dipasang lewat systemd timer, bukan cron: penjadwalnya sudah ada di mesin
# ini, dan kegagalannya masuk journal yang sama dengan layanannya.

set -euo pipefail

ASAL='/home/ubuntu/lelanginstagram/data'
TUJUAN='/home/ubuntu/lelanginstagram/cadangan'
SIMPAN_HARI=14

mkdir -p "$TUJUAN"
chmod 700 "$TUJUAN"

STEMPEL=$(date +%Y%m%d-%H%M%S)
BERKAS="$TUJUAN/pantau-$STEMPEL.tar.gz"

# Hanya berkas data. Berkas env berisi cookie Instagram dan sengaja TIDAK
# ikut: cadangan yang menyalin rahasia ke berkas baru memperbanyak tempat
# rahasia itu berada, dan tidak ada gunanya — cookie disegarkan sendiri.
tar -czf "$BERKAS" -C "$ASAL" . 2>/dev/null

chmod 600 "$BERKAS"

# Sisakan yang terbaru saja. Tanpa ini, berkas menumpuk sampai disk penuh —
# dan disk penuh mematikan layanannya, jadi cadangan yang tidak dibersihkan
# justru menjadi penyebab gangguan yang mau dicegahnya.
find "$TUJUAN" -name 'pantau-*.tar.gz' -mtime +"$SIMPAN_HARI" -delete

echo "cadangan: $BERKAS ($(du -h "$BERKAS" | cut -f1)), $(find "$TUJUAN" -name 'pantau-*.tar.gz' | wc -l) berkas tersimpan"
