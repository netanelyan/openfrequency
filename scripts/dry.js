#!/usr/bin/env node
// npm run dry -- --pack <id> --count 5 [--live] [--format <id>] [--day YYYY-MM-DD]
//
// Builds posts for one pack and writes each to disk: the slides for every
// platform, the caption, every fact with its quote and source (sources.md), and
// the full trace with its cost (post.json). Publishes nothing.
//
// It uses its own database, $OF_HOME/data/dry-<pack>.db, recreated on every run, so a
// dry run never touches the queue the website shows. The fictional demo pack
// works in a fresh clone: with no private folder, the run uses ./.demo instead.

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ROOT, dataDir, ofHome, outDir, examplesDir } from '../src/core/paths.js';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const packId = opt('pack');
const count = Number(opt('count', 5));
if (!packId) {
  console.error('usage: npm run dry -- --pack <id> [--count 5] [--format <id>] [--live]');
  process.exit(1);
}
if (!existsSync(ofHome())) {
  if (existsSync(path.join(examplesDir, packId))) process.env.OF_HOME = path.join(ROOT, '.demo');
  else {
    console.error(`No private folder at ${ofHome()}. Run \`npm run init-private\`, or try \`--pack demo\`.`);
    process.exit(1);
  }
}
process.env.OF_MODE = flag('live') ? 'live' : process.env.OF_MODE || 'recorded';

const { loadEnv } = await import('../src/core/env.js');
loadEnv();
const { Db } = await import('../src/db/index.js');
const { loadPack, loadAll, resolvePackDir } = await import('../src/packs/load.js');
const { makeContext } = await import('../src/engine.js');
const { buildPost } = await import('../src/pipeline/build.js');
const { exportPost } = await import('../src/pipeline/export.js');
const { closeBrowser } = await import('../src/render/render.js');

const dir = resolvePackDir(packId);
if (!dir) {
  console.error(`No pack "${packId}" in ${path.join(ofHome(), 'packs')} or examples/packs.`);
  process.exit(1);
}
const pack = loadPack(dir);
// The other packs are loaded too, so the brand checks (no cross-promotion,
// distinct themes) see the whole set.
// A pack that is not valid yet (one being written) is skipped here with a
// warning: a dry run of one pack should not fail on another's half-written file.
const { packDirs } = await import('../src/packs/load.js');
const others = [];
for (const d of packDirs()) {
  if (path.resolve(d) === path.resolve(dir)) continue;
  try {
    others.push(loadPack(d));
  } catch (e) {
    console.log(`(skipping ${path.basename(d)} for the brand checks: ${e.message.split('\n')[0]})`);
  }
}
// One database and one media folder per pack, so two dry runs can go at once.
const dbFile = path.join(dataDir(), `dry-${pack.id}.db`);
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) rmSync(f, { force: true });
const db = new Db(dbFile);
const runOut = path.join(outDir(), 'dry', pack.id);
rmSync(runOut, { recursive: true, force: true });

const ctx = makeContext({ db, packs: [pack, ...others], log: () => {} });
ctx.mediaDir = path.join(dataDir(), 'dry-media', pack.id);
rmSync(ctx.mediaDir, { recursive: true, force: true });
console.log(`dry run: ${pack.meta.displayName} (${pack.id}), ${count} posts, mode ${ctx.mode}${ctx.mode === 'recorded' ? ' (recorded sources and drafts, no network)' : ''}`);

const rows = [];
const t0 = Date.now();
for (let i = 0; i < count; i++) {
  const res = await buildPost(ctx, { pack, formatKey: opt('format'), day: opt('day') });
  const folder = path.join(runOut, `${String(i + 1).padStart(2, '0')}-${res.postId}`);
  exportPost(db, res.postId, folder);
  const post = db.get('SELECT hook, format_id, review_score, cost_usd, cost_estimated FROM posts WHERE id = ?', res.postId);
  const slides = db.get('SELECT COUNT(*) AS n FROM slides WHERE post_id = ?', res.postId).n;
  const facts = db.get('SELECT COUNT(*) AS n FROM facts WHERE post_id = ? AND verified = 1', res.postId).n;
  rows.push({ ...res, ...post, slides, facts, folder });
  console.log(
    `${res.status === 'queued' ? 'ok ' : 'NO '} ${String(i + 1).padStart(2)}. ${res.status.padEnd(7)} ${String(post.format_id).padEnd(14)} slides ${slides}  facts ${facts}  bot ${post.review_score ?? '-'}/10  $${post.cost_usd.toFixed(4)}${post.cost_estimated ? ' (est.)' : ''}  ${post.hook || res.reason || ''}`
  );
}
await closeBrowser();
const ok = rows.filter((r) => r.status === 'queued');
const avg = ok.length ? ok.reduce((s, r) => s + r.cost_usd, 0) / ok.length : 0;
console.log(`\n${ok.length}/${count} rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${avg ? `$${avg.toFixed(4)} per post${ok.some((r) => r.cost_estimated) ? ' (estimated from recorded prompts and answers)' : ''}` : ''}`);
console.log(`output: ${runOut}`);
process.exit(ok.length === count ? 0 : 2);
