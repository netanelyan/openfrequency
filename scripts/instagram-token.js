#!/usr/bin/env node
// npm run instagram:token -- --pack <id> --short <short-lived token>
//
// Makes a pack's lasting Instagram token from a short-lived one, the way the
// README's Instagram section describes, and stores it in the database for the
// pack (the engine reads it from there and refreshes it when it has to). It
// also prints the line to put in $OF_HOME/.env, so the token survives a new
// database.
//
// Facebook Login (instagram.auth "facebook", the default): the short token is a
// user token from the Graph API Explorer with instagram_basic,
// instagram_content_publish, instagram_manage_insights, pages_show_list and
// pages_read_engagement. It is exchanged for a 60-day user token (needs
// META_APP_ID and META_APP_SECRET), and the Page linked to the Instagram account
// gives a Page token that does not expire. Without instagram.userId in pack.json
// it lists the Pages and their Instagram accounts, to pick from.
//
// Instagram Login (instagram.auth "instagram"): the short token comes from the
// app's Instagram login; it is exchanged for a 60-day token (needs META_APP_SECRET).

import { loadEnv } from '../src/core/env.js';
import { getJson } from '../src/core/net.js';
import { openDb } from '../src/db/index.js';
import { loadPack, resolvePackDir } from '../src/packs/load.js';
import { GRAPH_VERSION, igConfig, storeToken } from '../src/publish/instagram.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const die = (m) => (console.error(m), process.exit(1));

const dir = resolvePackDir(opt('pack') || '');
if (!dir) die('usage: npm run instagram:token -- --pack <id> --short <token>');
const pack = loadPack(dir);
const cfg = igConfig(pack);
const short = String(opt('short') || '').trim();
if (!short) die('--short <token> is required (Graph API Explorer, or the app\'s Instagram login)');
const { META_APP_ID: appId, META_APP_SECRET: secret } = process.env;
const redact = (s) => String(s).split(short).join('***').split(secret || '\u0000').join('***');
const db = openDb();

try {
  if (cfg.auth === 'instagram') {
    if (!secret) die('META_APP_SECRET is needed (developers.facebook.com > your app > App settings > Basic)');
    const r = await getJson(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: secret, access_token: short })}`);
    const expiresAt = Date.now() + (Number(r.expires_in) || 60 * 86_400) * 1000;
    storeToken(db, pack, r.access_token, { expiresAt });
    console.log(`A 60-day Instagram token is stored for ${pack.id}; it expires ${new Date(expiresAt).toISOString().slice(0, 10)} and the runner refreshes it before then.`);
    console.log(`\nAdd to $OF_HOME/.env:\n${cfg.tokenEnv}=${r.access_token}`);
    process.exit(0);
  }
  if (!appId || !secret) die('META_APP_ID and META_APP_SECRET are needed to make a lasting token (developers.facebook.com > your app > App settings > Basic)');
  const G = `https://graph.facebook.com/${GRAPH_VERSION()}`;
  const long = await getJson(`${G}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: short })}`);
  const pages = (await getJson(`${G}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account', access_token: long.access_token })}`))?.data || [];
  if (!pages.length) die('The token sees no Facebook Page. The Instagram account must be a business or creator account linked to a Page you manage, and the token needs pages_show_list.');
  const linked = pages.filter((p) => p.instagram_business_account?.id);
  if (!cfg.userId) {
    console.log('pack.json has no instagram.userId yet. The Pages this token manages, and their Instagram accounts:');
    for (const p of pages) console.log(`  Page "${p.name}" (${p.id}) → Instagram account ${p.instagram_business_account?.id || '(none linked)'}`);
    console.log('\nPut the right Instagram account id in pack.json as instagram.userId, then run this again.');
    process.exit(0);
  }
  const page = linked.find((p) => String(p.instagram_business_account.id) === cfg.userId);
  if (!page) die(`None of the token's Pages is linked to Instagram account ${cfg.userId}. Linked: ${linked.map((p) => `${p.name} → ${p.instagram_business_account.id}`).join(', ') || 'none'}`);
  storeToken(db, pack, page.access_token, { expiresAt: null });
  console.log(`A Page token for "${page.name}" is stored for ${pack.id}. Page tokens made this way do not expire; Meta can still end their data access after 90 days without use, which npm run instagram:check reports.`);
  console.log(`\nAdd to $OF_HOME/.env:\n${cfg.tokenEnv}=${page.access_token}`);
} catch (e) {
  die(`Meta refused: ${redact(e.message)}`);
}
