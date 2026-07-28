/*!
 * Ketok — ekstraktor komentar Instagram (bookmarklet)
 *
 * Dijalankan dari halaman post Instagram yang sedang kamu buka.
 * Semua request memakai sesi login browser kamu sendiri; tidak ada
 * server perantara dan tidak ada kredensial yang keluar dari browser.
 *
 * Output: dump JSON berisi epoch mentah tiap komentar (UTC-netral),
 * comment ID, dan payload asli dari Instagram sebagai bukti.
 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var APP_ID = '936619743392459';        // x-ig-app-id publik untuk instagram.com web
  var WEB_APP = '__KETOK_WEB_APP__';     // diisi saat build
  var MAX_PAGES = 200;                   // pengaman anti-loop
  var DELAY_MIN = 550, DELAY_JITTER = 450;

  // Override target web app untuk testing lokal:
  //   localStorage.setItem('ketok_web', 'http://localhost:8080')
  try {
    var ov = localStorage.getItem('ketok_web');
    if (ov) WEB_APP = ov;
  } catch (e) { /* localStorage bisa diblokir, abaikan */ }

  if (window.__KETOK_RUNNING__) {
    alert('Ketok sudah jalan di tab ini.');
    return;
  }
  window.__KETOK_RUNNING__ = true;

  var SHORTCODE_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  // ---------------------------------------------------------------- utils

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function politeDelay() {
    return sleep(DELAY_MIN + Math.random() * DELAY_JITTER);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Shortcode Instagram -> media pk (base64 custom, deterministik). */
  function shortcodeToMediaId(sc) {
    var id = 0n;
    for (var i = 0; i < sc.length; i++) {
      var idx = SHORTCODE_ALPHABET.indexOf(sc[i]);
      if (idx < 0) return null;
      id = id * 64n + BigInt(idx);
    }
    return id > 0n ? id.toString() : null;
  }

  function shortcodeFromUrl(href) {
    var m = String(href).match(
      /instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/
    );
    return m ? m[1] : null;
  }

  /** Fallback: cari media_id yang ke-embed di HTML halaman. */
  function mediaIdFromDom() {
    var html = document.documentElement.innerHTML;
    var pats = [
      /"media_id"\s*:\s*"(\d{6,})"/,
      /"media_id"\s*:\s*(\d{6,})/,
      /"id"\s*:\s*"(\d{6,})_\d+"/
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = html.match(pats[i]);
      if (m) return m[1];
    }
    return null;
  }

  // ---------------------------------------------------------------- api

  var errors = [];

  function api(path) {
    return fetch(path, {
      credentials: 'include',
      headers: {
        'x-ig-app-id': APP_ID,
        'x-requested-with': 'XMLHttpRequest'
      }
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' — ' + path);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  /** Info post: pemilik, caption, waktu upload. Non-fatal kalau gagal. */
  function fetchMediaInfo(mediaId) {
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

  function fetchComments(mediaId, onProgress) {
    var all = [];
    var minId = null;
    var page = 0;

    function step() {
      var url =
        '/api/v1/media/' + mediaId +
        '/comments/?can_support_threading=true&permalink_enabled=false';
      if (minId) url += '&min_id=' + encodeURIComponent(minId);

      return api(url).then(function (j) {
        var batch = j.comments || j.child_comments || [];
        all = all.concat(batch);
        page++;

        var next = j.next_min_id;
        if (next && typeof next === 'object') next = next.cached_comments_cursor || null;
        minId = next ? String(next) : null;

        var hasMore = j.has_more_comments !== false && !!minId;
        onProgress(all.length, page, hasMore);

        if (hasMore && page < MAX_PAGES) {
          return politeDelay().then(step);
        }
        if (page >= MAX_PAGES) {
          errors.push({ stage: 'comments', message: 'Berhenti di batas ' + MAX_PAGES + ' halaman.' });
        }
        return all;
      });
    }

    return step();
  }

  /** Balasan bersarang. Dua bentuk path dicoba karena IG pernah ganti. */
  function fetchReplies(mediaId, commentPk) {
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

  // ---------------------------------------------------------------- normalisasi

  function normalize(c, parentPk) {
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

  // ---------------------------------------------------------------- panel UI

  var host = document.createElement('div');
  host.id = 'ketok-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;';
  document.body.appendChild(host);
  var sr = host.attachShadow({ mode: 'open' });

  sr.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;margin:0;padding:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}' +
    '.p{width:340px;background:#0e1116;color:#e6edf3;border:1px solid #2a323d;border-radius:10px;' +
    'box-shadow:0 12px 40px rgba(0,0,0,.55);overflow:hidden;font-size:12px;line-height:1.5}' +
    '.h{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#151a21;border-bottom:1px solid #2a323d}' +
    '.h b{font-size:13px;letter-spacing:.06em;color:#f0b429}' +
    '.h span{margin-left:auto;color:#6e7b8a;font-size:10px}' +
    '.x{cursor:pointer;color:#6e7b8a;padding:0 4px;font-size:14px}' +
    '.x:hover{color:#e6edf3}' +
    '.b{padding:12px}' +
    '.row{display:flex;justify-content:space-between;gap:8px;padding:3px 0;color:#8b98a5}' +
    '.row b{color:#e6edf3;font-weight:600}' +
    '.bar{height:4px;background:#1e242c;border-radius:2px;overflow:hidden;margin:10px 0 6px}' +
    '.bar i{display:block;height:100%;background:#f0b429;width:0;transition:width .2s}' +
    '.msg{color:#8b98a5;min-height:18px}' +
    '.err{color:#ff6b6b;white-space:pre-wrap;word-break:break-word;margin-top:8px}' +
    '.btns{display:flex;gap:6px;margin-top:12px;flex-wrap:wrap}' +
    'button{flex:1 1 auto;cursor:pointer;border:1px solid #2a323d;background:#1a212a;color:#e6edf3;' +
    'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:600}' +
    'button:hover:not(:disabled){border-color:#f0b429;color:#f0b429}' +
    'button:disabled{opacity:.4;cursor:default}' +
    'button.pri{background:#f0b429;border-color:#f0b429;color:#0e1116}' +
    'button.pri:hover:not(:disabled){background:#ffc84d;color:#0e1116}' +
    'label.ck{display:flex;align-items:center;gap:6px;color:#8b98a5;margin-top:10px;cursor:pointer;font-size:11px}' +
    '</style>' +
    '<div class="p">' +
    '<div class="h"><b>KETOK</b><span>v' + VERSION + '</span><div class="x" id="close">&times;</div></div>' +
    '<div class="b">' +
    '<div class="row"><span>Post</span><b id="sc">—</b></div>' +
    '<div class="row"><span>Media ID</span><b id="mid">—</b></div>' +
    '<div class="row"><span>Komentar</span><b id="cnt">0</b></div>' +
    '<div class="row"><span>Balasan</span><b id="rep">0</b></div>' +
    '<div class="bar"><i id="fill"></i></div>' +
    '<div class="msg" id="msg">Menyiapkan…</div>' +
    '<div class="err" id="err"></div>' +
    '<label class="ck"><input type="checkbox" id="raw" checked> Sertakan payload asli (bukti)</label>' +
    '<div class="btns">' +
    '<button class="pri" id="open" disabled>Buka di Ketok</button>' +
    '<button id="save" disabled>Simpan JSON</button>' +
    '<button id="copy" disabled>Salin</button>' +
    '</div>' +
    '</div></div>';

  var $ = function (id) { return sr.getElementById(id); };

  function setMsg(t) { $('msg').textContent = t; }
  function setErr(t) { $('err').textContent = t; }
  function setFill(p) { $('fill').style.width = Math.max(0, Math.min(100, p)) + '%'; }

  $('close').onclick = function () {
    host.remove();
    window.__KETOK_RUNNING__ = false;
  };

  // ---------------------------------------------------------------- jalan

  var dump = null;

  function buildDump(meta, flat, rawAll) {
    var now = Math.floor(Date.now() / 1000);
    var d = {
      ketok: {
        version: VERSION,
        extracted_at: now,
        extracted_at_iso: new Date(now * 1000).toISOString(),
        extractor_tz: (Intl.DateTimeFormat().resolvedOptions().timeZone) || null
      },
      source: {
        url: location.href.split('?')[0],
        shortcode: meta.shortcode,
        media_id: meta.mediaId,
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
    if ($('raw').checked) d.raw = rawAll;
    return d;
  }

  function enableActions() {
    $('open').disabled = $('save').disabled = $('copy').disabled = false;
  }

  $('save').onclick = function () {
    var name = 'ketok_' + (dump.source.shortcode || dump.source.media_id) +
      '_' + dump.ketok.extracted_at + '.json';
    var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    setMsg('Tersimpan: ' + name);
  };

  $('copy').onclick = function () {
    navigator.clipboard.writeText(JSON.stringify(dump))
      .then(function () { setMsg('JSON disalin ke clipboard.'); })
      .catch(function (e) { setErr('Gagal menyalin: ' + e.message); });
  };

  // Handoff ke web app lewat postMessage — tanpa file, tanpa upload.
  $('open').onclick = function () {
    var target = WEB_APP.replace(/\/+$/, '');
    var w = window.open(target + '/#handoff', '_blank');
    if (!w) { setErr('Popup diblokir. Pakai "Simpan JSON" lalu drag ke Ketok.'); return; }

    setMsg('Menunggu Ketok siap…');
    var sent = false;
    var origin = (function () { try { return new URL(target).origin; } catch (e) { return '*'; } })();

    function onMsg(ev) {
      if (!ev.data || ev.data.ketok !== 'ready') return;
      if (sent) return;
      sent = true;
      w.postMessage({ ketok: 'dump', payload: dump }, origin);
      setMsg('Data dikirim ke tab Ketok.');
      window.removeEventListener('message', onMsg);
    }
    window.addEventListener('message', onMsg);

    // Cadangan: kalau handshake tidak terjadi, tembak beberapa kali.
    var tries = 0;
    var iv = setInterval(function () {
      if (sent || tries++ > 20) { clearInterval(iv); if (!sent) setErr('Ketok tidak merespons. Pakai "Simpan JSON".'); return; }
      try { w.postMessage({ ketok: 'dump', payload: dump }, origin); } catch (e) { /* belum siap */ }
    }, 500);
  };

  (function run() {
    var shortcode = shortcodeFromUrl(location.href);
    var mediaId = shortcode ? shortcodeToMediaId(shortcode) : null;
    if (!mediaId) mediaId = mediaIdFromDom();

    $('sc').textContent = shortcode || '—';
    $('mid').textContent = mediaId || '—';

    if (!mediaId) {
      setMsg('Gagal.');
      setErr('Tidak menemukan media ID.\nBuka halaman permalink post-nya dulu\n(instagram.com/p/XXXX/), bukan feed atau story.');
      return;
    }

    var meta = { shortcode: shortcode, mediaId: mediaId, info: null };
    var rawTop = [];
    var rawReplies = [];

    setMsg('Mengambil info post…');

    fetchMediaInfo(mediaId)
      .then(function (info) {
        meta.info = info;
        if (info && info.comment_count != null) {
          setMsg('IG melaporkan ' + info.comment_count + ' komentar.');
        }
        setMsg('Mengambil komentar…');

        return fetchComments(mediaId, function (n, page) {
          $('cnt').textContent = n;
          var target = (info && info.comment_count) || 0;
          setFill(target ? (n / target) * 100 : Math.min(90, page * 8));
          setMsg('Halaman ' + page + ' — ' + n + ' komentar…');
        });
      })
      .then(function (top) {
        rawTop = top;
        var withReplies = top.filter(function (c) { return (c.child_comment_count || 0) > 0; });
        if (!withReplies.length) return [];

        setMsg('Mengambil balasan dari ' + withReplies.length + ' utas…');
        var out = [];
        var i = 0;

        function next() {
          if (i >= withReplies.length) return Promise.resolve(out);
          var parent = withReplies[i++];
          return fetchReplies(mediaId, parent.pk).then(function (kids) {
            kids.forEach(function (k) { out.push({ parent: parent.pk, c: k }); });
            $('rep').textContent = out.length;
            setMsg('Balasan ' + i + '/' + withReplies.length + ' utas…');
            return politeDelay().then(next);
          });
        }
        return next();
      })
      .then(function (replies) {
        rawReplies = replies;

        var flat = rawTop.map(function (c) { return normalize(c, null); });
        replies.forEach(function (r) { flat.push(normalize(r.c, r.parent)); });
        flat = flat.filter(function (c) { return c.pk && Number.isFinite(c.created_at); });

        dump = buildDump(meta, flat, { top: rawTop, replies: rawReplies });

        setFill(100);
        $('cnt').textContent = dump.stats.top_level;
        $('rep').textContent = dump.stats.replies;

        var reported = meta.info && meta.info.comment_count;
        var note = '';
        if (reported != null && flat.length < reported) {
          note = ' (IG bilang ' + reported + ' — selisih biasanya komentar terhapus/ditapis)';
        }
        setMsg('Selesai: ' + flat.length + ' komentar' + note);
        if (errors.length) setErr(errors.length + ' peringatan saat pengambilan (tercatat di dump).');
        enableActions();
      })
      .catch(function (e) {
        setMsg('Gagal.');
        var hint = '';
        if (e.status === 401 || e.status === 403) hint = '\nPastikan kamu login di tab ini.';
        if (e.status === 429) hint = '\nKena rate limit. Tunggu beberapa menit.';
        if (e.status === 404) hint = '\nEndpoint berubah atau post tidak dapat diakses.';
        setErr(e.message + hint);
      });
  })();
})();
