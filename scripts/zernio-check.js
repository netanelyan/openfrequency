#!/usr/bin/env node
// npm run zernio:check                       validate the key and every pack's TikTok account id
// npm run zernio:check -- --pack <id> --send-private --confirm
//                                            and send ONE post to that pack's TikTok account,
//                                            privately (SELF_ONLY), with the AI flag set
//
// Without --send-private it only reads: the key, the connected accounts, which
// pack points at which, and what Zernio will bill for them. With it, it sends the
// newest rendered post of that pack to TikTok as SELF_ONLY, nobody but the
// account sees it, with video_made_with_ai set directly (not as a draft), and
// reports whether Zernio and TikTok accepted the flag, then waits for analytics
// and reports whether numbers come back. It never posts publicly: any privacy
// but SELF_ONLY is refused in this script.

import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { loadEnv, isSet } from '../src/core/env.js';
import { dataDir, ensureDir } from '../src/core/paths.js';
import { loadAll } from '../src/packs/load.js';
import { openDb, Db, j } from '../src/db/index.js';
import { publishZernio, zernioAccounts, zernioAnalytics, ZernioError } from '../src/publish/zernio.js';
import { wantedPublisher } from '../src/publish/index.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const flag = (n) => args.includes(`--${n}`);
const say = (ok, msg) => console.log(`${ok === true ? 'ok  ' : ok === false ? 'FAIL' : '    '} ${msg}`);

if (!isSet('ZERNIO_API_KEY')) {
  say(false, 'ZERNIO_API_KEY is not set in $OF_HOME/.env (zernio.com > Settings > API)');
  process.exit(1);
}

let accounts;
try {
  accounts = await zernioAccounts();
  say(true, `the key works: ${accounts.length} connected account(s) on Zernio`);
} catch (e) {
  say(false, `Zernio refused the key or could not be reached: ${e.message}`);
  process.exit(1);
}
for (const a of accounts) say(null, `${a.platform.padEnd(10)} ${a.id}  @${a.username}${a.active ? '' : '  (needs reconnecting)'}`);

// Zernio bills per connected account: the first 2 free, then $6 a month each (zernio.com/pricing, 2026-10-13).
const paid = Math.max(0, accounts.length - 2);
say(null, `Zernio: ${accounts.length} connected account(s), ${paid} billed: $${paid * 6} a month (outside the $15 cap)`);

const packs = loadAll().filter((p) => !opt('pack') || p.id === opt('pack'));
let bad = 0;
for (const pack of packs) {
  for (const platform of pack.meta.platforms) {
    if (wantedPublisher(pack, platform) !== 'zernio') continue;
    const id = pack.meta.zernio?.accounts?.[platform];
    const a = accounts.find((x) => x.id === id);
    if (!id) (bad++, say(false, `${pack.id}: no zernio.accounts.${platform} in pack.json`));
    else if (!a) (bad++, say(false, `${pack.id}: ${platform} account ${id} is not one of the connected accounts`));
    else if (a.platform !== platform) (bad++, say(false, `${pack.id}: ${id} is a ${a.platform} account, not ${platform}`));
    else if (!a.active) (bad++, say(false, `${pack.id}: ${platform} @${a.username} needs reconnecting in Zernio`));
    else say(true, `${pack.id}: ${platform} → @${a.username} (${id})`);
  }
  if ((pack.meta.zernio?.tiktokPrivacy || 'SELF_ONLY') !== 'SELF_ONLY') say(null, `${pack.id}: tiktokPrivacy is ${pack.meta.zernio.tiktokPrivacy}: posts from the runner will be public`);
}

if (!flag('send-private')) {
  console.log(`\n${bad ? `${bad} problem(s).` : 'Every pack that publishes through Zernio points at a connected account.'} Nothing was sent.`);
  console.log('To test one private post: npm run zernio:check -- --pack <id> --send-private --confirm');
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- one private post
const pack = packs[0];
if (!opt('pack') || !pack) (say(false, '--send-private needs --pack <id>'), process.exit(1));
if (!flag('confirm')) (say(false, 'this sends a real post to TikTok (privately). Add --confirm to do it.'), process.exit(1));
const accountId = pack.meta.zernio?.accounts?.tiktok;
if (!accountId) (say(false, `${pack.id} has no zernio.accounts.tiktok`), process.exit(1));
const base = String(process.env.MEDIA_PUBLIC_BASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(base)) (say(false, 'MEDIA_PUBLIC_BASE_URL must be the https address that serves $OF_HOME/data/public: Zernio fetches slides by URL'), process.exit(1));

/** The newest rendered post of the pack: the live database first, then its last dry run. */
function newestPost() {
  for (const file of [path.join(dataDir(), 'openfrequency.db'), path.join(dataDir(), `dry-${pack.id}.db`)]) {
    if (!existsSync(file)) continue;
    const db = file.endsWith('openfrequency.db') ? openDb() : new Db(file);
    const row = db.get("SELECT id, hook, caption, media_json FROM posts WHERE account_id = ? AND media_json IS NOT NULL ORDER BY created_at DESC LIMIT 1", pack.id);
    const media = j(row?.media_json, {});
    if (row && media.tiktok?.length >= 2 && media.tiktok.every((f) => existsSync(f))) return { ...row, files: media.tiktok };
  }
  return null;
}
const post = newestPost();
if (!post) (say(false, `no rendered post for ${pack.id}: run npm run dry -- --pack ${pack.id} --count 1 first`), process.exit(1));
const token = `zernio-check-${randomBytes(6).toString('hex')}`;
const dir = ensureDir(path.join(dataDir(), 'public', token));
const urls = post.files.map((f) => (copyFileSync(f, path.join(dir, path.basename(f))), `${base}/${token}/${path.basename(f)}`));
say(null, `sending "${post.hook}" (${urls.length} slides) to TikTok, SELF_ONLY, with video_made_with_ai set directly`);

let res;
try {
  res = await publishZernio({ platform: 'tiktok', accountId, caption: `${post.caption}\n\nבדיקה פרטית`, imageUrls: urls, privacy: 'SELF_ONLY', aiLabel: true, title: post.hook, aiAsDraft: false });
  say(true, `accepted: Zernio post ${res.zernioId}, TikTok status "${res.status}"${res.url ? `, ${res.url}` : ''}`);
  say(true, 'the AI flag was accepted on a photo post (no draft needed)');
} catch (e) {
  const aiRefused = e instanceof ZernioError && /ai|made_with|label|disclos/i.test(e.message);
  say(false, `refused at ${e.step || 'create'}: ${e.message}`);
  if (aiRefused) say(null, 'the refusal names the AI flag: keep posts with an AI image as drafts (the engine does this by default)');
  process.exit(1);
}

// Analytics take time to sync; ask a few times.
const waitMin = Number(opt('wait', 10));
const until = Date.now() + waitMin * 60_000;
let stats = null;
while (Date.now() < until) {
  try {
    stats = await zernioAnalytics(res.zernioId);
  } catch (e) {
    say(null, `analytics: ${e.message}`);
  }
  if (stats?.tiktok?.views != null) break;
  await new Promise((r) => setTimeout(r, 60_000));
}
if (stats?.tiktok) say(true, `analytics come back: ${JSON.stringify(stats.tiktok)}`);
else say(null, `no analytics after ${waitMin} minutes (a private post may report none, or they sync later): check the post on the website after a day`);
console.log('\nThe post is private (SELF_ONLY). Delete it in the TikTok app when you are done.');
