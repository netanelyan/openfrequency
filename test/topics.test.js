import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost } from '../src/pipeline/build.js';
import { addBankTopic, addTopic, readyTopics, scoreTopics, spikeOf, topShorts, topicById, wikipediaSpikes } from '../src/topics/index.js';
import { closeBrowser } from '../src/render/render.js';
import { opened, tempHome } from './helpers.js';

after(() => closeBrowser());

// Topics first (src/topics): what people look at and what the owner knows went viral, scored for how hard it stops
// a scroll before any outline, and only then searched for in the approved sources.

const contextFor = (home) => {
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home, 'media');
  return ctx;
};

/** A model that scores topics with `scores` (id -> answer) and answers everything else as recorded. */
const scorer = (ctx, scores, { remap = null } = {}) => ({
  ...ctx.llm,
  async json(req) {
    if (req.task === 'topics') {
      const ids = [...req.user.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      return { data: { topics: ids.map((id) => ({ id, fits: true, shock: 0, money: 0, rivalry: 0, hidden: 0, didntKnow: 0, score: 5, angle: '', terms: [], why: '', ...(scores[id] || {}) })) }, usage: null, model: req.model, estimated: true };
    }
    // A topic's candidate is drafted from a recorded document: its recording answers for it.
    if (remap && String(req.meta?.docKey || '').startsWith('topic:')) return ctx.llm.json({ ...req, meta: { ...req.meta, docKey: remap } });
    return ctx.llm.json(req);
  },
});

test('a spike is this week against the four before; a flat page or a quiet one is not a signal', async () => {
  const flat = Array(35).fill(1000);
  assert.ok(spikeOf(flat).ratio < 1.01);
  const up = [...Array(28).fill(1000), ...Array(7).fill(3000)];
  assert.deepEqual(spikeOf(up), { ratio: 3, week: 3000, before: 1000 });
  assert.equal(spikeOf([1, 2, 3]), null);
  const views = { Hot_Player: up, Calm_Player: flat, Tiny_Team: [...Array(28).fill(10), ...Array(7).fill(50)] };
  const fetchJson = async (url) => {
    const m = /per-article\/en\.wikipedia\/all-access\/user\/([^/]+)\//.exec(url);
    if (m) return { items: views[decodeURIComponent(m[1])].map((v) => ({ views: v })) };
    return { extract: 'A player who did something this week.' };
  };
  const s = await wikipediaSpikes(['Hot Player', 'Calm Player', 'Tiny Team'], { fetchJson });
  assert.deepEqual(s.map((x) => x.name), ['Hot Player'], 'the quiet page under the daily minimum is not a signal either');
  assert.equal(s[0].extract, 'A player who did something this week.');
});

test('the Shorts most viewed for the account\'s searches, titles and YouTube\'s numbers only', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = { ...ctx.pack('demo'), formats: { ...ctx.pack('demo').formats, trends: { queries: { he: ['צמחי בית'] }, minViews: { he: 1000 } } } };
    const yt = {
      search: async () => [{ id: 'a', url: 'u/a', title: 'big' }, { id: 'b', url: 'u/b', title: 'small' }, { id: 'c', url: 'u/c', title: 'hidden' }],
      stats: async () => new Map([['a', { views: 90_000 }], ['b', { views: 500 }], ['c', { views: null }]]),
    };
    const top = await topShorts(ctx.db, pack, { yt });
    assert.deepEqual(top.map((v) => v.title), ['big'], 'under the minimum, or with hidden numbers, is left out');
  } finally {
    cleanup();
  }
});

test('scored before any outline: a signal under 6 or off the niche is never offered; the bank comes first whatever its score', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const bank = addBankTopic(ctx.db, 'demo', { title: 'הפוטוס ששרד 81 יום לבד', why: 'מיליון צפיות בטיקטוק', url: 'https://www.tiktok.com/@x/video/1' });
    const strong = addTopic(ctx.db, 'demo', { origin: 'wikipedia', key: 'wiki:en:Pothos:w1', title: 'Pothos', why: 'spike' });
    const weak = addTopic(ctx.db, 'demo', { origin: 'youtube', key: 'yt:1', title: 'A balcony tour' });
    const off = addTopic(ctx.db, 'demo', { origin: 'youtube', key: 'yt:2', title: 'A car crash', expiresAt: null });
    const old = addTopic(ctx.db, 'demo', { origin: 'youtube', key: 'yt:3', title: 'Last month', expiresAt: '2000-01-01T00:00:00Z' });
    const llm = scorer(ctx, {
      [bank]: { score: 4, shock: 7, angle: 'הפוטוס ששרד לבד', terms: ['Epipremnum aureum'] },
      [strong]: { score: 8, hidden: 9, didntKnow: 8, angle: 'מה שלא סיפרו לכם על פוטוס', why: 'סיפור נסתר' },
      [weak]: { score: 5 },
      [off]: { score: 9, fits: false },
    });
    const r = await scoreTopics({ ...ctx, llm }, pack);
    assert.deepEqual(r, { scored: 4, ready: 2 });
    const t = (id) => topicById(ctx.db, id);
    assert.equal(t(bank).status, 'ready', 'the owner knows it works: scored, never skipped');
    assert.equal(t(strong).status, 'ready');
    assert.deepEqual([t(strong).score, t(strong).parts.hidden, t(strong).parts.didntKnow], [8, 9, 8]);
    assert.equal(t(weak).status, 'low');
    assert.match(t(weak).note, /מתחת ל-6/);
    assert.equal(t(off).score, 0, 'off the niche scores 0');
    assert.equal(t(old).status, 'new', 'an expired signal is not even scored');
    assert.deepEqual(readyTopics(ctx.db, 'demo', { limit: 5 }).map((x) => x.id), [bank, strong], 'the bank first, then the best signal');
  } finally {
    cleanup();
  }
});

test('a post starts from the chosen topic and its facts come from the approved sources; a topic nothing supports is left', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const lost = addBankTopic(ctx.db, 'demo', { title: 'Quantum gardening on Mars', why: 'trending' });
    const viral = addBankTopic(ctx.db, 'demo', { title: 'הפוטוס במשרד הסגור', why: 'שרד 81 יום בלי מים, ואנשים לא האמינו' });
    const llm = scorer(ctx, { [lost]: { score: 9, terms: ['Quantum gardening Mars'] }, [viral]: { score: 8, shock: 8, angle: 'הפוטוס ששרד 81 יום לבד', terms: ['שיפוץ'] } }, { remap: 'pothos-story' });
    await scoreTopics({ ...ctx, llm }, pack);
    const res = await buildPost({ ...ctx, llm }, { pack, formatKey: 'plant-story', sample: true });
    assert.equal(res.status, 'sample', res.reason);
    const post = ctx.db.get('SELECT topic_id FROM posts WHERE id = ?', res.postId);
    assert.equal(post.topic_id, viral, 'the post is about the bank topic the sources hold up');
    assert.equal(topicById(ctx.db, lost).status, 'unsupported', 'nothing approved says a word about it');
    assert.equal(topicById(ctx.db, viral).status, 'used');
    assert.equal(topicById(ctx.db, viral).post_id, res.postId);
    // Every fact still comes from a stored document of an approved source.
    const facts = ctx.db.all('SELECT f.verified, s.status FROM facts f JOIN sources s ON s.id = f.source_id WHERE f.post_id = ?', res.postId);
    assert.ok(facts.length && facts.every((f) => f.status === 'approved'));
    const steps = ctx.db.all("SELECT status, detail_json FROM steps WHERE post_id = ? AND step = 'viral' ORDER BY id", res.postId).map((s) => ({ status: s.status, ...JSON.parse(s.detail_json) }));
    assert.deepEqual(steps.map((s) => [s.status, s.topic]), [['skipped', lost], ['info', viral]]);
    assert.equal(steps[1].score, 8);
  } finally {
    cleanup();
  }
});
