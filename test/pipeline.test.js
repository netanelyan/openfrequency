import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost, loadPost } from '../src/pipeline/build.js';
import { closeBrowser } from '../src/render/render.js';
import { setSetting } from '../src/core/store.js';
import { monthSpend, record } from '../src/budget/ledger.js';
import { copyPack, keepOnly, opened, setDraft, tempHome } from './helpers.js';

// The whole pipeline on the fictional demo pack, offline: recorded documents,
// recorded drafts, real checks, real rendering.

after(() => closeBrowser());

function contextFor(home) {
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home, 'media');
  return ctx;
}

test('a demo post goes from topic to rendered slides, every fact traced to an approved source', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const res = await buildPost(ctx, { pack, formatKey: 'care-guide' });
    assert.equal(res.status, 'queued', res.reason);
    const post = loadPost(ctx.db, res.postId);
    const items = post.slides.filter((s) => s.kind === 'item');
    assert.ok(items.length >= 3);
    assert.equal(post.slides[0].kind, 'cover');
    assert.equal(post.slides.at(-1).kind, 'closer');
    for (const s of items) {
      assert.ok(s.factKeys.length, 'every content slide cites a fact');
      for (const k of s.factKeys) {
        const f = post.facts.find((x) => x.key === k);
        assert.ok(f?.verified, `fact ${k} is verified`);
        assert.equal(f.source_status, 'approved');
        assert.ok(f.doc_url);
      }
    }
    for (const platform of ['tiktok', 'instagram']) {
      assert.equal(post.media[platform].length, post.slides.length);
      for (const f of post.media[platform]) assert.ok(existsSync(f));
    }
    const steps = ctx.db.all('SELECT step FROM steps WHERE post_id = ?', res.postId).map((s) => s.step);
    for (const s of ['topic', 'outline', 'facts', 'slides', 'review', 'verify', 'render', 'queue']) assert.ok(steps.includes(s), `step ${s} recorded`);
    assert.ok(post.cost_usd > 0, 'a cost per post is recorded');
    assert.ok(/#/.test(post.hashtags[0]));
  } finally {
    cleanup();
  }
});

test('a draft that invents a number is blocked as a failed fact check', async () => {
  const { home, cleanup } = tempHome();
  try {
    const dir = path.join(home, 'packs', 'demo');
    keepOnly(dir, ['basil-containers']);
    setDraft(dir, 'basil-containers', (d) => {
      d.slides.slides[0].body = 'בזיליקום צריך לפחות 9 שעות שמש ישירה ביום.';
    });
    const ctx = contextFor(home);
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'blocked');
    assert.equal(res.kind, 'fact_check');
    assert.match(res.reason, /number 9/);
  } finally {
    cleanup();
  }
});

test('a draft whose quote is not in the source loses that fact before any slide is written', async () => {
  const { home, cleanup } = tempHome();
  try {
    const dir = path.join(home, 'packs', 'demo');
    keepOnly(dir, ['basil-containers']);
    setDraft(dir, 'basil-containers', (d) => {
      for (const f of d.outline.facts) f.quote = `${f.quote} (paraphrased)`.replace('Basil', 'The basil plant');
    });
    const ctx = contextFor(home);
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'blocked');
    assert.equal(res.kind, 'fact_check');
  } finally {
    cleanup();
  }
});

test('a money post recommending a fund fails (investment advice, hard rule 6)', async () => {
  const { home, cleanup } = tempHome({ packs: {} });
  try {
    const dir = copyPack(home, 'demo', (f) => {
      f.pack.topics = [...f.pack.topics, 'חיסכון'];
      f.pack.compliance = ['il-investment-advice'];
    });
    keepOnly(dir, ['basil-containers']);
    setDraft(dir, 'basil-containers', (d) => {
      d.slides.caption = 'ומי שחוסך לפנסיה, כדאי להשקיע בקרן מחקה S&P 500 של מיטב.';
    });
    const ctx = contextFor(home);
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'blocked');
    assert.equal(res.kind, 'rules');
    assert.match(res.reason, /ייעוץ השקעות/);
  } finally {
    cleanup();
  }
});

test('a post over budget fails before anything is spent', async () => {
  const { home, cleanup } = tempHome({ packs: {} });
  try {
    copyPack(home, 'demo', (f) => {
      f.pack.budget.monthlyUsd = 0.01;
    });
    const ctx = contextFor(home);
    const res = await buildPost(ctx, { pack: ctx.pack('demo') });
    assert.equal(res.status, 'blocked');
    assert.equal(res.kind, 'budget');
    assert.equal(monthSpend(ctx.db, 'demo').usd, 0, 'nothing was paid for');
  } finally {
    cleanup();
  }
});

test('a month that has spent its budget builds nothing more, and the cap is never crossed', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const first = await buildPost(ctx, { pack });
    assert.equal(first.status, 'queued', first.reason);
    record(ctx.db, { accountId: 'demo', api: 'claude', usd: pack.meta.budget.monthlyUsd - monthSpend(ctx.db, 'demo').usd - 0.01, tag: 'test' });
    const second = await buildPost(ctx, { pack });
    assert.equal(second.kind, 'budget');
    assert.ok(monthSpend(ctx.db, 'demo').usd <= pack.meta.budget.monthlyUsd + 1e-9);
  } finally {
    cleanup();
  }
});

test('the global budget stops every account', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    setSetting(ctx.db, 'globalBudgetUsd', 0.001);
    const res = await buildPost(ctx, { pack: ctx.pack('demo') });
    assert.equal(res.kind, 'budget');
    assert.match(res.reason, /global/);
  } finally {
    cleanup();
  }
});

test('a paused account and the global kill switch build nothing', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    ctx.db.run("UPDATE accounts SET status = 'paused', paused_reason = 'kill' WHERE id = 'demo'");
    await assert.rejects(buildPost(ctx, { pack: ctx.pack('demo') }), /paused/);
    ctx.db.run("UPDATE accounts SET status = 'active', paused_reason = NULL WHERE id = 'demo'");
    setSetting(ctx.db, 'globalKill', true);
    await assert.rejects(buildPost(ctx, { pack: ctx.pack('demo') }), /kill switch/);
  } finally {
    cleanup();
  }
});

test('a draft that names another of our accounts is blocked (no cross-promotion)', async () => {
  const { home, cleanup } = tempHome({ packs: {} });
  try {
    const dir = copyPack(home, 'demo');
    copyPack(home, 'second', (f) => {
      f.theme.template = 'poster';
      f.theme.fonts.display = 'Secular One';
      f.theme.colors.bg = '#101820';
      f.theme.colors.surface = '#1C2733';
      f.theme.colors.ink = '#F4F4F4';
      f.theme.colors.muted = '#B8C0C8';
      f.theme.colors.accent = '#3FA7D6';
      f.theme.colors.onAccent = '#101820';
    });
    keepOnly(dir, ['basil-containers']);
    setDraft(dir, 'basil-containers', (d) => {
      d.slides.caption = 'ועוד טיפים אצל @second.test, החשבון השני שלנו.';
    });
    const ctx = contextFor(home);
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'blocked');
    assert.match(res.reason, /another of our accounts/);
  } finally {
    cleanup();
  }
});
