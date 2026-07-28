/*!
 * Ketok — ekstraktor komentar Instagram (bookmarklet)
 *
 * Dijalankan dari halaman post Instagram yang sedang kamu buka. Semua request
 * memakai sesi login browser kamu sendiri; tidak ada server perantara dan tidak
 * ada kredensial yang keluar dari browser.
 *
 * Fungsi penarikannya ada di shared/ig-core.js dan ditanam ke sini saat build.
 */
(function () {
  'use strict';

  var VERSION = '__KETOK_VERSION__';
  var WEB_APP = '__KETOK_WEB_APP__';

  try {
    var ov = localStorage.getItem('ketok_web');
    if (ov) WEB_APP = ov;
  } catch (e) { /* localStorage bisa diblokir */ }

  if (window.__KETOK_RUNNING__) {
    alert('Ketok sudah jalan di tab ini.');
    return;
  }
  window.__KETOK_RUNNING__ = true;

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

  // ---------------------------------------------------------------- panel

  var host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;';
  document.body.appendChild(host);
  var sr = host.attachShadow({ mode: 'open' });

  sr.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '*{box-sizing:border-box;margin:0;padding:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}' +
    '.p{width:330px;background:#fff;color:#16191d;border:1px solid #e3e6eb;border-radius:12px;' +
    'box-shadow:0 12px 40px rgba(16,24,40,.18);overflow:hidden;font-size:14px;line-height:1.55}' +
    '.h{display:flex;align-items:center;gap:9px;padding:13px 16px;border-bottom:1px solid #e3e6eb}' +
    '.h b{font-size:15px;font-weight:700}' +
    '.h i{width:9px;height:9px;border-radius:2px;background:#c2620a;transform:rotate(45deg)}' +
    '.h span{margin-left:auto;color:#6b7684;font-size:11px}' +
    '.x{cursor:pointer;color:#6b7684;padding:0 3px;font-size:17px;line-height:1}' +
    '.x:hover{color:#16191d}' +
    '.b{padding:16px}' +
    '.row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;color:#6b7684;font-size:13px}' +
    '.row b{color:#16191d;font-weight:600;font-variant-numeric:tabular-nums}' +
    '.bar{height:6px;background:#eef0f3;border-radius:3px;overflow:hidden;margin:13px 0 9px}' +
    '.bar i{display:block;height:100%;background:#c2620a;width:0;transition:width .25s}' +
    '.msg{color:#4a5460;min-height:20px;font-size:13.5px}' +
    '.err{color:#b42318;white-space:pre-wrap;word-break:break-word;margin-top:9px;font-size:13px}' +
    '.btns{display:flex;gap:7px;margin-top:14px;flex-wrap:wrap}' +
    'button{flex:1 1 auto;cursor:pointer;border:1px solid #d3d8e0;background:#fff;color:#16191d;' +
    'padding:9px 12px;border-radius:8px;font-size:13px;font-weight:600}' +
    'button:hover:not(:disabled){border-color:#6b7684}' +
    'button:disabled{opacity:.45;cursor:default}' +
    'button.pri{background:#c2620a;border-color:#c2620a;color:#fff}' +
    'button.pri:hover:not(:disabled){background:#a85408;border-color:#a85408}' +
    'label{display:flex;align-items:center;gap:7px;color:#6b7684;margin-top:11px;cursor:pointer;font-size:12.5px}' +
    '</style>' +
    '<div class="p">' +
    '<div class="h"><i></i><b>Ketok</b><span>v' + VERSION + '</span><div class="x" id="close">&times;</div></div>' +
    '<div class="b">' +
    '<div class="row"><span>Komentar</span><b id="cnt">0</b></div>' +
    '<div class="row"><span>Balasan</span><b id="rep">0</b></div>' +
    '<div class="row"><span>Tujuan</span><b id="dest"></b></div>' +
    '<div class="bar"><i id="fill"></i></div>' +
    '<div class="msg" id="msg">Menyiapkan&hellip;</div>' +
    '<div class="err" id="err"></div>' +
    '<label><input type="checkbox" id="raw" checked> Sertakan data asli sebagai bukti</label>' +
    '<div class="btns">' +
    '<button class="pri" id="open" disabled>Buka di Ketok</button>' +
    '<button id="save" disabled>Simpan berkas</button>' +
    '</div>' +
    '</div></div>';

  var $ = function (id) { return sr.getElementById(id); };
  var setMsg = function (t) { $('msg').textContent = t; };
  var setErr = function (t) { $('err').textContent = t; };
  var setFill = function (p) { $('fill').style.width = Math.max(0, Math.min(100, p)) + '%'; };

  // Alamat tujuan dipanggang saat build. Ditampilkan supaya bookmarklet lama
  // yang menunjuk domain usang langsung ketahuan, bukan bikin bingung.
  try {
    $('dest').textContent = new URL(WEB_APP).host;
    $('dest').title = WEB_APP;
  } catch (e) {
    $('dest').textContent = WEB_APP;
  }

  $('close').onclick = function () {
    host.remove();
    window.__KETOK_RUNNING__ = false;
  };

  // ---------------------------------------------------------------- hasil

  var dump = null;

  function payload() {
    if ($('raw').checked) return dump;
    var copy = {};
    for (var k in dump) if (k !== 'raw') copy[k] = dump[k];
    return copy;
  }

  $('save').onclick = function () {
    var name = 'ketok_' + (dump.source.shortcode || dump.source.media_id) +
      '_' + dump.ketok.extracted_at + '.json';
    var blob = new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    setMsg('Tersimpan: ' + name);
  };

  $('open').onclick = function () {
    var target = WEB_APP.replace(/\/+$/, '');
    var w = window.open(target + '/#handoff', '_blank');
    if (!w) { setErr('Popup diblokir. Pakai "Simpan berkas" lalu jatuhkan berkasnya di Ketok.'); return; }

    setMsg('Menunggu Ketok siap&hellip;');
    var sent = false;
    var origin = (function () { try { return new URL(target).origin; } catch (e) { return '*'; } })();
    var data = payload();

    function onMsg(ev) {
      if (!ev.data || ev.data.ketok !== 'ready' || sent) return;
      sent = true;
      w.postMessage({ ketok: 'dump', payload: data }, origin);
      setMsg('Data dikirim ke tab Ketok.');
      window.removeEventListener('message', onMsg);
    }
    window.addEventListener('message', onMsg);

    var tries = 0;
    var iv = setInterval(function () {
      if (sent || tries++ > 20) {
        clearInterval(iv);
        if (!sent) setErr('Ketok tidak merespons. Pakai "Simpan berkas".');
        return;
      }
      try { w.postMessage({ ketok: 'dump', payload: data }, origin); } catch (e) { /* belum siap */ }
    }, 500);
  };

  // ---------------------------------------------------------------- jalan

  extract({
    base: '',
    url: location.href,
    version: VERSION,
    via: 'bookmarklet',
    includeRaw: true,
    fallbackMediaId: mediaIdFromDom,
    onProgress: function (p) {
      if (p.stage === 'info') setMsg('Mengambil keterangan postingan…');
      else if (p.stage === 'comments') {
        $('cnt').textContent = p.count;
        setFill(p.total ? (p.count / p.total) * 100 : Math.min(90, (p.page || 0) * 8));
        setMsg('Halaman ' + (p.page || 1) + ' — ' + p.count + ' komentar…');
      } else if (p.stage === 'replies') {
        $('rep').textContent = p.count;
        setMsg('Mengambil balasan ' + p.page + ' dari ' + p.total + ' utas…');
      }
    }
  })
    .then(function (d) {
      dump = d;
      setFill(100);
      $('cnt').textContent = d.stats.top_level;
      $('rep').textContent = d.stats.replies;

      var reported = d.source.reported_comment_count;
      var note = '';
      if (reported != null && d.stats.fetched < reported) {
        note = ' — Instagram menghitung ' + reported +
          ', selisihnya kemungkinan sudah dihapus atau disaring';
      }
      setMsg('Selesai: ' + d.stats.fetched + ' komentar' + note);
      if (d.stats.errors.length) {
        setErr(d.stats.errors.length + ' peringatan saat pengambilan (tercatat di berkas).');
      }
      $('open').disabled = $('save').disabled = false;
    })
    .catch(function (e) {
      setMsg('Gagal.');
      var hint = '';
      if (e.status === 401 || e.status === 403) hint = '\nPastikan kamu sudah login di tab ini.';
      else if (e.status === 429) hint = '\nKena batas permintaan. Tunggu beberapa menit.';
      else if (e.status === 404) hint = '\nEndpoint Instagram kemungkinan berubah.';
      setErr(e.message + hint);
    });
})();
