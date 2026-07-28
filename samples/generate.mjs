/**
 * Membuat dua snapshot contoh untuk menguji Ketok tanpa menyentuh Instagram.
 *
 *   node generate.mjs
 *
 * Skenario: lelang jam tangan, dibuka 20:00 WIB, ditutup 21:00 WIB
 * (2026-07-27). Sengaja mengandung setiap kelainan yang dideteksi Ketok:
 * bid lewat cutoff, dua bid pada detik yang sama, bid turun, komentar
 * beruntun, akun yang baru muncul di menit akhir, dan satu komentar yang
 * dihapus di antara dua penarikan.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// 2026-07-27 20:00:00 WIB = 13:00:00 UTC
const START = Date.UTC(2026, 6, 27, 13, 0, 0) / 1000;
const CUTOFF = START + 3600;                       // 21:00 WIB
const MEDIA_ID = '3412345678901234567';
const SHORTCODE = 'C9xKtOkAbCd';

// [detik dari mulai, username, teks]
const SCRIPT = [
  [0, 'rizky_watchs', 'OB 500rb'],
  [47, 'jamtangan.bdg', '550rb'],
  [121, 'seiko_lover88', '600 rb'],
  [198, 'rizky_watchs', '650rb'],
  [204, 'om_koleksi', 'masih ori kan bos?'],
  [335, 'jamtangan.bdg', '700rb'],
  [512, 'seiko_lover88', '750rb'],
  [688, 'diver_kaki5', '800rb'],
  [690, 'diver_kaki5', 'up 800rb ya'],                    // beruntun
  [901, 'rizky_watchs', '850rb'],
  [1140, 'jamtangan.bdg', '900rb'],
  [1355, 'seiko_lover88', '950rb'],
  [1502, 'om_koleksi', '1jt'],
  [1733, 'diver_kaki5', '1,05jt'],
  [1980, 'rizky_watchs', '1.100.000'],
  [2210, 'jamtangan.bdg', '1,15jt'],
  [2455, 'seiko_lover88', '1,2jt'],
  [2610, 'newbie_2026', 'nyimak dulu'],
  [2788, 'om_koleksi', '1,25jt'],
  [2990, 'diver_kaki5', '1,3jt'],
  [3210, 'rizky_watchs', '1,35jt'],
  [3402, 'jamtangan.bdg', '1,4jt'],
  [3488, 'seiko_lover88', '1,3jt'],                        // bid turun
  [3521, 'sniper_lelang', '1,45jt'],                       // masuk belakangan
  [3560, 'om_koleksi', '1,5jt'],                           // detik akhir
  [3560, 'sniper_lelang', '1,55jt'],                       // detik kembar
  [3594, 'diver_kaki5', '1,6jt'],                          // detik akhir
  [3599, 'sniper_lelang', '1,65jt'],                       // detik akhir, 1 detik sebelum tutup
  [3607, 'jamtangan.bdg', '1,7jt'],                        // LEWAT CUTOFF
  [3641, 'sniper_lelang', '1,75jt'],                       // LEWAT CUTOFF
  [3702, 'om_koleksi', 'closing dong min'],
  [3980, 'rizky_watchs', 'yg menang siapa nih?']
];

// Komentar yang ada di snapshot 1 tapi dihapus sebelum snapshot 2.
const DELETED_LATER = [
  [3565, 'panitia_lelang', 'sniper_lelang boleh lanjut, sisanya stop'],
  [3830, 'sniper_lelang', 'oke fix 1,75jt ya min sesuai kesepakatan wa']
];

let seq = 0;
const nextPk = () => String(18500000000000000000n + BigInt(++seq) * 1373n);

const USER_PK = new Map();
const userPk = (u) => {
  if (!USER_PK.has(u)) USER_PK.set(u, String(1000000 + USER_PK.size * 74531));
  return USER_PK.get(u);
};

function mk([offset, username, text]) {
  return {
    pk: nextPk(),
    user_id: Number(userPk(username)),
    text,
    type: 0,
    created_at: START + offset,
    created_at_utc: START + offset,
    content_type: 'comment',
    status: 'Active',
    comment_like_count: 0,
    child_comment_count: 0,
    has_liked_comment: false,
    user: {
      pk: Number(userPk(username)),
      username,
      full_name: username.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      is_verified: false,
      profile_pic_url: `https://example.invalid/${username}.jpg`
    }
  };
}

// Satu balasan bersarang di komentar pertanyaan "masih ori kan bos?".
const all = SCRIPT.map(mk);
const deleted = DELETED_LATER.map(mk);
const parent = all.find((c) => c.text.startsWith('masih ori'));
parent.child_comment_count = 1;
const reply = mk([260, 'rizky_watchs', 'ori bos, ada box papernya']);

function build(comments, replies, extractedAt) {
  const flat = comments.map((c) => ({
    pk: c.pk,
    parent_pk: null,
    is_reply: false,
    created_at: c.created_at,
    text: c.text,
    username: c.user.username,
    user_pk: String(c.user.pk),
    full_name: c.user.full_name,
    is_verified: false,
    like_count: c.comment_like_count,
    child_comment_count: c.child_comment_count
  }));
  for (const r of replies) {
    flat.push({
      pk: r.c.pk,
      parent_pk: r.parent,
      is_reply: true,
      created_at: r.c.created_at,
      text: r.c.text,
      username: r.c.user.username,
      user_pk: String(r.c.user.pk),
      full_name: r.c.user.full_name,
      is_verified: false,
      like_count: r.c.comment_like_count,
      child_comment_count: 0
    });
  }

  return {
    ketok: {
      version: '0.1.0',
      extracted_at: extractedAt,
      extracted_at_iso: new Date(extractedAt * 1000).toISOString(),
      extractor_tz: 'Asia/Jakarta'
    },
    source: {
      url: `https://www.instagram.com/p/${SHORTCODE}/`,
      shortcode: SHORTCODE,
      media_id: MEDIA_ID,
      owner_username: 'lapak.jam.contoh',
      post_taken_at: START - 7200,
      caption: 'LELANG Seiko SKX007 — OB 500rb, kelipatan 50rb, CLOSED 21.00 WIB',
      reported_comment_count: flat.length
    },
    stats: {
      fetched: flat.length,
      top_level: flat.filter((c) => !c.is_reply).length,
      replies: flat.filter((c) => c.is_reply).length,
      errors: []
    },
    comments: flat,
    raw: { top: comments, replies }
  };
}

const replies = [{ parent: parent.pk, c: reply }];

// Snapshot 1: saat lelang baru tutup, masih lengkap.
const snap1 = [...all, ...deleted].sort((a, b) => a.created_at - b.created_at);
// Snapshot 2: keesokan harinya, dua komentar sudah dihapus.
const snap2 = all.slice().sort((a, b) => a.created_at - b.created_at);

writeFileSync(
  join(here, 'contoh-snapshot-1.json'),
  JSON.stringify(build(snap1, replies, CUTOFF + 300), null, 2)
);
writeFileSync(
  join(here, 'contoh-snapshot-2.json'),
  JSON.stringify(build(snap2, replies, CUTOFF + 86400), null, 2)
);

console.log(`Mulai lelang : ${new Date(START * 1000).toISOString()}  (20:00 WIB)`);
console.log(`Cutoff       : ${new Date(CUTOFF * 1000).toISOString()}  (21:00 WIB) = epoch ${CUTOFF}`);
console.log(`Snapshot 1   : ${snap1.length + replies.length} komentar  -> contoh-snapshot-1.json`);
console.log(`Snapshot 2   : ${snap2.length + replies.length} komentar  -> contoh-snapshot-2.json`);
console.log(`Selisih      : ${DELETED_LATER.length} komentar dihapus`);
