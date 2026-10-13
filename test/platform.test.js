import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/core/paths.js';
import { assertAllowed, isSocial, WRITE_RULES, READ_RULES } from '../src/core/net.js';

// HARD RULE 1: the engine never likes, follows, comments, DMs, or reads other
// accounts by logging in. There is no code path that could, and these tests are
// what keep it that way: they scan the code itself.

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs)$/.test(n)) out.push(p);
  }
  return out;
}
const CODE = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))];
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

test('nothing calls fetch except the network door', () => {
  const offenders = CODE.filter((f) => rel(f) !== 'src/core/net.js' && /(?<![\w.])fetch\s*\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map(rel), []);
});

test('no engagement function exists anywhere in the code', () => {
  // A function, method or export whose name is an engagement action.
  const NAME = /\b(?:function\s+|const\s+|let\s+|async\s+|export\s+(?:async\s+)?function\s+|\b)(like|unlike|follow|unfollow|comment|reply|replyTo|sendDm|sendDM|dm|directMessage|sendMessage|message[A-Z]\w*|likePost|followAccount|commentOn|postComment|engage\w*|autoLike|autoFollow|scrape\w*|login(?:To)?(?:Instagram|TikTok)\w*)\s*(?:=\s*(?:async\s*)?\(|\()/;
  const hits = [];
  for (const f of CODE) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return;
      const m = NAME.exec(l);
      if (m) hits.push(`${rel(f)}:${i + 1} ${m[1]}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('no engagement endpoint is named anywhere in the code', () => {
  const ENDPOINT = /graph\.(?:facebook|instagram)\.com\/[^'"\s]*\/(?:comments|likes|replies|conversations|messages)|open\.tiktokapis\.com\/v2\/(?:comment|like|follow|dm)|\/(?:inbox|direct_v2|friendships|follow_user|like_post)\b|private_replies/i;
  // net.js names the Zernio inbox only to refuse it; its rules are tested on their own below.
  const hits = CODE.filter((f) => rel(f) !== 'src/core/net.js' && ENDPOINT.test(readFileSync(f, 'utf8'))).map(rel);
  assert.deepEqual(hits, []);
});

test('the only writes are drafting with Claude and creating our own post on Zernio', () => {
  assert.deepEqual(
    WRITE_RULES.map((r) => `${r.method} ${r.host}`),
    ['POST api.anthropic.com', 'POST zernio.com']
  );
  for (const r of WRITE_RULES) assert.equal(isSocial(r.host), false, `${r.host} is not a social platform`);
  for (const r of READ_RULES.filter((x) => isSocial(x.host))) assert.ok(r.path, `${r.host} reads are limited to listed API paths`);
});

test('the door refuses every write to a social platform and every inbox', () => {
  const refused = [
    ['POST', 'https://graph.instagram.com/v21.0/123/comments'],
    ['POST', 'https://www.tiktok.com/api/commit/follow/user/'],
    ['POST', 'https://api.x.com/2/users/1/likes'],
    ['POST', 'https://zernio.com/api/v1/inbox/messages'],
    ['GET', 'https://zernio.com/api/v1/inbox'],
    ['GET', 'https://zernio.com/api/v1/comments'],
    ['POST', 'https://zernio.com/api/v1/posts/abc/comments'],
    ['GET', 'https://www.instagram.com/someone/'],
    ['GET', 'https://www.tiktok.com/@someone'],
    ['GET', 'http://www.example.com/'],
    ['DELETE', 'https://zernio.com/api/v1/posts/abc'],
  ];
  for (const [m, u] of refused) assert.throws(() => assertAllowed(m, u), /refused/, `${m} ${u}`);
});

test('the door allows what the engine needs and nothing else', () => {
  for (const [m, u] of [
    ['POST', 'https://api.anthropic.com/v1/messages'],
    ['POST', 'https://zernio.com/api/v1/posts'],
    ['GET', 'https://zernio.com/api/v1/posts/abc123'],
    ['GET', 'https://zernio.com/api/v1/analytics'],
    ['GET', 'https://www.googleapis.com/youtube/v3/search'],
    ['GET', 'https://www.example.org/feed.xml'],
    ['GET', 'https://commons.wikimedia.org/w/api.php'],
  ]) assert.doesNotThrow(() => assertAllowed(m, u), `${m} ${u}`);
});

test('the browser never reaches the network while rendering', () => {
  const src = readFileSync(path.join(ROOT, 'src/render/render.js'), 'utf8');
  assert.match(src, /context\.route\('\*\*\/\*', \(route\) => route\.abort\(\)\)/);
});
