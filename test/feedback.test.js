import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost } from '../src/pipeline/build.js';
import { BOXES, classify, classifyAccount, latestFeedback, median, morningFeedback, nearest, plansFor, readingOf, withDirectives } from '../src/metrics/feedback.js';
import { steerLine, slidesUser } from '../src/pipeline/prompts.js';
import { feedbackPanels } from '../src/web/pages.js';
import { results } from '../src/web/data.js';
import { tick } from '../src/autonomy/runner.js';
import { israelInstant } from '../src/schedule/israel.js';
import { closeBrowser } from '../src/render/render.js';
import { opened, tempHome } from './helpers.js';

after(() => closeBrowser());

const HOUR = 3_600_000;
const T = israelInstant('2026-10-13', '07:05').getTime();

function contextFor(home) {
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home, 'media');
  return ctx;
}

/** A published post with its readings: [[ageHours, views, engagement, linkClicks]]. Numbers the test chose, on a post the test made. */
function seed(db, { id, hoursAgo, format = 'plant-story', hook = id, hookPattern = 'came-back', cta = null, platform = 'tiktok', readings }) {
  const at = new Date(T - hoursAgo * HOUR).toISOString();
  db.insert('posts', { id, account_id: 'demo', format_id: format, hook, topic: `topic ${id}`, hook_pattern: hookPattern, status: 'published', data_json: { cta: cta ? { kind: 'send', text: cta } : null, coverVisual: { type: 'stat' } }, published_at: at, created_at: at, updated_at: at });
  for (const [age, views, eng, link = null] of readings) {
    db.insert('metrics', { post_id: id, platform, collected_at: new Date(Date.parse(at) + age * HOUR).toISOString(), age_hours: age, views, likes: eng, comments: 0, shares: 0, saves: null, link_clicks: link });
  }
}

/** Four earlier posts at 1,000 views and 5% engagement, read at 12, 36, 60 and 84 hours; four recent ones, one per box. */
function seedBoxes(db, { link = false } = {}) {
  for (const [i, days] of [10, 8, 6, 5].entries()) seed(db, { id: `base${i}`, hoursAgo: days * 24, readings: [12, 36, 60, 84].map((a) => [a, 1000, 50, link ? 20 : null]) });
  seed(db, { id: 'pA', hoursAgo: 36, hook: 'הפוסט שתפס', readings: [[36, 3000, 300, link ? 300 : null]] });
  seed(db, { id: 'pB', hoursAgo: 36, format: 'plant-vs', hookPattern: 'answer-last', cta: 'מי מנצח אצלכם? כתבו בתגובות', readings: [[36, 3000, 30, link ? 3 : null]] });
  seed(db, { id: 'pC', hoursAgo: 36, format: 'myth-fact', hookPattern: 'still-believe', cta: 'שלחו למי שמשקה כל יום', readings: [[36, 300, 30, link ? 30 : null]] });
  seed(db, { id: 'pD', hoursAgo: 36, format: 'hot-take', hookPattern: 'unpopular', readings: [[36, 300, 3, link ? 0 : null]] });
}

test('the box: views against the median, what it led to per view against the median', () => {
  const base = [1, 2, 3, 4].map(() => ({ views: 1000, engagement: 50, linkClicks: null, age: 36 }));
  assert.equal(classify({ views: 3000, engagement: 300, linkClicks: null, age: 36 }, base).box, 'hh');
  assert.equal(classify({ views: 3000, engagement: 30, linkClicks: null, age: 36 }, base).box, 'hl');
  assert.equal(classify({ views: 300, engagement: 30, linkClicks: null, age: 36 }, base).box, 'lh');
  assert.equal(classify({ views: 300, engagement: 3, linkClicks: null, age: 36 }, base).box, 'll');
  // At the median exactly is high: the account's usual post is not a loser.
  assert.equal(classify({ views: 1000, engagement: 50, linkClicks: null, age: 36 }, base).box, 'hh');
  assert.equal(classify({ views: 3000, engagement: 30, linkClicks: null, age: 36 }, base).measure, 'engagement');
});

test('link clicks are the measure only when every post compared has them; a thin baseline is not judged', () => {
  const withLinks = [1, 2, 3].map(() => ({ views: 1000, engagement: 50, linkClicks: 10, age: 36 }));
  const c = classify({ views: 900, engagement: 10, linkClicks: 40, age: 36 }, withLinks);
  assert.equal(c.measure, 'link_clicks');
  assert.equal(c.box, 'lh', 'few views, but four times the clicks per view');
  assert.equal(classify({ views: 900, engagement: 10, linkClicks: 40, age: 36 }, [...withLinks, { views: 1000, engagement: 50, linkClicks: null, age: 36 }]).measure, 'engagement', 'one post without them, and the measure falls back');
  const thin = classify({ views: 900, engagement: 10, linkClicks: null, age: 36 }, withLinks.slice(0, 2));
  assert.equal(thin.box, null);
  assert.match(thin.why, /2 earlier posts/);
  assert.equal(classify({ views: 0, engagement: 0, linkClicks: null, age: 36 }, withLinks), null, 'no views, nothing to judge');
});

test('posts are compared at the same age, and median is a median', () => {
  const rows = [12, 36, 60].map((a) => ({ age_hours: a }));
  assert.equal(nearest(rows, 40).age_hours, 36);
  assert.equal(nearest(rows, 90), null, 'nothing read within twelve hours of that age');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual(readingOf({ views: null, reach: 50, likes: 1, comments: 2, shares: null, saves: 3, link_clicks: null, age_hours: 5 }), { views: 50, linkClicks: null, engagement: 6, age: 5 });
});

test('the morning report: four posts in four boxes, a directive for each post to make, the winner first', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    seedBoxes(ctx.db);
    const boxes = Object.fromEntries(classifyAccount(ctx.db, pack, { t: T }).map((p) => [p.post, p.box]));
    assert.deepEqual(boxes, { pA: 'hh', pB: 'hl', pC: 'lh', pD: 'll' }, 'the earlier posts are older than three days and are only the baseline');
    const fb = await morningFeedback(ctx, pack, { t: T, pull: false });
    assert.equal(fb.directives.length, 6, 'three variations, and one post for each other box');
    const ds = ctx.db.all('SELECT * FROM directives ORDER BY id').map((d) => ({ ...d, plan: JSON.parse(d.plan_json) }));
    assert.deepEqual(ds.map((d) => d.box), ['hh', 'hh', 'hh', 'lh', 'hl', 'll']);
    // hh: the same format and story, three other covers than the winner's.
    for (const d of ds.filter((x) => x.box === 'hh')) {
      assert.equal(d.plan.formatKey, 'plant-story');
      assert.equal(d.plan.reuseDocs, true);
      assert.notEqual(d.plan.hookId, 'came-back');
      assert.equal(d.plan.steer.kind, 'variation');
    }
    const by = Object.fromEntries(ds.filter((d) => d.box !== 'hh').map((d) => [d.box, d.plan]));
    assert.equal(by.hl.hookId, 'answer-last', 'keep the hook');
    assert.equal(by.hl.avoidCta, 'מי מנצח אצלכם? כתבו בתגובות', '...and change the call to action');
    assert.equal(by.lh.ctaText, 'שלחו למי שמשקה כל יום', 'keep the call to action');
    assert.equal(by.lh.avoidHook, 'still-believe', '...and change the hook');
    assert.deepEqual(by.ll.avoidFormats, ['hot-take'], 'a new format or angle');
    const row = ctx.db.get("SELECT * FROM feedback WHERE account_id = 'demo'");
    assert.equal(row.day, '2026-10-13');
    assert.match(row.text, /הרבה צפיות, הרבה פעולה/);
    assert.ok(ctx.db.get("SELECT id FROM audit WHERE action = 'feedback'"));
  } finally {
    cleanup();
  }
});

test('a new morning replaces the open plans, and a post already answered is not answered again', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    seedBoxes(ctx.db);
    await morningFeedback(ctx, pack, { t: T, pull: false });
    // The day's slots took the three variations and the next one.
    const plans = withDirectives(ctx.db, pack, [{ slotAt: 'a' }, { slotAt: 'b', formatKey: 'plant-vs', subject: { text: 'x' } }, { slotAt: 'c' }, { slotAt: 'd' }, { slotAt: 'e' }]);
    assert.equal(plans[1].directive, undefined, "a fight week's slot keeps its own plan");
    assert.deepEqual(plans.filter((p) => p.directive).map((p) => p.directive.box), ['hh', 'hh', 'hh', 'lh']);
    assert.equal(ctx.db.get("SELECT COUNT(*) AS n FROM directives WHERE status = 'used'").n, 4);
    await morningFeedback(ctx, pack, { t: T + 24 * HOUR, pull: false });
    const open = ctx.db.all("SELECT post_id, box FROM directives WHERE status = 'open'");
    assert.ok(!open.some((d) => d.post_id === 'pA' || d.post_id === 'pC'), 'the winner got its variations yesterday');
    assert.ok(open.some((d) => d.post_id === 'pB'), 'a post whose plan no slot took is planned again from the new numbers');
    assert.equal(ctx.db.get("SELECT COUNT(*) AS n FROM directives WHERE status = 'expired'").n, 2, "yesterday's untaken plans");
  } finally {
    cleanup();
  }
});

test('the measure is link clicks when Instagram gave them for every post compared', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    seedBoxes(ctx.db, { link: true });
    const posts = classifyAccount(ctx.db, ctx.pack('demo'), { t: T });
    assert.ok(posts.every((p) => p.platforms.tiktok.measure === 'link_clicks'));
    assert.equal(posts.find((p) => p.post === 'pC').box, 'lh');
  } finally {
    cleanup();
  }
});

test('the morning pull reads the last days again, even when they were read last night', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    seedBoxes(ctx.db);
    ctx.db.run("UPDATE posts SET publish_json = ? WHERE id = 'pA'", JSON.stringify({ tiktok: { via: 'zernio', zernioId: 'z-1' } }));
    // Its last reading was five hours ago: the regular collection would wait until twenty.
    ctx.db.run("UPDATE metrics SET collected_at = ? WHERE post_id = 'pA'", new Date(T - 5 * HOUR).toISOString());
    const asked = [];
    const source = async (zid) => (asked.push(zid), { tiktok: { views: 5000, likes: 600, comments: 10, shares: 40, saves: null, linkClicks: null } });
    await morningFeedback(ctx, ctx.pack('demo'), { t: T, read: { source } });
    assert.deepEqual(asked, ['z-1']);
    assert.equal(ctx.db.get("SELECT views FROM metrics WHERE post_id = 'pA' ORDER BY id DESC LIMIT 1").views, 5000);
  } finally {
    cleanup();
  }
});

test('the writer is told why: each box has its own line, and the slides prompt carries it', () => {
  assert.equal(steerLine(null), '');
  assert.match(steerLine({ kind: 'variation', hook: 'הפוסט שתפס', n: 2, of: 3 }), /variation 2 of 3[\s\S]*Never the words of "הפוסט שתפס"/);
  assert.match(steerLine({ kind: 'new-cta', hook: 'h', cta: 'שמרו' }), /call to action is a different one[\s\S]*"שמרו"/);
  assert.match(steerLine({ kind: 'new-hooks', hook: 'h', cover: 'stat' }), /Keep the call to action; the cover must be radically different[\s\S]*first-slide picture than its "stat"/);
  assert.match(steerLine({ kind: 'new-angle', hook: 'h', topic: 'נענע' }), /new angle, far from "נענע"/);
  const user = slidesUser({ format: { id: 'plant-story', kind: 'story', name: 'x' }, n: 3, outline: { topic: 't', items: [] }, facts: [], steer: { kind: 'new-angle', hook: 'h' } });
  assert.match(user, /FROM THE RESULTS/);
});

test('a directive drives the post: a variation of a document already used, its format, another cover, the reason in the trace', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const first = await buildPost(ctx, { pack, formatKey: 'plant-story', docKey: 'pothos-story' });
    assert.equal(first.status, 'queued');
    // Without the directive the document is used up; with it, the winner's story is drafted again under a new cover.
    const plan = { id: 77, box: 'hh', formatKey: 'plant-story', docKey: 'pothos-story', reuseDocs: true, hookId: 'nobody-expected', steer: { kind: 'variation', hook: 'x', n: 1, of: 3 } };
    const r = await buildPost(ctx, { pack, directive: plan });
    const post = ctx.db.get('SELECT * FROM posts WHERE id = ?', r.postId);
    assert.equal(r.status, 'queued', r.reason);
    assert.equal(post.directive_id, 77);
    assert.equal(post.format_id, 'plant-story');
    assert.equal(post.hook_pattern, 'nobody-expected');
    const docs = (id) => ctx.db.all('SELECT DISTINCT document_id FROM facts WHERE post_id = ?', id).map((x) => x.document_id).sort().join();
    assert.equal(docs(r.postId), docs(first.postId), 'the same story');
    const fb = JSON.parse(ctx.db.get("SELECT detail_json FROM steps WHERE post_id = ? AND step = 'feedback'", r.postId).detail_json);
    assert.equal(fb.steer.kind, 'variation');
    // A new angle: never the format that did poorly.
    const n = await buildPost(ctx, { pack, directive: { id: 78, box: 'll', avoidFormats: ['plant-story'], steer: { kind: 'new-angle' } } });
    assert.notEqual(ctx.db.get('SELECT format_id FROM posts WHERE id = ?', n.postId).format_id, 'plant-story');
  } finally {
    cleanup();
  }
});

test('the runner: the feedback runs before the day is drafted, and its plans take the first slots', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    seedBoxes(ctx.db);
    const r = await tick(ctx, { t: T });
    assert.deepEqual(r.feedback, { demo: { posts: 4, directives: 6 } });
    const used = ctx.db.all("SELECT * FROM directives WHERE status = 'used' ORDER BY id");
    assert.equal(used.length, r.generated.length, 'every slot drafted today took a plan');
    for (const d of used) {
      assert.ok(d.used_post_id, 'and says which post it became');
      assert.equal(ctx.db.get('SELECT directive_id FROM posts WHERE id = ?', d.used_post_id).directive_id, d.id);
    }
    const again = await tick(ctx, { t: T + HOUR });
    assert.equal(again.feedback, undefined, 'once a day');
  } finally {
    cleanup();
  }
});

test('Results shows each account its report: the four boxes, the posts in them, and what became of the plans', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    seedBoxes(ctx.db);
    assert.match(feedbackPanels(latestFeedback(ctx.db, ctx.packs)), /עוד אין דוח/);
    await morningFeedback(ctx, ctx.pack('demo'), { t: T, pull: false });
    const d = results(ctx, T);
    assert.equal(d.feedback.length, 1);
    const html = feedbackPanels(d.feedback);
    for (const b of Object.values(BOXES)) {
      assert.ok(html.includes(b.he), b.he);
      assert.ok(html.includes(b.todo), b.todo);
    }
    assert.match(html, /href="\/post\/pA"/);
    assert.match(html, /מחכה למשבצת/);
    assert.match(html, /הודעות פרטיות לא נקראות/);
    assert.ok(plansFor(ctx.db, ctx.pack('demo'), { post: 'nope', box: 'hh' }).length === 0);
  } finally {
    cleanup();
  }
});
