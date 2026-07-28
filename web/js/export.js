/**
 * Ekspor bukti.
 *
 * CSV selalu memuat epoch mentah dan waktu UTC di samping waktu lokal,
 * supaya hasilnya bisa diverifikasi ulang orang lain tanpa perlu tahu
 * timezone apa yang dipakai saat ekspor.
 */

import { fmtDateTime, fmtIsoUtc, tzOffsetLabel, fmtDuration } from './time.js';
import { fmtRupiah } from './analysis.js';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  // BOM supaya Excel membaca UTF-8 dengan benar.
  return '﻿' + lines.join('\r\n');
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function commentsCsv(rows, tz) {
  const headers = [
    'urutan', 'waktu_lokal', 'timezone', 'offset', 'waktu_utc', 'epoch',
    'comment_id', 'username', 'nama', 'balasan_ke',
    'jeda_detik', 'jeda', 'detik_kembar', 'posisi_dalam_detik',
    'nilai_bid', 'keyakinan_bid', 'teks_bid', 'kenaikan', 'bid_tertinggi_berjalan',
    'telat_detik', 'penanda', 'like', 'teks'
  ];
  const body = rows.map((r) => [
    r.seq,
    fmtDateTime(r.created_at, tz),
    tz,
    tzOffsetLabel(r.created_at, tz),
    fmtIsoUtc(r.created_at),
    r.created_at,
    r.pk,
    r.username || '',
    r.full_name || '',
    r.parent_pk || '',
    r.gap ?? '',
    r.gap != null ? fmtDuration(r.gap) : '',
    r.tie ? 'ya' : '',
    r.tie ? `${r.tieIndex}/${r.tieSize}` : '',
    r.bid != null ? r.bid : '',
    r.bidConfidence || '',
    r.bidMatched || '',
    r.increment != null ? r.increment : '',
    r.runningHigh != null ? r.runningHigh : '',
    r.late ?? '',
    r.flags.join(' '),
    r.like_count ?? '',
    r.text
  ]);
  return toCsv(headers, body);
}

export function accountsCsv(accounts, tz) {
  const headers = [
    'username', 'nama', 'user_id', 'jumlah_komen', 'balasan',
    'pertama_lokal', 'terakhir_lokal', 'pertama_epoch', 'terakhir_epoch',
    'rentang_detik', 'rata_jeda_detik', 'bid_tertinggi',
    'bid_lewat_cutoff', 'komen_lewat_cutoff', 'detik_akhir', 'bid_turun', 'masuk_belakangan'
  ];
  const body = accounts.map((a) => [
    a.username, a.full_name || '', a.user_pk || '', a.count, a.replies,
    fmtDateTime(a.first, tz), fmtDateTime(a.last, tz), a.first, a.last,
    a.span, a.avgGap ?? '', a.maxBid != null ? a.maxBid : '',
    a.lateBidCount, a.lateCount, a.snipeCount, a.downCount, a.lateEntrant ? 'ya' : ''
  ]);
  return toCsv(headers, body);
}

export function diffCsv(diff, tz) {
  const headers = ['status', 'waktu_lokal', 'waktu_utc', 'epoch', 'comment_id', 'username', 'teks'];
  const row = (status) => (c) => [
    status, fmtDateTime(c.created_at, tz), fmtIsoUtc(c.created_at),
    c.created_at, c.pk, c.username || '', c.text
  ];
  return toCsv(headers, [
    ...diff.deleted.map(row('DIHAPUS')),
    ...diff.added.map(row('BARU')),
    ...diff.changed.map((ch) => [
      'BERUBAH', fmtDateTime(ch.before.created_at, tz), fmtIsoUtc(ch.before.created_at),
      ch.before.created_at, ch.pk, ch.before.username || '',
      `${ch.before.text}  ->  ${ch.after.text}`
    ])
  ]);
}

/** Ringkasan teks siap tempel ke laporan/chat. */
export function summaryText(summary, source, tz, dumpHash) {
  const L = [];
  L.push('BUKTI URUTAN TAWARAN — Lelang Insta');
  L.push('='.repeat(46));
  if (source?.url) L.push(`Post          : ${source.url}`);
  if (source?.owner_username) L.push(`Pemilik       : @${source.owner_username}`);
  L.push(`Timezone      : ${tz} (${summary.first != null ? tzOffsetLabel(summary.first, tz) : '—'})`);
  L.push('');
  L.push(`Total komentar: ${summary.total}  (utama ${summary.topLevel}, balasan ${summary.replies})`);
  L.push(`Peserta unik  : ${summary.users}`);
  if (summary.first != null) {
    L.push(`Komentar 1    : ${fmtDateTime(summary.first, tz)}   [epoch ${summary.first}]`);
    L.push(`Komentar akhir: ${fmtDateTime(summary.last, tz)}   [epoch ${summary.last}]`);
    L.push(`Rentang       : ${fmtDuration(summary.span)}`);
  }
  if (summary.cutoff != null) {
    L.push(`Cutoff        : ${fmtDateTime(summary.cutoff, tz)}   [epoch ${summary.cutoff}]`);
  }
  L.push('');
  L.push('TEMUAN');
  L.push(`  Bid lewat cutoff  : ${summary.lateBids}`);
  L.push(`  Komen lewat cutoff: ${summary.late} (termasuk yang bukan bid)`);
  L.push(`  Detik-detik akhir : ${summary.snipe}`);
  L.push(`  Detik kembar      : ${summary.tieRows} komentar dalam ${summary.tieGroups} detik`);
  L.push(`  Bid turun         : ${summary.bidDown}`);
  L.push(`  Bid sama          : ${summary.bidSame}`);
  L.push(`  Nilai terbaca     : ${summary.parsedBids} dari ${summary.total} komentar`);
  if (summary.winner) {
    L.push('');
    L.push('BID SAH TERTINGGI (sebelum cutoff)');
    L.push(`  @${summary.winner.username}  ${fmtRupiah(summary.winner.bid)}`);
    L.push(`  ${fmtDateTime(summary.winner.created_at, tz)}   [epoch ${summary.winner.created_at}]`);
    L.push(`  comment ID ${summary.winner.pk}`);
  }
  if (dumpHash) {
    L.push('');
    L.push(`SHA-256 dump mentah: ${dumpHash}`);
  }
  L.push('');
  L.push('Catatan: Instagram hanya menyediakan presisi detik. Bid pada detik yang');
  L.push('sama diurutkan memakai comment ID, yang naik monoton di Instagram.');
  return L.join('\n');
}
