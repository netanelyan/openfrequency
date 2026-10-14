import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { getSetting } from '../src/core/store.js';
import { credit, ensureFormats, groupsOf, hookStats, learnMix, mixOf, pickFormat, pickHook } from '../src/formats/rotation.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { confirmDeleted, recordTakedown, takedowns } from '../src/publish/takedown.js';
import { getBrowser, closeBrowser } from '../src/render/render.js';
import { redShare, refusingWord, screenImage } from '../src/images/safety.js';
import { opened, tempHome } from './helpers.js';

// The content model's learning (the mix of entertaining and number posts, the
// cover patterns), the takedown log, and the image screen.

after(() => closeBrowser());

const AT = '2026-10-01T10:00:00Z';

function pack(formats, mix = null) {
  return { id: 'a', formats: { formats, ...(mix ? { mix: { entertaining: mix } } : {}) } };
}

function account(db) {
  db.insert('accounts', { id: 'a', display_name: 'a', handle: 'a', created_at: AT, updated_at: AT });
}

/** n published posts of a format, each with a TikTok reading at 80 hours at this rate of (likes + shares) per view. */
function results(db, format, rates, { hook = null, start = 0 } = {}) {
  const t0 = Date.parse('2026-10-01T00:00:00Z');
  rates.forEach((rate, i) => {
    const id = `${format}-${start + i}`;
    const at = new Date(t0 + (start + i) * 3_600_000).toISOString();
    db.insert('posts', { id, account_id: 'a', format_id: format, status: 'published', published_at: at, created_at: at, updated_at: at, hook_pattern: hook });
    db.insert('metrics', { post_id: id, platform: 'tiktok', collected_at: at, age_hours: 80, views: 1000, likes: rate * 1000, shares: 0 });
  });
}

test('the mix: the group under its share goes next, 60% entertaining to start', () => {
  const db = new Db(':memory:');
  account(db);
  const p = pack([{ id: 's', kind: 'story' }, { id: 'h', kind: 'head-to-head' }]);
  ensureFormats(db, p);
  const groups = groupsOf(p);
  assert.deepEqual(groups, { s: 'entertaining', h: 'number' });
  assert.equal(mixOf(db, p), 0.6);
  assert.equal(pickFormat(db, 'a', { recent: [], groups, mix: 0.6 }), 's', 'nothing yet: entertaining first');
  const recent = (ents, nums) => [...Array(ents).fill({ format: 's', kind: 'proven' }), ...Array(nums).fill({ format: 'h', kind: 'proven' })];
  assert.equal(pickFormat(db, 'a', { recent: recent(3, 2), groups, mix: 0.6 }), 'h', '60% entertaining already: a number post');
  assert.equal(pickFormat(db, 'a', { recent: recent(2, 3), groups, mix: 0.6 }), 's');
  // A pack with one group has no mix to keep.
  assert.equal(mixOf(db, pack([{ id: 'x', kind: 'story' }])), null);
});

test('the mix moves towards the group that does better, 5 points a week, never past 40% to 80%', () => {
  const db = new Db(':memory:');
  account(db);
  const p = pack([{ id: 's', kind: 'story' }, { id: 'h', kind: 'ranking' }], 0.6);
  ensureFormats(db, p);
  results(db, 's', [0.1, 0.12, 0.11, 0.1]);
  results(db, 'h', [0.05, 0.04, 0.05, 0.06], { start: 10 });
  const t = Date.parse('2026-10-06T00:00:00Z');
  credit(db, 'a', { t });
  const m = learnMix(db, p, { t });
  assert.equal(m.from, 0.6);
  assert.equal(m.to, 0.65);
  assert.match(m.why, /בידור/);
  assert.equal(mixOf(db, p), 0.65);
  assert.equal(learnMix(db, p, { t: t + 86_400_000 }), null, 'not twice in a week');
  let at = t;
  for (let i = 0; i < 6; i++) learnMix(db, p, { t: (at += 8 * 86_400_000) });
  assert.equal(mixOf(db, p), 0.8, 'stops at 80%');
  assert.match(getSetting(db, 'mix:a').why, /בידור/);
});

test('cover patterns: each gets its turns first, then the better one is chosen more, and the results are kept per pattern', () => {
  const db = new Db(':memory:');
  account(db);
  const f = { id: 's', kind: 'story', hooks: [{ id: 'win', pattern: 'א' }, { id: 'lose', pattern: 'ב' }] };
  const p = pack([f]);
  ensureFormats(db, p);
  assert.equal(pickHook(db, 'a', f, { rand: () => 0.9 }).id, 'win', 'the least used first');
  results(db, 's', [0.12, 0.13, 0.12], { hook: 'win' });
  results(db, 's', [0.03, 0.02, 0.03], { hook: 'lose', start: 10 });
  const t = Date.parse('2026-10-06T00:00:00Z');
  credit(db, 'a', { t });
  const stats = hookStats(db, 'a', { t }).s;
  assert.ok(stats.win.avg > 1 && stats.lose.avg < 1, JSON.stringify(stats));
  // Past the turns: weighted by results (2 against 0.5, clamped), so the middle of the range is the winner's.
  assert.equal(pickHook(db, 'a', f, { rand: () => 0.5, t }).id, 'win');
});

function tdContext() {
  const { home, cleanup } = tempHome();
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  return { ctx, cleanup };
}

const publishedPost = (db, id, publish) => db.insert('posts', { id, account_id: 'demo', status: 'published', hook: `פוסט ${id}`, published_at: AT, created_at: AT, updated_at: AT, publish_json: publish });

test('a takedown notice: Instagram deleted through Facebook Login, TikTok left to a person, the post down, the second notice pauses', async () => {
  const { ctx, cleanup } = tdContext();
  try {
    const deleted = [];
    ctx.deleteInstagram = async (db, pack, mediaId) => deleted.push(mediaId);
    ctx.packs[0].meta.instagram = { userId: '17841400000000000', auth: 'facebook' };
    publishedPost(ctx.db, 'p1', { tiktok: { via: 'zernio', zernioId: 'z1', status: 'published' }, instagram: { via: 'instagram', mediaId: '17895695668004550' } });
    const r = await recordTakedown(ctx, { postId: 'p1', claimant: 'בעל זכויות', notice: 'the photo on slide 1 is ours, remove it' });
    assert.deepEqual(deleted, ['17895695668004550']);
    assert.equal(r.deleted.instagram.state, 'deleted');
    assert.equal(r.deleted.tiktok.state, 'by_hand');
    assert.match(r.deleted.tiktok.why, /TikTok/);
    assert.equal(ctx.db.get("SELECT status FROM posts WHERE id = 'p1'").status, 'taken_down');
    assert.equal(r.paused, false, 'one notice does not pause');
    assert.equal(takedowns(ctx.db)[0].waiting.length, 1);
    confirmDeleted(ctx.db, { id: r.id, platform: 'tiktok' });
    assert.equal(takedowns(ctx.db)[0].waiting.length, 0);

    // A dry post never left; Meta refusing the delete leaves it for a person.
    ctx.deleteInstagram = async () => {
      throw new Error('(#10) permission instagram_manage_contents is missing');
    };
    publishedPost(ctx.db, 'p2', { instagram: { via: 'instagram', mediaId: '17895695668009999' }, tiktok: { via: 'dry', status: 'written' } });
    const r2 = await recordTakedown(ctx, { postId: 'p2', notice: 'second notice for this account' });
    assert.equal(r2.deleted.instagram.state, 'by_hand');
    assert.match(r2.deleted.instagram.why, /instagram_manage_contents/);
    assert.equal(r2.deleted.tiktok.state, 'not_published');
    assert.equal(r2.paused, true);
    const acc = ctx.db.get("SELECT status, paused_reason FROM accounts WHERE id = 'demo'");
    assert.deepEqual([acc.status, acc.paused_reason], ['paused', 'takedowns']);
  } finally {
    cleanup();
  }
});

/** A solid-colour JPEG of the given CSS colour, drawn by the render browser. */
async function swatch(color) {
  const b = await getBrowser();
  const page = await b.newPage({ viewport: { width: 200, height: 200 } });
  await page.setContent(`<body style="margin:0;background:${color}"></body>`);
  const buf = await page.screenshot({ type: 'jpeg' });
  await page.close();
  return buf;
}

test('the image screen: a refusing word refuses, a red picture waits for a person, a strict pack waits without a model', async () => {
  assert.equal(refusingWord('UFC 194 Aldo vs McGregor knockout'), 'knockout');
  assert.equal(refusingWord('Fighter with championship belt'), 'belt');
  assert.equal(refusingWord('Portrait © Getty Images'), 'getty images');
  assert.equal(refusingWord('Basil on a balcony'), null);
  const red = await swatch('#b00000');
  const green = await swatch('#3a7d3a');
  assert.ok((await redShare(red)) > 0.9);
  assert.ok((await redShare(green)) < 0.01);
  const ctx = { llm: { kind: 'recorded' }, log: () => {} };
  const plain = { meta: { imagery: {} }, rules: {} };
  const strict = { meta: { imagery: { safety: 'strict' } }, rules: {} };
  assert.equal((await screenImage(ctx, { pack: plain, buf: green, type: 'image/jpeg', meta: 'a green plant' })).safety, 'ok');
  assert.equal((await screenImage(ctx, { pack: plain, buf: red, type: 'image/jpeg', meta: 'red gloves' })).safety, 'review');
  assert.equal((await screenImage(ctx, { pack: strict, buf: green, type: 'image/jpeg', meta: 'a fighter walking out' })).safety, 'review');
  assert.equal((await screenImage(ctx, { pack: plain, buf: green, type: 'image/jpeg', meta: 'a bloody cut above the eye' })).safety, 'refused');
});
