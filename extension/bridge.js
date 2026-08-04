/**
 * Jembatan antara halaman Ketok dan service worker.
 *
 * Disuntikkan hanya ke alamat Ketok (lihat manifest). Halaman berbicara lewat
 * window.postMessage, jadi ia tidak perlu tahu ID extension sama sekali —
 * artinya extension tetap bisa dipasang unpacked tanpa menyetel apa pun.
 */
(function () {
  'use strict';

  function reply(msg) {
    window.postMessage(Object.assign({ ketokExt: 'res' }, msg), location.origin);
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.ketokExt !== 'req') return;

    if (d.action === 'ping') {
      reply({ id: d.id, kind: 'done', version: chrome.runtime.getManifest().version });
      return;
    }

    if (d.action !== 'extract' && d.action !== 'segarkanSesi') return;

    var port;
    try {
      port = chrome.runtime.connect({ name: 'ketok' });
    } catch (e) {
      reply({ id: d.id, kind: 'error', message: 'Extension tidak merespons. Muat ulang halaman ini.' });
      return;
    }

    var finished = false;
    port.onMessage.addListener(function (m) {
      if (m.kind === 'done' || m.kind === 'error') finished = true;
      reply(Object.assign({ id: d.id }, m));
      if (finished) port.disconnect();
    });
    port.onDisconnect.addListener(function () {
      if (finished) return;
      reply({
        id: d.id,
        kind: 'error',
        message: 'Sambungan ke extension terputus di tengah penarikan. Coba lagi.'
      });
    });

    port.postMessage(d.action === 'segarkanSesi'
      ? { action: 'segarkanSesi', api: d.api, token: d.token }
      : { action: 'extract', url: d.url, includeRaw: d.includeRaw });
  });

  // Penanda supaya halaman tahu extension ada bahkan sebelum ping dijawab.
  document.documentElement.setAttribute('data-ketok-ext', chrome.runtime.getManifest().version);
})();
