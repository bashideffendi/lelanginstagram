/**
 * Uji salinan ig-core untuk extension.
 *
 * shared/ig-core.js adalah satu-satunya tempat penarikan dari Instagram, tapi
 * extension tidak bisa mengimpornya — ia butuh salinan sendiri yang dibuat
 * build.mjs. Salinan itu pernah basi dua commit tanpa satu pun tanda, dan
 * extension justru jalur yang paling sering dipakai. Kalau Instagram mengubah
 * endpoint dan cuma salinan pusatnya yang dibetulkan, extension diam-diam
 * memakai kode lama.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const akar = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('salinan ig-core untuk extension tidak basi', () => {
  const pusat = fs.readFileSync(path.join(akar, 'shared/ig-core.js'), 'utf8');
  const salinan = fs.readFileSync(path.join(akar, 'extension/ig-core.js'), 'utf8');

  // Baris pertama salinan adalah penanda yang ditambahkan build.mjs.
  const isi = salinan.replace(/^\/\* Disalin dari[^\n]*\n/, '');

  assert.equal(isi.trim(), pusat.trim(),
    'extension/ig-core.js beda dari shared/ig-core.js — jalankan "npm run build:bookmarklet"');
});
