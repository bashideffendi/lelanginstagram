/* Disalin dari shared/ig-core.js oleh bookmarklet/build.mjs — jangan diedit di sini. */
/**
 * Inti penarikan komentar Instagram — dipakai bersama oleh bookmarklet dan
 * extension. Ini satu-satunya tempat yang perlu diperbaiki kalau Instagram
 * mengubah bentuk endpoint-nya.
 *
 * Bookmarklet memakai alamat relatif (ia sudah berjalan di instagram.com),
 * extension memakai alamat penuh. Perbedaan itu ditangani lewat `base`.
 *
 * Ditulis sebagai modul ES. build.mjs menyalinnya ke extension/ dan
 * menanamkannya ke dalam bookmarklet dengan membuang kata kunci export.
 */

export const APP_ID = '936619743392459';
export const SHORTCODE_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export const MAX_PAGES = 200;

export function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

export function politeDelay() {
  return sleep(550 + Math.random() * 450);
}

/** Shortcode Instagram -> media pk. Deterministik, tidak perlu jaringan. */
export function shortcodeToMediaId(sc) {
  var id = 0n;
  for (var i = 0; i < sc.length; i++) {
    var idx = SHORTCODE_ALPHABET.indexOf(sc[i]);
    if (idx < 0) return null;
    id = id * 64n + BigInt(idx);
  }
  return id > 0n ? id.toString() : null;
}

export function shortcodeFromUrl(href) {
  var m = String(href).match(
    /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/
  );
  return m ? m[1] : null;
}

/** Pembuat pemanggil API. `base` kosong untuk bookmarklet, penuh untuk extension. */
export function createApi(base) {
  return function api(path) {
    return fetch(base + path, {
      credentials: 'include',
      headers: {
        'x-ig-app-id': APP_ID,
        'x-requested-with': 'XMLHttpRequest'
      }
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' pada ' + path);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  };
}

export function fetchMediaInfo(api, mediaId, errors) {
  return api('/api/v1/media/' + mediaId + '/info/')
    .then(function (j) {
      var it = (j.items && j.items[0]) || null;
      if (!it) return null;
      return {
        owner_username: it.user && it.user.username,
        owner_pk: it.user && String(it.user.pk),
        taken_at: it.taken_at || null,
        caption: (it.caption && it.caption.text) || null,
        comment_count: it.comment_count != null ? it.comment_count : null
      };
    })
    .catch(function (e) {
      errors.push({ stage: 'media_info', message: e.message });
      return null;
    });
}

export function fetchComments(api, mediaId, onProgress, errors) {
  var all = [];
  var minId = null;
  var page = 0;

  function step() {
    var url = '/api/v1/media/' + mediaId +
      '/comments/?can_support_threading=true&permalink_enabled=false';
    if (minId) url += '&min_id=' + encodeURIComponent(minId);

    return api(url).then(function (j) {
      all = all.concat(j.comments || j.child_comments || []);
      page++;

      var next = j.next_min_id;
      if (next && typeof next === 'object') next = next.cached_comments_cursor || null;
      minId = next ? String(next) : null;

      var hasMore = j.has_more_comments !== false && !!minId;
      onProgress(all.length, page, hasMore);

      if (hasMore && page < MAX_PAGES) return politeDelay().then(step);
      if (page >= MAX_PAGES) {
        errors.push({ stage: 'comments', message: 'Berhenti di batas ' + MAX_PAGES + ' halaman.' });
      }
      return all;
    });
  }
  return step();
}

/** Balasan bersarang. Dua bentuk path dicoba karena Instagram pernah menggantinya. */
export function fetchReplies(api, mediaId, commentPk) {
  var paths = [
    '/api/v1/media/' + mediaId + '/comments/' + commentPk + '/child_comments/?max_id=',
    '/api/v1/media/' + commentPk + '/child_comments/'
  ];
  function tryPath(i) {
    if (i >= paths.length) return Promise.resolve([]);
    return api(paths[i])
      .then(function (j) { return j.child_comments || j.comments || []; })
      .catch(function () { return tryPath(i + 1); });
  }
  return tryPath(0);
}

export function normalize(c, parentPk) {
  var u = c.user || {};
  return {
    pk: String(c.pk != null ? c.pk : (c.id != null ? c.id : '')),
    parent_pk: parentPk ? String(parentPk) : null,
    is_reply: !!parentPk,
    created_at: Number(c.created_at != null ? c.created_at : c.created_at_utc),
    text: c.text != null ? c.text : '',
    username: u.username || null,
    user_pk: u.pk != null ? String(u.pk) : null,
    full_name: u.full_name || null,
    is_verified: !!u.is_verified,
    like_count: c.comment_like_count != null ? c.comment_like_count : null,
    child_comment_count: c.child_comment_count != null ? c.child_comment_count : 0
  };
}

/**
 * Pipeline lengkap: info post -> semua komentar -> semua balasan -> dump.
 *
 * @param opts.base       awalan alamat ('' untuk bookmarklet)
 * @param opts.url        alamat post
 * @param opts.version    versi pemanggil, dicatat di dump
 * @param opts.includeRaw sertakan payload asli sebagai bukti
 * @param opts.onProgress ({stage, count, page, total}) => void
 */
export function extract(opts) {
  var api = createApi(opts.base || '');
  var errors = [];
  var report = opts.onProgress || function () {};

  var shortcode = shortcodeFromUrl(opts.url);
  var mediaId = shortcode ? shortcodeToMediaId(shortcode) : null;
  if (!mediaId && opts.fallbackMediaId) mediaId = opts.fallbackMediaId();

  if (!mediaId) {
    return Promise.reject(new Error(
      'Alamat itu bukan permalink postingan. Bentuknya harus instagram.com/p/XXXX/ ' +
      '— bukan halaman beranda, profil, atau story.'
    ));
  }

  var meta = { shortcode: shortcode, mediaId: mediaId, info: null };
  var rawTop = [];

  report({ stage: 'info', count: 0 });

  return fetchMediaInfo(api, mediaId, errors)
    .then(function (info) {
      meta.info = info;
      report({ stage: 'comments', count: 0, total: info && info.comment_count });
      return fetchComments(api, mediaId, function (n, page) {
        report({ stage: 'comments', count: n, page: page, total: info && info.comment_count });
      }, errors);
    })
    .then(function (top) {
      rawTop = top;
      var threads = top.filter(function (c) { return (c.child_comment_count || 0) > 0; });
      if (!threads.length) return [];

      var out = [];
      var i = 0;
      function next() {
        if (i >= threads.length) return Promise.resolve(out);
        var parent = threads[i++];
        return fetchReplies(api, mediaId, parent.pk).then(function (kids) {
          kids.forEach(function (k) { out.push({ parent: parent.pk, c: k }); });
          report({ stage: 'replies', count: out.length, page: i, total: threads.length });
          return politeDelay().then(next);
        });
      }
      return next();
    })
    .then(function (replies) {
      var flat = rawTop.map(function (c) { return normalize(c, null); });
      replies.forEach(function (r) { flat.push(normalize(r.c, r.parent)); });
      flat = flat.filter(function (c) { return c.pk && Number.isFinite(c.created_at); });

      var now = Math.floor(Date.now() / 1000);
      var dump = {
        ketok: {
          version: opts.version || '0',
          extracted_at: now,
          extracted_at_iso: new Date(now * 1000).toISOString(),
          extractor_tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || null,
          via: opts.via || 'unknown'
        },
        source: {
          url: 'https://www.instagram.com/p/' + shortcode + '/',
          shortcode: shortcode,
          media_id: mediaId,
          owner_username: meta.info && meta.info.owner_username,
          post_taken_at: meta.info && meta.info.taken_at,
          caption: meta.info && meta.info.caption,
          reported_comment_count: meta.info && meta.info.comment_count
        },
        stats: {
          fetched: flat.length,
          top_level: flat.filter(function (c) { return !c.is_reply; }).length,
          replies: flat.filter(function (c) { return c.is_reply; }).length,
          errors: errors
        },
        comments: flat
      };
      if (opts.includeRaw !== false) dump.raw = { top: rawTop, replies: replies };

      report({ stage: 'done', count: flat.length });
      return dump;
    });
}
