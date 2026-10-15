#!/usr/bin/env node
// npm run instagram:check [-- --pack <id>] [-- --refresh]
// npm run instagram:check -- --pack <id> --publish --confirm
//
// For every pack that publishes to Instagram directly (pack.json
// "publishers": { "instagram": "instagram" }): is the token there, does it reach
// the account in pack.json, when does it expire (and, for a Page token, when
// does Meta's data access lapse), how much of the publishing quota is left,
// and can the insights of a post be read. --refresh refreshes an Instagram Login
// token now. It reads only, unless --publish --confirm is given: then it
// publishes the pack's newest rendered post to Instagram as a carousel. That
// post is PUBLIC: Instagram has no private posts.

import { copyFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { loadEnv } from '../src/core/env.js';
import { dataDir, ensureDir } from '../src/core/paths.js';
import { loadAll } from '../src/packs/load.js';
import { openDb, Db, j } from '../src/db/index.js';
import { account, currentToken, igConfig, insights, publishInstagram, quota, recentMedia, refreshToken, tokenStatus } from '../src/publish/instagram.js';
import { wantedPublisher } from '../src/publish/index.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const flag = (n) => args.includes(`--${n}`);
const say = (ok, msg) => console.log(`${ok === true ? 'ok  ' : ok === false ? 'FAIL' : '    '} ${msg}`);

const db = openDb();
const packs = loadAll().filter((p) => (opt('pack') ? p.id === opt('pack') : p.meta.platforms.includes('instagram') && wantedPublisher(p, 'instagram') === 'instagram'));
if (!packs.length) {
  console.log('No pack publishes to Instagram directly. Set "publishers": { "instagram": "instagram" } and "instagram": { "userId": ... } in its pack.json.');
  process.exit(0);
}

let bad = 0;
for (const pack of packs) {
  const cfg = igConfig(pack);
  console.log(`\n${pack.id} (${cfg.auth === 'instagram' ? 'Instagram Login' : 'Facebook Login, a Page token'})`);
  if (!cfg.userId) (bad++, say(false, 'no instagram.userId in pack.json (npm run instagram:token finds it)'));
  if (!currentToken(db, pack)) {
    bad++;
    say(false, `no token: set ${cfg.tokenEnv} in $OF_HOME/.env, or run npm run instagram:token -- --pack ${pack.id} --short <token>`);
    continue;
  }
  try {
    if (flag('refresh')) {
      const r = await refreshToken(db, pack, { force: true });
      say(r.refreshed ? true : null, r.refreshed ? `refreshed: valid for ${Math.floor(r.daysLeft)} more days` : `not refreshed: ${r.reason}`);
    }
    const st = await tokenStatus(db, pack);
    if (st.valid === false) (bad++, say(false, 'Meta says the token is not valid'));
    if (st.daysLeft === 0 || (st.daysLeft == null && cfg.auth === 'facebook' && st.valid)) say(true, 'the token does not expire (a Page token)');
    else if (st.daysLeft != null) say(st.daysLeft > 14, `the token expires in ${st.daysLeft} days${cfg.auth === 'instagram' ? ' (the runner refreshes it when 20 are left)' : ''}`);
    else say(null, cfg.auth === 'facebook' ? 'expiry unknown: set META_APP_ID and META_APP_SECRET to ask Meta' : 'expiry unknown until the first refresh (npm run instagram:check -- --refresh)');
    if (st.dataAccessDaysLeft != null) say(st.dataAccessDaysLeft > 14, `Meta's data access for this token lapses in ${st.dataAccessDaysLeft} days unless it is used (publishing and reading insights use it)`);
    if (st.scopes) {
      const need = cfg.auth === 'instagram' ? ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_insights'] : ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_read_engagement'];
      const missing = need.filter((s) => !st.scopes.includes(s));
      say(!missing.length, missing.length ? `missing permissions: ${missing.join(', ')}` : `permissions: ${need.join(', ')}`);
      // Deleting a post after a takedown notice: Facebook Login only, its own permission.
      if (cfg.auth === 'facebook') say(st.scopes.includes('instagram_manage_contents') ? true : null, st.scopes.includes('instagram_manage_contents') ? 'instagram_manage_contents: a takedown can delete the post through the API' : 'no instagram_manage_contents: after a takedown notice the post is listed for you to delete by hand (grant it to let the engine delete)');
    }
    const a = await account(db, pack);
    const accountId = String(a.user_id ?? a.id);
    say(accountId === cfg.userId, `the token reaches @${a.username} (${accountId}), ${a.media_count ?? '?'} posts${accountId === cfg.userId ? '' : ` but pack.json says ${cfg.userId}`}`);
    const q = await quota(db, pack).catch((e) => (say(null, `quota: ${e.message}`), null));
    if (q) say(true, `publishing quota: ${q.used} of ${q.total ?? '?'} used in the last 24 hours`);
    const media = await recentMedia(db, pack, { limit: 3 });
    if (!media.length) say(null, 'no posts yet, so no insights to read: they can be checked after the first post');
    else {
      const m = await insights(db, pack, media[0].id);
      say(Boolean(m), m ? `insights of the latest post (${media[0].media_type}, ${media[0].timestamp}): ${JSON.stringify(m)}` : 'the latest post has no insights yet (Meta delays them up to 48 hours)');
    }
  } catch (e) {
    bad++;
    say(false, `${e.step ? `${e.step}: ` : ''}${e.message}${e.code ? ` [code ${e.code}${e.subcode ? `/${e.subcode}` : ''}]` : ''}`);
  }
}

if (!flag('publish')) {
  console.log(`\n${bad ? `${bad} problem(s).` : 'Every Instagram pack is ready.'} Nothing was published.`);
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- one real post (public)
const pack = packs[0];
if (!opt('pack')) (say(false, '--publish needs --pack <id>'), process.exit(1));
if (!flag('confirm')) (say(false, 'this publishes a PUBLIC post on Instagram. Add --confirm to do it.'), process.exit(1));
const base = String(process.env.MEDIA_PUBLIC_BASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(base)) (say(false, 'MEDIA_PUBLIC_BASE_URL must be the https address that serves $OF_HOME/data/public: Instagram fetches slides by URL'), process.exit(1));
let post = null;
for (const file of [path.join(dataDir(), 'openfrequency.db'), path.join(dataDir(), `dry-${pack.id}.db`)]) {
  if (post || !existsSync(file)) continue;
  const d = file.endsWith('openfrequency.db') ? db : new Db(file);
  const row = d.get("SELECT id, hook, caption, hashtags_json, media_json FROM posts WHERE account_id = ? AND media_json IS NOT NULL ORDER BY created_at DESC LIMIT 1", pack.id);
  const files = j(row?.media_json, {}).instagram || [];
  if (row && files.length >= 2 && files.every((f) => existsSync(f))) post = { ...row, files };
}
if (!post) (say(false, `no rendered post for ${pack.id}: run npm run dry -- --pack ${pack.id} --count 1 first`), process.exit(1));
const token = `instagram-check-${randomBytes(6).toString('hex')}`;
const dir = ensureDir(path.join(dataDir(), 'public', token));
const urls = post.files.map((f) => (copyFileSync(f, path.join(dir, path.basename(f))), `${base}/${token}/${path.basename(f)}`));
try {
  const r = await publishInstagram(db, pack, { caption: [post.caption, j(post.hashtags_json, []).join(' ')].filter(Boolean).join('\n\n'), imageUrls: urls });
  say(true, `published: media ${r.mediaId}${r.url ? `, ${r.url}` : ''}`);
} catch (e) {
  say(false, `${e.step ? `${e.step}: ` : ''}${e.message}`);
  process.exit(1);
}
