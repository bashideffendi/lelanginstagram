/**
 * Perbandingan dua snapshot dari post yang sama.
 *
 * Gunanya: komentar yang ADA di snapshot lama tapi HILANG di snapshot baru
 * berarti dihapus di antara dua penarikan — bid yang diam-diam ditarik.
 * Ini satu-satunya cara mendeteksinya; sekali komentar dihapus, Instagram
 * tidak menyimpan jejaknya di mana pun yang bisa kita akses.
 */

import { chronoCompare } from './analysis.js';

export function diffDumps(before, after) {
  const beforeAt = before.meta?.extracted_at ?? null;
  const afterAt = after.meta?.extracted_at ?? null;

  // Kalau urutannya kebalik, tukar supaya "before" benar-benar yang lebih dulu.
  let a = before, b = after, swapped = false;
  if (beforeAt != null && afterAt != null && beforeAt > afterAt) {
    a = after; b = before; swapped = true;
  }

  // Tanpa waktu penarikan, urutannya cuma mengikuti urutan berkas dijatuhkan.
  // Arah yang keliru membuat komentar BARU dilaporkan sebagai DIHAPUS.
  const waktuTidakPasti = beforeAt == null || afterAt == null;

  const mapA = new Map(a.comments.map((c) => [c.pk, c]));
  const mapB = new Map(b.comments.map((c) => [c.pk, c]));

  const deleted = [];
  const added = [];
  const changed = [];

  for (const [pk, c] of mapA) {
    const other = mapB.get(pk);
    if (!other) deleted.push(c);
    else if (other.text !== c.text) changed.push({ pk, before: c, after: other });
  }
  for (const [pk, c] of mapB) {
    if (!mapA.has(pk)) added.push(c);
  }

  deleted.sort(chronoCompare);
  added.sort(chronoCompare);

  // Sumber hanya dianggap sama kalau keduanya memang menyebutkan postingan
  // yang sama. Sebelumnya identitas yang hilang dianggap cocok, sehingga
  // membandingkan dua postingan berbeda melaporkan semuanya sebagai dihapus.
  const idA = a.source?.media_id || a.source?.shortcode || null;
  const idB = b.source?.media_id || b.source?.shortcode || null;
  const sameSource = idA != null && idB != null && String(idA) === String(idB);
  const sumberTidakDikenal = idA == null || idB == null;

  return {
    swapped,
    waktuTidakPasti,
    sumberTidakDikenal,
    sameSource,
    beforeLabel: a.filename || 'snapshot 1',
    afterLabel: b.filename || 'snapshot 2',
    beforeAt: a.meta?.extracted_at ?? null,
    afterAt: b.meta?.extracted_at ?? null,
    beforeCount: a.comments.length,
    afterCount: b.comments.length,
    deleted,
    added,
    changed
  };
}
