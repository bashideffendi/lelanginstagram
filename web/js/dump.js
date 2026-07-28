/**
 * Pembacaan & validasi dump dari bookmarklet.
 * Toleran terhadap dump versi lama maupun payload mentah Instagram
 * yang disalin manual, supaya file lama tetap kebaca.
 */

function normalizeRaw(c, parentPk) {
  const u = c.user || {};
  return {
    pk: String(c.pk ?? c.id ?? ''),
    parent_pk: parentPk ? String(parentPk) : null,
    is_reply: !!parentPk,
    created_at: Number(c.created_at ?? c.created_at_utc),
    text: c.text ?? '',
    username: u.username || null,
    user_pk: u.pk != null ? String(u.pk) : null,
    full_name: u.full_name || null,
    is_verified: !!u.is_verified,
    like_count: c.comment_like_count ?? null,
    child_comment_count: c.child_comment_count ?? 0
  };
}

export function parseDump(json, filename = '') {
  let data = json;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error('Berkas ini bukan JSON yang sah.');
    }
  }
  // Tanpa penjagaan ini, berkas berisi `null` atau sekadar angka menghasilkan
  // pesan galat teknis yang tidak memberi tahu apa pun kepada pengguna.
  if (data == null || typeof data !== 'object') {
    throw new Error('Format tidak dikenali — isinya bukan berkas hasil tarikan Lelang Insta.');
  }

  let comments = null;
  let source = {};
  let meta = {};

  if (Array.isArray(data)) {
    // Array komentar telanjang. Elemen kosong dibuang lebih dulu supaya
    // berkas yang cacat sebagian tetap bisa dibaca.
    comments = data
      .filter((c) => c && typeof c === 'object')
      .map((c) => (c.username !== undefined ? c : normalizeRaw(c, null)));
  } else if (Array.isArray(data.comments) && data.comments.length && data.comments[0].username !== undefined) {
    // Dump Ketok.
    comments = data.comments;
    source = data.source || {};
    meta = data.ketok || {};
  } else if (Array.isArray(data.comments)) {
    // Payload mentah Instagram.
    comments = data.comments.map((c) => normalizeRaw(c, null));
  } else if (data.raw && Array.isArray(data.raw.top)) {
    comments = data.raw.top.map((c) => normalizeRaw(c, null));
    for (const r of data.raw.replies || []) comments.push(normalizeRaw(r.c, r.parent));
    source = data.source || {};
  }

  if (!comments) throw new Error('Format tidak dikenali — tidak menemukan daftar komentar.');

  comments = comments
    .filter((c) => c && typeof c === 'object' && c.pk && Number.isFinite(Number(c.created_at)))
    .map((c) => ({ ...c, created_at: Number(c.created_at) }));

  if (!comments.length) throw new Error('Dump terbaca tapi tidak berisi komentar yang valid.');

  // Buang duplikat pk (bisa terjadi kalau halaman tumpang tindih saat paginasi).
  const seen = new Set();
  const unique = [];
  for (const c of comments) {
    if (seen.has(c.pk)) continue;
    seen.add(c.pk);
    unique.push(c);
  }

  return {
    filename,
    comments: unique,
    duplicatesDropped: comments.length - unique.length,
    source,
    meta,
    stats: data.stats || null,
    hasRaw: !!data.raw,
    original: data
  };
}

export function readFileAsDump(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Gagal membaca file.'));
    fr.onload = () => {
      try {
        resolve(parseDump(fr.result, file.name));
      } catch (e) {
        reject(new Error(`${file.name}: ${e.message}`));
      }
    };
    fr.readAsText(file);
  });
}
