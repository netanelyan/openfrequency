// Hands covers of the fictional demo account's posts to the website (openfrequency-web, scripts/showcase.mjs), as
// Teder drew them: the first slide of each post, at TikTok and Instagram size, with a manifest of what it says and
// whose photo it carries.
//
//   npm run demo -- --no-serve                                        builds the demo home (.demo) first
//   node scripts/showcase.js <to> [kind ...]                          the latest demo post of each kind, in that order
//   node scripts/showcase.js ../openfrequency-web/private/assistant what-happened story meme
//
// Only from a fictional pack (pack.json "fictional": true) in a demo home: a real account's post never leaves Teder
// this way. <to> is emptied first, then gets one folder per post, numbered in the order asked: 1-<kind>/.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/core/paths.js';
import { openDb } from '../src/db/index.js';

const [to, ...kinds] = process.argv.slice(2);
if (!to || !kinds.length) {
  console.error('usage: node scripts/showcase.js <to> <kind> [kind ...]');
  process.exit(1);
}
const home = path.resolve(process.env.OF_HOME || path.join(ROOT, '.demo'));
const file = path.join(home, 'data', 'openfrequency.db');
if (!existsSync(file)) {
  console.error(`no demo home at ${home}: run npm run demo -- --no-serve first`);
  process.exit(1);
}
const db = openDb(file);
const j = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

const out = [];
for (const kind of kinds) {
  const post = db.get(
    "SELECT * FROM posts WHERE kind = ? AND media_json IS NOT NULL AND status IN ('queued','approved','published') ORDER BY created_at DESC LIMIT 1",
    kind,
  );
  if (!post) throw new Error(`no drawn post of kind ${kind} in ${home}`);
  const packFile = path.join(home, 'packs', post.account_id, 'pack.json');
  const pack = existsSync(packFile) ? JSON.parse(readFileSync(packFile, 'utf8')) : null;
  if (pack?.fictional !== true) throw new Error(`${post.account_id}: not a fictional pack, nothing is handed over`);
  const slide = db.get('SELECT * FROM slides WHERE post_id = ? AND idx = 0', post.id);
  const files = j(slide?.files_json, {});
  if (!files.tiktok || !files.instagram) throw new Error(`${post.id}: no cover drawn at both sizes`);
  const img = slide.image_id ? db.get('SELECT * FROM images WHERE id = ?', slide.image_id) : null;
  out.push({ kind, post, pack, files, img });
}

rmSync(to, { recursive: true, force: true });
out.forEach(({ kind, post, pack, files, img }, i) => {
  const dir = path.join(to, `${i + 1}-${kind}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(files.tiktok, path.join(dir, 'tiktok-01.jpg'));
  copyFileSync(files.instagram, path.join(dir, 'instagram-01.jpg'));
  const manifest = {
    pack: pack.id,
    handle: '@' + pack.handle,
    account: pack.displayName,
    topic: post.topic || post.hook.replace(/\s*\n\s*/g, ' '),
    kind,
    slides: [{
      n: 1,
      kind: 'cover',
      files: { tiktok: 'tiktok-01.jpg', instagram: 'instagram-01.jpg' },
      text: [post.hook, post.sub].filter(Boolean),
      carries: img ? 'photo' : 'type',
      ...(img ? { photo: { provider: img.provider, page: img.source_url, photographer: img.author, licence: img.license, licenceUrl: img.license_url } } : {}),
    }],
    made: { by: 'openfrequency-teder scripts/showcase.js, from the demo home', post: post.id, at: new Date().toISOString() },
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${i + 1}. ${kind}: ${post.hook.replace(/\s*\n\s*/g, ' ')}`);
});
