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

/**
 * Pembuat pemanggil API.
 *
 * `base` kosong untuk bookmarklet, penuh untuk extension dan server.
 * `extraHeaders` dipakai server untuk mengirim cookie secara eksplisit —
 * di browser cookie ikut sendiri lewat credentials:'include'.
 */
export function createApi(base, extraHeaders, opts) {
  var pilihan = opts || {};

  return function api(path) {
    var headers = {
      'x-ig-app-id': APP_ID,
      'x-requested-with': 'XMLHttpRequest'
    };
    if (extraHeaders) for (var k in extraHeaders) headers[k] = extraHeaders[k];

    var init = { credentials: 'include', headers: headers };
    // Dari server, pengalihan JANGAN diikuti. Sesi yang ditolak membuat
    // Instagram melempar ke halaman login berulang kali, dan yang muncul
    // hanyalah "redirect count exceeded" — kegagalan yang tidak memberi tahu
    // apa pun. Dengan dihentikan, penolakannya terbaca apa adanya.
    if (pilihan.manualRedirect) init.redirect = 'manual';

    return fetch(base + path, init).then(function (r) {
      if (r.status >= 300 && r.status < 400) {
        // Tujuan pengalihan membedakan sesi yang ditolak (/accounts/login/)
        // dari akun yang sedang diminta verifikasi (/challenge/).
        var tujuan = '';
        try { tujuan = r.headers.get('location') || ''; } catch (e) { /* diabaikan */ }

        var alih = new Error(
          'Instagram mengalihkan permintaan ke halaman login — sesi tidak diterima.'
        );
        alih.status = 401;
        alih.tujuan = tujuan;
        throw alih;
      }
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

export function fetchComments(api, mediaId, onProgress, errors, maxPages, sisi) {
  var all = [];
  var minId = null;
  var page = 0;
  var limit = maxPages || MAX_PAGES;

  function step() {
    var url = '/api/v1/media/' + mediaId +
      '/comments/?can_support_threading=true&permalink_enabled=false';
    if (minId) url += '&min_id=' + encodeURIComponent(minId);

    return api(url).then(function (j) {
      // Balasan daftar komentar kerap ikut membawa caption dan pemilik
      // postingan. Dipungut di sini sebagai cadangan, supaya keduanya tidak
      // hilang hanya karena panggilan info postingan gagal.
      if (sisi && page === 0 && j.caption) {
        if (!sisi.caption && j.caption.text) sisi.caption = j.caption.text;
        if (!sisi.owner && j.caption.user && j.caption.user.username) {
          sisi.owner = j.caption.user.username;
        }
      }

      all = all.concat(j.comments || j.child_comments || []);
      page++;

      var next = j.next_min_id;
      if (next && typeof next === 'object') next = next.cached_comments_cursor || null;
      minId = next ? String(next) : null;

      var hasMore = j.has_more_comments !== false && !!minId;
      onProgress(all.length, page, hasMore);

      if (hasMore && page < limit) return politeDelay().then(step);
      if (hasMore && page >= limit) {
        errors.push({
          stage: 'comments',
          message: 'Berhenti di batas ' + limit + ' halaman — komentar tertua tidak ikut terambil.'
        });
      }
      return all;
    }).catch(function (e) {
      // Halaman pertama gagal berarti tidak ada apa-apa untuk diselamatkan —
      // biarkan naik supaya pengguna melihat penyebabnya (biasanya belum login).
      if (!all.length) throw e;

      // Sudah ada yang terkumpul: lebih baik kembalikan sebagian dan catat
      // kekurangannya, daripada membuang ribuan komentar karena satu halaman gagal.
      errors.push({
        stage: 'comments',
        message: 'Terhenti di halaman ' + (page + 1) + ': ' + e.message +
          ' — ' + all.length + ' komentar terkumpul, sisanya tidak terambil.',
        partial: true
      });
      return all;
    });
  }
  return step();
}

/**
 * Balasan bersarang, lengkap dengan paginasinya.
 *
 * Dua bentuk path dicoba karena Instagram pernah menggantinya. Galat dicatat,
 * tidak ditelan: utas yang gagal diambil harus terlihat di berkas bukti,
 * karena balasan yang hilang bisa berisi tawaran.
 */
export function fetchReplies(api, mediaId, commentPk, errors, maxPages) {
  var limit = maxPages || 20;
  var out = [];

  function base(i, cursor) {
    var p = i === 0
      ? '/api/v1/media/' + mediaId + '/comments/' + commentPk + '/child_comments/'
      : '/api/v1/media/' + commentPk + '/child_comments/';
    return p + '?max_id=' + (cursor ? encodeURIComponent(cursor) : '');
  }

  function halaman(i, cursor, page) {
    return api(base(i, cursor)).then(function (j) {
      out = out.concat(j.child_comments || j.comments || []);
      var next = j.next_max_child_cursor || j.next_max_id || null;
      var lagi = j.has_more_tail_child_comments !== false && !!next;

      if (lagi && page + 1 < limit) {
        return politeDelay().then(function () {
          return halaman(i, String(next), page + 1);
        });
      }
      if (lagi && errors) {
        errors.push({
          stage: 'replies',
          message: 'Balasan pada komentar ' + commentPk + ' berhenti di batas ' +
            limit + ' halaman.'
        });
      }
      return out;
    });
  }

  return halaman(0, null, 0).catch(function (e1) {
    out = [];
    return halaman(1, null, 0).catch(function (e2) {
      if (errors) {
        errors.push({
          stage: 'replies',
          message: 'Balasan pada komentar ' + commentPk + ' gagal diambil: ' + e2.message,
          status: e2.status || e1.status || null
        });
      }
      return [];
    });
  });
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
  var api = createApi(opts.base || '', opts.headers, { manualRedirect: opts.manualRedirect });
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
  var sisi = { caption: null, owner: null };     // cadangan dari daftar komentar

  report({ stage: 'info', count: 0 });

  return fetchMediaInfo(api, mediaId, errors)
    .then(function (info) {
      meta.info = info;
      report({ stage: 'comments', count: 0, total: info && info.comment_count });
      return fetchComments(api, mediaId, function (n, page) {
        report({ stage: 'comments', count: n, page: page, total: info && info.comment_count });
      }, errors, opts.maxPages, sisi);
    })
    .then(function (top) {
      rawTop = top;

      /*
       * Balasan bisa dilewati sepenuhnya.
       *
       * Balasan ditarik satu utas per permintaan, berurutan, dengan jeda sopan
       * di antaranya — dan itulah biaya sebenarnya dari satu penarikan, bukan
       * jumlah halamannya. Diukur pada lelang sungguhan: 5 komentar 0,9 detik,
       * 16 komentar 2,0 detik, dan keduanya cuma satu halaman.
       *
       * Untuk menawar di detik terakhir, dua detik itu terlalu lama: harga yang
       * dipakai menghitung jadi basi. Tawaran hampir selalu komentar utama,
       * jadi menjelang menembak balasannya dilewati. Untuk penarikan bukti —
       * tempat balasan yang hilang justru bisa berisi tawaran — semuanya tetap
       * diambil seperti biasa.
       */
      if (opts.skipReplies) return [];

      var threads = top.filter(function (c) { return (c.child_comment_count || 0) > 0; });
      if (!threads.length) return [];

      // Batas keseluruhan balasan. Tanpa ini, satu postingan dengan ratusan utas
      // berbalas bisa memicu ribuan permintaan ke Instagram dari satu klik.
      var batasUtas = opts.maxThreads || 300;
      if (threads.length > batasUtas) {
        errors.push({
          stage: 'replies',
          message: 'Hanya ' + batasUtas + ' dari ' + threads.length +
            ' utas berbalas yang diambil.'
        });
        threads = threads.slice(0, batasUtas);
      }

      var out = [];
      var i = 0;
      function next() {
        if (i >= threads.length) return Promise.resolve(out);
        var parent = threads[i++];
        return fetchReplies(api, mediaId, parent.pk, errors).then(function (kids) {
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
          // Tanpa shortcode (mediaId datang dari halaman, bukan dari alamat),
          // jangan mengarang permalink yang berujung "/p/null/".
          url: shortcode
            ? 'https://www.instagram.com/p/' + shortcode + '/'
            : (opts.url || null),
          shortcode: shortcode || null,
          media_id: mediaId,
          owner_username: (meta.info && meta.info.owner_username) || sisi.owner || null,
          post_taken_at: meta.info && meta.info.taken_at,
          caption: (meta.info && meta.info.caption) || sisi.caption || null,
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
