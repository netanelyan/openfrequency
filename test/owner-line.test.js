import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { setNow } from '../src/core/clock.js';
import { localFetch } from '../src/core/net.js';
import { buildPost, loadPost } from '../src/pipeline/build.js';
import { publishPost } from '../src/publish/index.js';
import { watchDrafts } from '../src/publish/draft.js';
import { generate } from '../src/autonomy/runner.js';
import { israelInstant } from '../src/schedule/israel.js';
import { restWindow } from '../src/schedule/shabbat.js';
import { approve } from '../src/web/actions.js';
import { listen } from '../src/web/server.js';
import { closeBrowser } from '../src/render/render.js';
import { createInternalHandler, editForm, listenInternal } from '../src/owner/api.js';
import { mediaUrl, readMediaPath, sign, signedText, verify } from '../src/owner/sign.js';
import { deliver, emit, ownerTick, postEvent, quotaLow, weekSummary } from '../src/owner/events.js';
import { quietAt } from '../src/owner/quiet.js';
import { customer, fakeAccounts, opened, operator, tempHome, viewingAs } from './helpers.js';

// The owner line (docs/internal-assistant.md): openfrequency-toran asks Teder about a workspace's posts and acts on
// them over a signed internal listener, fetches their slides through signed links, and hears Teder's events from an
// outbox. Three workspaces: alpha is 1's, bravo 2's, charlie 3's (in TikTok's default draft-now). Workspace 1 must
// never reach bravo's post.

const SECRET = 'a'.repeat(40);
const ACTOR = 'wa:972500000123';
const at = (day, hhmm) => israelInstant(day, hhmm).getTime();

let home;
let ctx;
let db;
let fake;
let web;
let internal;
let ibase;
let wbase;
const env = { ...process.env, SESSION_SECRET: 's'.repeat(40), OF_ASSISTANT_SECRET: SECRET };
const A = {};
const B = {};
const C = {};
const RUN = {};
let copies = 0;

/** Rows as plain objects, for deepEqual. */
const rows = (sql, ...params) => db.all(sql, ...params).map((r) => ({ ...r }));

/** A copy of a post, with its slides, facts and rendered files: the same text under a new id. */
function clone(id) {
  const p = db.get('SELECT * FROM posts WHERE id = ?', id);
  const nid = `${id}c${++copies}`;
  const dir = path.join(home.home, 'media', 'posts', nid);
  mkdirSync(dir, { recursive: true });
  const moved = (f) => {
    if (typeof f !== 'string') return f;
    const to = path.join(dir, path.basename(f));
    if (!existsSync(to)) copyFileSync(f, to);
    return to;
  };
  const media = JSON.parse(p.media_json);
  db.insert('posts', { ...p, id: nid, media_json: Object.fromEntries(Object.entries(media).map(([k, v]) => [k, Array.isArray(v) ? v.map(moved) : v])) });
  for (const { id: _, ...s } of db.all('SELECT * FROM slides WHERE post_id = ?', id)) {
    db.insert('slides', { ...s, post_id: nid, files_json: Object.fromEntries(Object.entries(JSON.parse(s.files_json || '{}')).map(([k, f]) => [k, moved(f)])) });
  }
  for (const { id: _, ...f } of db.all('SELECT * FROM facts WHERE post_id = ?', id)) db.insert('facts', { ...f, post_id: nid });
  return nid;
}

before(async () => {
  process.env.OF_ASSISTANT_SECRET = SECRET;
  // Three brands distinct enough for the engine to load them side by side; alpha and bravo publish TikTok directly.
  home = tempHome({
    packs: {
      alpha: (f) => (f.pack.zernio.tiktokMode = 'direct'),
      bravo: (f) => {
        f.pack.zernio.tiktokMode = 'direct';
        f.theme.template = 'poster';
        f.theme.fonts.display = 'Secular One';
        Object.assign(f.theme.colors, { bg: '#101820', surface: '#1C2733', ink: '#F4F4F4', muted: '#B8C0C8', accent: '#3FA7D6', onAccent: '#101820' });
      },
      charlie: (f) => {
        delete f.pack.zernio.tiktokMode;
        f.theme.variant = 'b';
        f.theme.fonts.display = 'Karantina';
        Object.assign(f.theme.colors, { bg: '#2B1B3D', surface: '#3A2850', ink: '#F7F2FB', muted: '#C9BCD8', accent: '#F59E0B', onAccent: '#2B1B3D' });
      },
    },
  });
  db = new Db(path.join(home.home, 'data.db'));
  opened.push(db);
  ctx = makeContext({ db, packs: loadAll({ dir: path.join(home.home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home.home, 'media');
  ctx.mediaRoot = home.home;
  db.run("UPDATE accounts SET workspace_id = 1 WHERE id = 'alpha'");
  db.run("UPDATE accounts SET workspace_id = 2 WHERE id = 'bravo'");
  db.run("UPDATE accounts SET workspace_id = 3 WHERE id = 'charlie'");
  // The day's run writes alpha's post and bravo's: the post.ready events are kept from here, before anything else.
  RUN.report = await generate(ctx, [{ pack: ctx.pack('alpha'), slotAt: '2026-10-28T09:00:00.000Z', formatKey: 'care-guide' }, { pack: ctx.pack('bravo'), slotAt: '2026-10-28T09:00:00.000Z', formatKey: 'care-guide' }], { generated: [], errors: [] });
  RUN.ready = events('post.ready');
  const queued = (account) => RUN.report.generated.find((g) => g.account === account && g.status === 'queued')?.post;
  A.edit = queued('alpha');
  B.post = queued('bravo');
  assert.ok(A.edit && B.post, JSON.stringify(RUN.report.generated));
  // A demo pack has one post's worth of documents: the others are copies of it.
  A.approve = clone(A.edit);
  A.reject = clone(A.edit);
  db.update('posts', A.approve, { slot_at: '2026-10-27T09:00:00.000Z' });
  db.update('posts', A.reject, { slot_at: '2026-10-26T09:00:00.000Z' });

  fake = await fakeAccounts();
  Object.assign(env, fake.env);
  web = await listen(ctx, { port: 0, env });
  env.PORT = String(web.port);
  wbase = `http://127.0.0.1:${web.port}`;
  internal = await listenInternal(ctx, { port: 0, env });
  ibase = `http://127.0.0.1:${internal.port}`;
});

afterEach(() => setNow(null));

after(async () => {
  delete process.env.OF_ASSISTANT_SECRET;
  web?.server.close();
  internal?.server.close();
  await fake?.close();
  await closeBrowser();
  home?.cleanup();
});

/** One signed request to the internal listener, as Toran sends it. */
async function call(method, p, body = null, { secret = SECRET, t, headers = {} } = {}) {
  const raw = body == null ? '' : JSON.stringify(body);
  const res = await fetch(`${ibase}${p}`, { method, headers: { ...sign(secret, { method, path: p, body: raw, t }), ...(raw ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw || undefined });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

/** The handler asked directly, for what a socket on this machine cannot be: another address, another Host. */
async function direct(handler, { remote = '127.0.0.1', host, method = 'GET', url = '/internal/assistant/status?workspace=1', headers = {} } = {}) {
  const req = Object.assign(Readable.from([]), { socket: { remoteAddress: remote }, method, url, headers: { host, ...sign(SECRET, { method, path: url }), ...headers } });
  const out = {};
  await handler(req, { writeHead: (s, h) => Object.assign(out, { status: s, headers: h }), end: (b) => (out.body = JSON.parse(b)) });
  return out;
}

// ---- signing

test('the signature is the contract\'s string, and only a fresh one with the right secret passes', () => {
  const t = Date.parse('2026-10-24T09:00:00Z');
  const h = sign(SECRET, { method: 'POST', path: '/x?a=1', body: '{"a":1}', t });
  assert.equal(h['x-of-timestamp'], String(t / 1000));
  assert.equal(signedText({ ts: h['x-of-timestamp'], method: 'post', path: '/x?a=1', body: '{"a":1}' }), `v1\n${t / 1000}\nPOST\n/x?a=1\n${createHash('sha256').update('{"a":1}').digest('hex')}`);
  assert.match(h['x-of-signature'], /^v1=[0-9a-f]{64}$/);
  assert.deepEqual(verify(SECRET, { headers: h, method: 'POST', path: '/x?a=1', body: '{"a":1}', t: t + 299_000 }), { ok: true });
  assert.deepEqual(verify(SECRET, { headers: h, method: 'POST', path: '/x?a=1', body: '{"a":1}', t: t + 301_000 }), { ok: false, error: 'stale' });
  assert.deepEqual(verify(SECRET, { headers: h, method: 'POST', path: '/x?a=1', body: '{"a":2}', t }), { ok: false, error: 'bad_signature' });
  assert.deepEqual(verify(SECRET, { headers: h, method: 'POST', path: '/x?a=2', body: '{"a":1}', t }), { ok: false, error: 'bad_signature' });
  assert.deepEqual(verify('b'.repeat(40), { headers: h, method: 'POST', path: '/x?a=1', body: '{"a":1}', t }), { ok: false, error: 'bad_signature' });
  assert.deepEqual(verify(SECRET, { headers: {}, method: 'GET', path: '/', t }), { ok: false, error: 'stale' });
});

test('the listener: a good signature passes; a stale one, a wrong one, a proxied one and one from elsewhere do not', async () => {
  assert.equal((await call('GET', '/internal/assistant/status?workspace=1')).status, 200);
  assert.deepEqual((await call('GET', '/internal/assistant/status?workspace=1', null, { t: Date.now() - 301_000 })).body, { error: 'stale' });
  const bad = await call('GET', '/internal/assistant/status?workspace=1', null, { secret: 'b'.repeat(40) });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'bad_signature');
  // Signed for one workspace, sent for another.
  const p = '/internal/assistant/status?workspace=1';
  const res = await fetch(`${ibase}/internal/assistant/status?workspace=2`, { headers: sign(SECRET, { method: 'GET', path: p }) });
  assert.equal(res.status, 401);
  const proxied = await call('GET', p, null, { headers: { 'x-forwarded-for': '203.0.113.9' } });
  assert.deepEqual([proxied.status, proxied.body], [403, { error: 'not_local' }]);
  const h = internal.handler;
  assert.deepEqual(await direct(h, { remote: '10.0.0.5', host: `127.0.0.1:${internal.port}` }).then((r) => [r.status, r.body.error]), [403, 'not_local']);
  assert.deepEqual(await direct(h, { host: 'teder.example.com' }).then((r) => [r.status, r.body.error]), [403, 'not_local'], 'a rebinding Host');
  assert.deepEqual(await direct(h, { host: `localhost:${internal.port}` }).then((r) => r.status), 200);
  assert.equal(proxied.headers.get('cache-control'), 'no-store');
});

test('without OF_ASSISTANT_SECRET (or with a short one) every route is 503 not_configured', async () => {
  for (const secret of [undefined, 'short']) {
    const h = createInternalHandler(ctx, { port: 4701, env: { OF_ASSISTANT_SECRET: secret } });
    assert.deepEqual(await direct(h, { host: '127.0.0.1:4701' }).then((r) => [r.status, r.body]), [503, { error: 'not_configured' }]);
  }
});

// ---- the routes

test('status: the workspace, its accounts, what waits, the quota, and when a message may go out', async () => {
  setNow(at('2026-10-21', '12:00'));
  const { status, body } = await call('GET', '/internal/assistant/status?workspace=1');
  assert.equal(status, 200);
  assert.equal(body.workspace, 1);
  assert.deepEqual(body.accounts, [{ id: 'alpha', name: 'חשבון alpha', mode: 'approve', status: 'active' }]);
  assert.equal(body.pending, 3);
  assert.equal(body.approvedThisWeek, 0);
  assert.equal(body.publishedThisWeek, 0);
  assert.equal(body.quota, null, 'Teder has no monthly plan yet');
  assert.deepEqual(body.quiet, { now: false, until: null, reason: null });
  assert.deepEqual(body.quietHours, { start: '22:00', end: '08:00' });
  assert.equal(body.shabbat, true);
  assert.deepEqual((await call('GET', '/internal/assistant/status?workspace=99')).body, { error: 'no_teder' });
  assert.deepEqual((await call('GET', '/internal/assistant/status?workspace=x')).body, { error: 'bad_workspace' });
  assert.deepEqual((await call('GET', '/internal/assistant/nothing?workspace=1')).body, { error: 'not_found' });
});

test('posts: the workspace\'s own, waiting for approval, oldest slot first, each with a signed cover', async () => {
  const { status, body } = await call('GET', '/internal/assistant/posts?workspace=1');
  assert.equal(status, 200);
  assert.deepEqual(body.posts.map((p) => p.id), [A.reject, A.approve, A.edit], 'by slot, the one without a slot last');
  const p = body.posts[0];
  const post = loadPost(db, A.reject);
  assert.deepEqual(Object.keys(p), ['id', 'number', 'account', 'status', 'hook', 'slotAt', 'slides', 'cover']);
  assert.equal(p.number, null);
  assert.deepEqual(p.account, { id: 'alpha', name: 'חשבון alpha' });
  assert.equal(p.status, 'queued');
  assert.equal(p.hook, post.hook.replace(/\s*\n\s*/g, ' '));
  assert.equal(p.slotAt, '2026-10-26T09:00:00.000Z');
  assert.equal(p.slides, post.slides.length);
  assert.match(p.cover.url, new RegExp(`^http://127\\.0\\.0\\.1:${web.port}/m/${A.reject}\\.instagram\\.0\\.\\d+\\.[\\w-]{43}\\.jpg$`));
  assert.ok(!JSON.stringify(body).includes(B.post), "never bravo's");
  assert.deepEqual((await call('GET', '/internal/assistant/posts?workspace=1&status=approved')).body, { posts: [] });
  assert.deepEqual((await call('GET', '/internal/assistant/posts?workspace=1&status=bogus')).body, { error: 'bad_status' });
  assert.deepEqual((await call('GET', '/internal/assistant/posts?workspace=2')).body.posts.map((x) => x.id), [B.post]);
});

test('one post: its caption, its hashtags and every slide as lines, title first, with its image', async () => {
  const { status, body } = await call('GET', `/internal/assistant/posts/${A.edit}?workspace=1`);
  assert.equal(status, 200);
  const post = loadPost(db, A.edit);
  assert.equal(body.post.caption, post.caption);
  assert.deepEqual(body.post.hashtags, post.hashtags);
  assert.equal(body.post.slideList.length, post.slides.length);
  const [cover, first] = body.post.slideList;
  assert.deepEqual({ idx: cover.idx, kind: cover.kind, lines: cover.lines }, { idx: 1, kind: 'cover', lines: [post.hook.replace(/\s*\n\s*/g, ' '), post.sub] });
  assert.deepEqual(first.lines, [post.slides[1].title, ...post.slides[1].body.split('\n')]);
  assert.equal(first.kind, 'item');
  assert.match(first.image.url, new RegExp(`/m/${A.edit}\\.instagram\\.1\\.`));
});

test('the bundle: the Instagram slides and the caption to copy, hashtags included', async () => {
  const { status, body } = await call('GET', `/internal/assistant/posts/${A.edit}/bundle?workspace=1`);
  assert.equal(status, 200);
  const post = loadPost(db, A.edit);
  assert.deepEqual(body.post, { id: A.edit, hook: post.hook.replace(/\s*\n\s*/g, ' ') });
  assert.equal(body.platform, 'instagram');
  assert.equal(body.images.length, post.media.instagram.length);
  for (const tag of post.hashtags) assert.ok(body.caption.includes(tag), tag);
  assert.ok(body.caption.startsWith(post.caption_ig || post.caption));
});

test("another workspace's post is not found, by every route, and nothing of it changes", async () => {
  const before = JSON.stringify([loadPost(db, B.post), db.all('SELECT * FROM audit WHERE post_id = ?', B.post)]);
  const gets = [`/internal/assistant/posts/${B.post}?workspace=1`, `/internal/assistant/posts/${B.post}/bundle?workspace=1`, '/internal/assistant/posts/nope?workspace=1'];
  for (const p of gets) assert.deepEqual(await call('GET', p).then((r) => [r.status, r.body]), [404, { error: 'not_found' }], p);
  for (const [verb, extra] of [['approve', {}], ['reject', { reason: 'topic' }], ['edit', { slide: 2, line: 1, text: 'A was here' }]]) {
    const r = await call('POST', `/internal/assistant/posts/${B.post}/${verb}`, { workspace: 1, actor: ACTOR, ...extra });
    assert.deepEqual([r.status, r.body], [404, { error: 'not_found' }], verb);
  }
  assert.equal(JSON.stringify([loadPost(db, B.post), db.all('SELECT * FROM audit WHERE post_id = ?', B.post)]), before);
  assert.equal((await call('GET', `/internal/assistant/posts/${B.post}?workspace=2`)).status, 200, 'the positive control: bravo sees its own');
});

test('approve: the dashboard\'s approval, recorded as the owner on WhatsApp; a second one is not_pending', async () => {
  assert.deepEqual((await call('POST', `/internal/assistant/posts/${A.approve}/approve`, { workspace: 1 })).body, { error: 'bad_actor' });
  const r = await call('POST', `/internal/assistant/posts/${A.approve}/approve`, { workspace: 1, actor: ACTOR });
  assert.deepEqual([r.status, r.body], [200, { post: { id: A.approve, status: 'approved' } }]);
  const post = loadPost(db, A.approve);
  assert.equal(post.status, 'approved');
  assert.equal(post.approved_by, ACTOR);
  assert.ok(post.approved_at);
  assert.deepEqual(rows('SELECT actor, action, account_id FROM audit WHERE post_id = ?', A.approve), [{ actor: ACTOR, action: 'approve', account_id: 'alpha' }]);
  const again = await call('POST', `/internal/assistant/posts/${A.approve}/approve`, { workspace: 1, actor: ACTOR });
  assert.deepEqual([again.status, again.body], [409, { error: 'not_pending' }]);
  assert.equal((await call('GET', '/internal/assistant/status?workspace=1')).body.approvedThisWeek, 1);
});

test('reject: with a reason and a note, as the dashboard rejects; no replacement while Teder has no redos', async () => {
  assert.deepEqual((await call('POST', `/internal/assistant/posts/${A.reject}/reject`, { workspace: 1, actor: ACTOR, reason: 'boring' })).body, { error: 'bad_reason' });
  const r = await call('POST', `/internal/assistant/posts/${A.reject}/reject`, { workspace: 1, actor: ACTOR, reason: 'shorter', note: 'חצי מזה' });
  assert.deepEqual([r.status, r.body], [200, { post: { id: A.reject, status: 'rejected' }, replacement: null, redosLeft: null }]);
  const post = loadPost(db, A.reject);
  assert.equal(post.reason, 'ארוך מדי: חצי מזה');
  assert.deepEqual(rows('SELECT actor, action FROM audit WHERE post_id = ?', A.reject), [{ actor: ACTOR, action: 'reject' }]);
  const again = await call('POST', `/internal/assistant/posts/${A.reject}/reject`, { workspace: 1, actor: ACTOR, reason: 'topic' });
  assert.deepEqual([again.status, again.body], [409, { error: 'not_pending' }]);
});

test('edit: one line, checked and drawn again as the dashboard does; a line the checks refuse is 422 with the problems', async () => {
  const before = loadPost(db, A.edit);
  const file = before.media.instagram[1];
  const drawn = statSync(file).mtimeMs;
  const title = 'שמש ישירה, הרבה ממנה';
  const r = await call('POST', `/internal/assistant/posts/${A.edit}/edit`, { workspace: 1, actor: ACTOR, slide: 2, line: 1, text: title });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.post.id, A.edit);
  assert.equal(r.body.slide.idx, 2);
  assert.equal(r.body.slide.lines[0], title);
  assert.match(r.body.slide.image.url, /\/m\//);
  const after = loadPost(db, A.edit);
  assert.equal(after.slides[1].title, title);
  assert.equal(after.slides[1].body, before.slides[1].body, 'the rest of the slide as it was');
  assert.equal(after.checks.edited, true);
  assert.ok(statSync(after.media.instagram[1]).mtimeMs > drawn, 'drawn again');
  assert.deepEqual(rows('SELECT slide_idx, field, after, actor FROM edits WHERE post_id = ?', A.edit), [{ slide_idx: 1, field: 'title', after: title, actor: ACTOR }]);
  assert.deepEqual(rows("SELECT actor FROM audit WHERE post_id = ? AND action = 'edit'", A.edit), [{ actor: ACTOR }]);

  const refused = await call('POST', `/internal/assistant/posts/${A.edit}/edit`, { workspace: 1, actor: ACTOR, slide: 2, line: 1, text: 'יש 9,999 סוגים של בזיליקום' });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, 'failed_checks');
  assert.ok(refused.body.problems.length > 0);
  assert.equal(loadPost(db, A.edit).slides[1].title, title, 'nothing saved');

  const closer = before.slides.length;
  for (const bad of [{ slide: 99, line: 1 }, { slide: 2, line: 0 }, { slide: 2, line: 99 }, { slide: closer, line: 1 }, { slide: 2, line: 1, text: '' }]) {
    const res = await call('POST', `/internal/assistant/posts/${A.edit}/edit`, { workspace: 1, actor: ACTOR, text: 'שורה', ...bad });
    assert.deepEqual([res.status, res.body], [400, { error: 'bad_line' }], JSON.stringify(bad));
  }
  const rejected = await call('POST', `/internal/assistant/posts/${A.reject}/edit`, { workspace: 1, actor: ACTOR, slide: 2, line: 1, text: 'x' });
  assert.deepEqual([rejected.status, rejected.body], [409, { error: 'not_pending' }]);
});

test("an edit is the dashboard's form with one line changed: the cover's line and the one under it, a slide's title and body lines", () => {
  const post = { hook: 'שער\nבשתי שורות', sub: 'מתחת', caption: 'כיתוב', slides: [{ kind: 'cover' }, { kind: 'item', title: 'א', body: 'אחת\nשתיים\nשלוש' }, { kind: 'item', title: 'ב', body: 'רביעית' }, { kind: 'closer', title: 'ג', body: '' }] };
  const base = { hook: post.hook, sub: 'מתחת', caption: 'כיתוב', title_0: 'א', body_0: 'אחת\nשתיים\nשלוש', title_1: 'ב', body_1: 'רביעית' };
  assert.deepEqual(editForm(post, { slide: 1, line: 1, text: 'שער חדש' }), { ...base, hook: 'שער חדש' });
  assert.deepEqual(editForm(post, { slide: 1, line: 2, text: 'אחרת' }), { ...base, sub: 'אחרת' });
  assert.deepEqual(editForm(post, { slide: 2, line: 3, text: 'במקום' }), { ...base, body_0: 'אחת\nבמקום\nשלוש' });
  assert.deepEqual(editForm(post, { slide: 3, line: 1, text: 'ב2' }), { ...base, title_1: 'ב2' });
  assert.throws(() => editForm(post, { slide: 3, line: 3, text: 'x' }), { error: 'bad_line' });
  assert.throws(() => editForm(post, { slide: 4, line: 1, text: 'x' }), { error: 'bad_line' }, 'the closer is not edited on the dashboard either');
  assert.throws(() => editForm(post, { slide: 2, line: 1, text: 'שתי\nשורות' }), { error: 'bad_line' });
});

// ---- the slide links

test('a signed slide link opens that slide without a session for 7 days; an expired or altered one does not', async () => {
  const post = loadPost(db, A.edit);
  const url = mediaUrl({ postId: A.edit, platform: 'instagram', idx: 1, env });
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), readFileSync(post.media.instagram[1]));
  const p = new URL(url).pathname;
  assert.ok(readMediaPath(p, { env, t: Date.now() + 6.9 * 86_400_000 }).postId, 'still good on the seventh day');
  assert.deepEqual(readMediaPath(p, { env, t: Date.now() + 7.1 * 86_400_000 }), { error: 'expired' });

  const old = mediaUrl({ postId: A.edit, platform: 'instagram', idx: 1, env, t: Date.now() - 8 * 86_400_000 });
  assert.equal((await fetch(old)).status, 410);
  const sig = p.split('.').at(-2);
  const flipped = p.replace(sig, `${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`);
  for (const q of [flipped, p.replace('.instagram.1.', '.instagram.2.'), p.replace(A.edit, B.post), p.replace('.instagram.', '.tiktok.'), '/m/nothing.jpg']) {
    assert.equal((await fetch(`${wbase}${q}`)).status, 404, q);
  }
  assert.equal((await fetch(mediaUrl({ postId: A.edit, platform: 'instagram', idx: 1, env: { ...env, SESSION_SECRET: 'z'.repeat(40) } }))).status, 404, 'signed with another secret');
});

// ---- quiet hours and Shabbat

test('quiet: the quiet hours, then Shabbat by Teder\'s own calendar; both are the workspace\'s settings page', async () => {
  const quiet = async () => (await call('GET', '/internal/assistant/status?workspace=1')).body;
  setNow(at('2026-10-21', '23:15'));
  assert.deepEqual((await quiet()).quiet, { now: true, until: israelInstant('2026-10-22', '08:00').toISOString(), reason: 'quiet_hours' });
  setNow(at('2026-10-22', '07:59'));
  assert.equal((await quiet()).quiet.reason, 'quiet_hours');
  setNow(at('2026-10-22', '08:00'));
  assert.equal((await quiet()).quiet.now, false);
  const sat = at('2026-10-24', '12:00');
  setNow(sat);
  assert.deepEqual((await quiet()).quiet, { now: true, until: restWindow(sat).to.toISOString(), reason: 'shabbat' });
  // Friday night: the quiet hours are inside Shabbat, which says so and ends it.
  setNow(at('2026-10-23', '23:00'));
  assert.deepEqual((await quiet()).quiet, { now: true, until: restWindow(sat).to.toISOString(), reason: 'shabbat' });
  // Quiet hours that run past Shabbat's end: one quiet time, until they end.
  const line = { quietHours: { start: '18:00', end: '21:30' }, shabbat: true };
  assert.deepEqual(quietAt(line, sat), { now: true, until: israelInstant('2026-10-24', '21:30').toISOString(), reason: 'shabbat' });
  assert.deepEqual(quietAt({ quietHours: { start: '08:00', end: '08:00' }, shabbat: false }, sat), { now: false, until: null, reason: null }, 'the same time twice is none');

  // The settings page: the workspace's owner changes them; view-as cannot; the operator has none of its own.
  setNow(null);
  const owner = fake.session(customer(1)).cookie;
  const page = await (await fetch(`${wbase}/settings`, { headers: { cookie: owner } })).text();
  assert.match(page, /הודעות בוואטסאפ/);
  assert.match(page, /name="start" value="22:00"/);
  assert.match(page, /name="shabbat" value="1" checked/);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page)[1];
  const save = (cookie, token, body) => fetch(`${wbase}/settings/owner-line`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-of-ajax': '1' }, body: new URLSearchParams({ _csrf: token, ...body }).toString() });
  assert.equal((await save(owner, csrf, { start: '23:00', end: '07:00' })).status, 200);
  assert.equal((await save(owner, csrf, { start: '7', end: '07:00' })).status, 400);
  setNow(sat);
  const now = await quiet();
  assert.deepEqual([now.quietHours, now.shabbat, now.quiet.now], [{ start: '23:00', end: '07:00' }, false, false], 'Shabbat off: Saturday noon is open');
  setNow(null);
  assert.match(await (await fetch(`${wbase}/settings`, { headers: { cookie: owner } })).text(), /name="start" value="23:00"/);
  const view = fake.session(viewingAs(1)).cookie;
  const viewPage = await (await fetch(`${wbase}/settings`, { headers: { cookie: view } })).text();
  assert.match(viewPage, /name="start" value="23:00"/, 'view-as sees it');
  assert.equal((await save(view, /name="_csrf" value="([^"]+)"/.exec(viewPage)[1], { start: '20:00', end: '07:00', shabbat: '1' })).status, 403);
  const op = fake.session(operator()).cookie;
  const opPage = await (await fetch(`${wbase}/settings`, { headers: { cookie: op } })).text();
  assert.doesNotMatch(opPage, /הודעות בוואטסאפ/);
  assert.equal((await save(op, /name="_csrf" value="([^"]+)"/.exec(opPage)[1], { start: '20:00', end: '07:00' })).status, 403);
  assert.deepEqual((await quiet()).quietHours, { start: '23:00', end: '07:00' }, 'as the owner left it');
});

// ---- the events

const events = (type) => db.all('SELECT * FROM owner_events WHERE type = ? ORDER BY rowid', type).map((e) => ({ ...e, data: JSON.parse(e.data_json) }));

test('post.ready: at the end of a run, one event per workspace with the posts it queued', async () => {
  assert.deepEqual(RUN.ready.map((e) => [e.workspace_id, e.data.posts.map((p) => p.id)]).sort(), [[1, [A.edit]], [2, [B.post]]]);
  const one = RUN.ready[0];
  assert.match(one.id, /^evt_/);
  assert.equal(one.state, 'pending');
  assert.deepEqual(Object.keys(one.data.posts[0]), ['id', 'number', 'account', 'status', 'hook', 'slotAt', 'slides', 'cover']);
  assert.equal(one.data.posts[0].status, 'queued');
  assert.match(one.data.posts[0].cover.url, /\/m\//);
  // A later run in the same report tells only of its own posts, never the earlier run's again.
  const report = { generated: [{ account: 'alpha', post: A.edit, status: 'queued' }], errors: [] };
  await generate(ctx, [{ pack: ctx.pack('alpha'), slotAt: '2026-10-29T09:00:00.000Z' }], report);
  const mine = report.generated.slice(1).filter((g) => g.status === 'queued').map((g) => g.post);
  const later = events('post.ready').slice(2);
  assert.deepEqual(later.map((e) => e.data.posts.map((p) => p.id)), mine.length ? [mine] : []);
  for (const id of mine) db.update('posts', id, { status: 'rejected' }); // out of the way of the counts below
});

test('post.reminder at a draft-now slot, post.unposted for a reminder too late and for a publish that failed', async () => {
  const built = await buildPost(ctx, { pack: ctx.pack('charlie'), formatKey: 'care-guide' });
  assert.equal(built.status, 'queued', built.reason);
  C.remind = built.postId;
  C.late = clone(C.remind);
  C.fallback = clone(C.remind);
  const slot = at('2026-10-27', '12:00');
  for (const id of [C.remind, C.late]) {
    db.update('posts', id, { slot_at: new Date(slot).toISOString() });
    setNow(at('2026-10-27', '09:00'));
    await approve(ctx, { id: 1, name: 'owner' }, { id }).job;
  }
  assert.ok((await publishPost(ctx, C.remind, { t: slot })).reminded);
  const [rem] = events('post.reminder');
  assert.deepEqual([rem.workspace_id, rem.data.platform, rem.data.post.id, rem.data.post.status], [3, 'tiktok', C.remind, 'published']);
  assert.equal(postEvent(ctx, 'post.reminder', C.remind, 'tiktok'), null, 'once per post');

  const late = await publishPost(ctx, C.late, { t: slot + 13 * 3_600_000 });
  assert.equal(late.reminded, false);
  assert.deepEqual(events('post.unposted').map((e) => [e.workspace_id, e.data.post.id, e.data.platform]), [[3, C.late, 'tiktok']]);

  // A publish that fails, not to be tried again: the slides are gone.
  const failing = loadPost(db, A.approve);
  for (const f of failing.media.tiktok) rmSync(f, { force: true });
  const r = await publishPost(ctx, A.approve, { t: at('2026-10-27', '12:00') });
  assert.equal(r.ok, false);
  assert.equal(r.retry, false);
  const un = events('post.unposted').find((e) => e.data.post.id === A.approve);
  assert.ok(un, 'the failure is told');
  assert.equal(un.workspace_id, 1);
  assert.ok(r.results[un.data.platform].error, 'the platform that failed');
});

test('draft-fallback: the reminder at half an hour, and the fallback that fails, go to the owner line', async () => {
  const pack = ctx.pack('charlie');
  pack.meta.zernio.tiktokMode = 'draft-fallback';
  try {
    const r = { postId: C.fallback };
    const slot = at('2026-10-28', '12:00');
    db.update('posts', r.postId, { slot_at: new Date(slot).toISOString() });
    approve(ctx, { id: 1, name: 'owner' }, { id: r.postId });
    await publishPost(ctx, r.postId, { t: slot });
    await watchDrafts(ctx, { t: slot + 31 * 60_000, list: async () => [], send: async () => ({ status: 201 }) });
    assert.ok(events('post.reminder').some((e) => e.data.post.id === r.postId));
    for (const f of loadPost(db, r.postId).media.tiktok) rmSync(f, { force: true });
    await watchDrafts(ctx, { t: slot + 61 * 60_000, list: async () => [], send: async () => ({ status: 201 }) });
    assert.equal(loadPost(db, r.postId).publish.tiktok.flow.state, 'failed');
    assert.ok(events('post.unposted').some((e) => e.data.post.id === r.postId && e.data.platform === 'tiktok'));
  } finally {
    delete pack.meta.zernio.tiktokMode;
  }
});

test('quota.low: once a month per kind, at 80% of the suggestions or two redos left; none while Teder has no plan', () => {
  const q = (s, r) => ({ month: '2026-10', suggested: { used: s, limit: 40 }, redos: { used: r, limit: 10 } });
  assert.deepEqual(quotaLow(ctx, 1, q(31, 7)), []);
  assert.equal(quotaLow(ctx, 1, q(32, 7)).length, 1);
  assert.deepEqual(quotaLow(ctx, 1, q(35, 7)), [], 'once a month');
  assert.equal(quotaLow(ctx, 1, q(35, 8)).length, 1);
  assert.equal(quotaLow(ctx, 1, { ...q(32, 8), month: '2026-11' }).length, 2, 'a new month warns again');
  assert.deepEqual(events('quota.low').map((e) => e.data), [
    { kind: 'suggested', used: 32, limit: 40, month: '2026-10' },
    { kind: 'redos', used: 8, limit: 10, month: '2026-10' },
    { kind: 'suggested', used: 32, limit: 40, month: '2026-11' },
    { kind: 'redos', used: 8, limit: 10, month: '2026-11' },
  ]);
  assert.deepEqual(quotaLow(ctx, 1, null), []);
});

test('weekly.summary: Sunday from 09:00 Israel time, the seven days before, once', () => {
  const day = '2030-01-06';
  const t = '2030-01-01T10:00:00.000Z';
  const row = (id, extra) => db.insert('posts', { id, account_id: 'alpha', status: 'published', created_at: t, updated_at: t, ...extra });
  row('wk1', { approved_at: t, published_at: t });
  row('wk2', { status: 'expired' });
  row('wk3', { status: 'blocked' });
  row('wk4', { status: 'rejected' });
  db.insert('audit', { at: t, actor: ACTOR, action: 'reject', account_id: 'alpha', post_id: 'wk4' });
  row('wk5', { created_at: '2029-12-01T10:00:00.000Z', published_at: '2029-12-01T10:00:00.000Z' });
  assert.deepEqual(ownerTick(ctx, { t: at(day, '08:59') }), []);
  const sent = ownerTick(ctx, { t: at(day, '09:00') });
  assert.equal(sent.length, 3, 'one per workspace');
  const pending = db.get("SELECT COUNT(*) AS n FROM posts WHERE account_id = 'alpha' AND status = 'queued'").n;
  const w = events('weekly.summary').find((e) => e.workspace_id === 1);
  assert.deepEqual(w.data, { from: '2029-12-30', to: '2030-01-05', made: 3, approved: 1, rejected: 1, published: 1, expired: 1, pending, quota: null });
  assert.deepEqual(weekSummary(ctx, 1, day), w.data);
  assert.deepEqual(ownerTick(ctx, { t: at(day, '15:00') }), [], 'once');
  assert.deepEqual(ownerTick(ctx, { t: at('2030-01-07', '09:00') }), [], 'only on a Sunday');
});

test('nothing is written without the secret, or for an account in no workspace', () => {
  const n = () => db.get('SELECT COUNT(*) AS n FROM owner_events').n;
  const before = n();
  assert.equal(emit(ctx, { type: 'post.ready', workspaceId: 1, data: {}, env: {} }), null);
  assert.equal(emit(ctx, { type: 'post.ready', workspaceId: null, data: {}, env }), null);
  db.run("UPDATE accounts SET workspace_id = NULL WHERE id = 'alpha'");
  try {
    assert.equal(postEvent(ctx, 'post.unposted', A.edit, 'instagram'), null);
  } finally {
    db.run("UPDATE accounts SET workspace_id = 1 WHERE id = 'alpha'");
  }
  assert.deepEqual(ownerTick(ctx, { t: at('2030-01-13', '09:00'), env: {} }), []);
  assert.equal(n(), before);
});

// ---- the sender

/** A stand-in for Toran's POST /internal/teder/events: it checks the signature and answers what it is told. */
async function fakeToran() {
  const got = [];
  let answer = 200;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    got.push({ path: req.url, method: req.method, signed: verify(SECRET, { headers: req.headers, method: req.method, path: req.url, body }), body: JSON.parse(body) });
    res.writeHead(answer, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: answer === 200 }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { got, url: `http://127.0.0.1:${server.address().port}`, set: (s) => (answer = s), close: () => new Promise((r) => server.close(r)) };
}

test('the sender: each event signed to /internal/teder/events, tried again after 1, 5, 15, 60 minutes, then hourly, for a day', async () => {
  db.run("UPDATE owner_events SET state = 'sent'");
  const toran = await fakeToran();
  try {
    const t0 = Date.parse('2026-11-02T10:00:00.000Z');
    setNow(t0);
    const id = emit(ctx, { type: 'quota.low', workspaceId: 1, data: { kind: 'redos', used: 8, limit: 10, month: '2026-11' } });
    const e2 = { ...env, TORAN_INTERNAL: toran.url };
    toran.set(500);
    const tries = [];
    for (const min of [0, 1, 6, 21, 81, 141]) {
      setNow(t0 + min * 60_000);
      assert.equal((await deliver(ctx, { env: e2, t: t0 + (min - 0.5) * 60_000 })).length, 0, `nothing early at ${min}`);
      const r = await deliver(ctx, { env: e2, t: t0 + min * 60_000 });
      tries.push(r.length);
    }
    assert.deepEqual(tries, [1, 1, 1, 1, 1, 1], 'at once, then at 1, 6, 21, 81 and 141 minutes');
    assert.equal(toran.got.length, 6);
    const g = toran.got[0];
    assert.deepEqual([g.method, g.path, g.signed], ['POST', '/internal/teder/events', { ok: true }]);
    assert.deepEqual(Object.keys(g.body), ['id', 'type', 'workspace', 'at', 'data']);
    assert.deepEqual([g.body.id, g.body.type, g.body.workspace, g.body.at], [id, 'quota.low', 1, new Date(t0).toISOString()]);
    assert.equal(db.get('SELECT tries, state, last_error FROM owner_events WHERE id = ?', id).last_error, 'HTTP 500');

    toran.set(200);
    setNow(t0 + 201 * 60_000);
    assert.deepEqual(await deliver(ctx, { env: e2 }), [{ id, ok: true, status: 200 }]);
    assert.deepEqual(rows('SELECT state, tries FROM owner_events WHERE id = ?', id), [{ state: 'sent', tries: 7 }]);
    assert.deepEqual(await deliver(ctx, { env: e2, t: t0 + 300 * 60_000 }), [], 'sent once');

    // A day of failures, then it is dropped.
    toran.set(503);
    setNow(t0);
    const lost = emit(ctx, { type: 'quota.low', workspaceId: 2, data: {}, t: t0 });
    for (let m = 0; m <= 25 * 60; m += 10) {
      setNow(t0 + m * 60_000);
      await deliver(ctx, { env: e2 });
    }
    const row = db.get('SELECT state, tries FROM owner_events WHERE id = ?', lost);
    assert.equal(row.state, 'dropped');
    assert.ok(row.tries >= 24 && row.tries <= 28, `${row.tries} tries in a day`);

    // Toran down: a network error waits like any other answer; and nothing goes past this machine.
    await toran.close();
    setNow(t0 + 2 * 86_400_000);
    const down = emit(ctx, { type: 'quota.low', workspaceId: 1, data: {} });
    assert.deepEqual((await deliver(ctx, { env: e2 })).map((x) => x.status), ['network']);
    assert.equal(db.get('SELECT state FROM owner_events WHERE id = ?', down).state, 'pending');
    await assert.rejects(localFetch('http://example.com/internal/teder/events', { method: 'POST' }), /only a service on this machine/);
    assert.deepEqual(await deliver(ctx, { env: { TORAN_INTERNAL: toran.url } }), [], 'and nothing without the secret');
  } finally {
    await toran.close().catch(() => {});
  }
});
