import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost } from '../src/pipeline/build.js';
import { closeBrowser } from '../src/render/render.js';
import { setSetting } from '../src/core/store.js';
import { setNow } from '../src/core/clock.js';
import { BudgetError, ceilingUsd, claudeCost, globalCap, MODEL_RATES, monthReserved, monthSpend, reserve, settle, WORST } from '../src/budget/ledger.js';
import { planMonth, savePlan } from '../src/budget/plan.js';
import { tick } from '../src/autonomy/runner.js';
import { makeBatcher, recoverBatches } from '../src/llm/batch.js';
import { initState, spendStatus } from '../src/budget/anthropic.js';
import { recordedClient } from '../src/llm/recorded.js';
import { promptTokenBound } from '../src/llm/claude.js';
import { budgetBanner } from '../src/web/ui.js';
import { israelInstant } from '../src/schedule/israel.js';
import { copyPack, keepOnly, opened, tempHome } from './helpers.js';

// HARD RULE 7, the $15 month: nothing can spend past the cap, however the calls
// are made (one by one, at once, in a batch), and when money runs short the
// volume is cut, never the quality.

after(() => closeBrowser());
afterEach(() => {
  delete process.env.OF_BUDGET_MONTHLY_USD;
  setNow(null);
});

function contextFor(home) {
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home, 'media');
  return ctx;
}

/**
 * Usage that bills a call at the most it could cost: as many prompt tokens as the
 * prompt has bytes (no token is shorter than a byte), every one a 1-hour cache
 * write, and every output token max_tokens allows.
 */
const worstUsage = (params) => {
  const bound = promptTokenBound(params);
  return { input_tokens: 0, cache_creation_input_tokens: bound, cache_creation: { ephemeral_1h_input_tokens: bound, ephemeral_5m_input_tokens: 0 }, cache_read_input_tokens: 0, output_tokens: params.max_tokens };
};

test('a call never costs more than its ceiling, on any model, direct, batched or after a fallback', () => {
  for (const model of Object.keys(MODEL_RATES)) {
    for (const promptTokens of [10, 5000, 99_000, 150_000]) {
      for (const maxTokens of [1000, 10_000]) {
        const usage = { input_tokens: 0, cache_creation_input_tokens: promptTokens, cache_creation: { ephemeral_1h_input_tokens: promptTokens }, output_tokens: maxTokens };
        for (const batch of [false, true]) {
          assert.ok(claudeCost(usage, model, { batch }) <= ceilingUsd({ model, promptTokens, maxTokens, batch }) + 1e-12, `${model} ${promptTokens} ${maxTokens} ${batch}`);
        }
        // A fallback is billed at the model that served it; the ceiling assumes the dearest.
        for (const served of Object.keys(MODEL_RATES)) assert.ok(claudeCost(usage, served) <= ceilingUsd({ model, promptTokens, maxTokens, fallback: true }) + 1e-12);
      }
    }
  }
  // A write without its split is billed at the dearer 1-hour rate, never hidden.
  assert.equal(claudeCost({ cache_creation_input_tokens: 1e6 }, 'claude-sonnet-5-5'), MODEL_RATES['claude-sonnet-5-5'].write1h);
  assert.ok(Math.abs(claudeCost({ input_tokens: 50_000, output_tokens: 50_000 }, 'claude-haiku-5-5', { batch: true }) - 0.015) < 1e-12, 'Haiku 5.5, batched');
  assert.ok(Math.abs(claudeCost({ input_tokens: 150_000, output_tokens: 10_000 }, 'claude-haiku-5-5') - 0.1) < 1e-12, 'a prompt over 100,000 tokens is billed at its second tier');
  assert.equal(WORST, MODEL_RATES['claude-fable-5-1']);
});

test('the cap is ANTHROPIC_MONTHLY_BUDGET_USD, $20 by default (the older OF_BUDGET_MONTHLY_USD still read); the website can lower it, never raise it', () => {
  const db = new Db(':memory:');
  assert.equal(globalCap(db, {}), 20);
  assert.equal(globalCap(db, { ANTHROPIC_MONTHLY_BUDGET_USD: '12', OF_BUDGET_MONTHLY_USD: '9' }), 12, 'the new name first');
  assert.equal(globalCap(db, { OF_BUDGET_MONTHLY_USD: '9' }), 9);
  setSetting(db, 'globalBudgetUsd', 4);
  assert.equal(globalCap(db, { OF_BUDGET_MONTHLY_USD: '9' }), 4);
  setSetting(db, 'globalBudgetUsd', 400);
  assert.equal(globalCap(db, { OF_BUDGET_MONTHLY_USD: '9' }), 9, 'a higher setting is ignored');
});

test('reservations are taken against the cap together: two calls cannot both pass on the same money', () => {
  const db = new Db(':memory:');
  const env = { OF_BUDGET_MONTHLY_USD: '1' };
  const ids = [];
  for (let i = 0; i < 20; i++) {
    try {
      ids.push(reserve(db, { usd: 0.15, env }));
    } catch (e) {
      assert.ok(e instanceof BudgetError);
    }
  }
  assert.equal(ids.length, 6, '6 x $0.15 fit in $1, the 7th does not');
  assert.ok(monthReserved(db).usd <= 1);
  // Settling replaces the hold by what was really spent, and frees the rest.
  for (const id of ids) settle(db, id, { api: 'claude', usd: 0.05 });
  assert.equal(monthReserved(db).usd, 0);
  assert.ok(Math.abs(monthSpend(db).usd - 0.3) < 1e-9);
  assert.doesNotThrow(() => reserve(db, { usd: 0.6, env }));
});

/** A Claude client that bills the worst case for every call, answering from the recordings. */
function worstClient({ served = null } = {}) {
  const rec = recordedClient();
  return {
    kind: 'claude',
    fallsBack: () => Boolean(served),
    async json(req) {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const usage = worstUsage(req.params);
      if (req.task === 'review') return { data: { reviews: [] }, usage, model: served || req.model };
      try {
        const r = await rec.json(req);
        return { ...r, usage, model: served || req.model, estimated: false };
      } catch (e) {
        throw Object.assign(e, { usage, model: served || req.model });
      }
    },
  };
}

test('nothing can spend past the cap: worst-case bills, one at a time and all at once', async () => {
  const { home, cleanup } = tempHome();
  try {
    for (const [label, served, parallel] of [['direct', null, false], ['concurrent', null, true], ['fallback to the dearest model', 'claude-fable-5-1', true]]) {
      const ctx = contextFor(home);
      ctx.db.run('DELETE FROM spend');
      process.env.OF_BUDGET_MONTHLY_USD = '0.75';
      ctx.llm = worstClient({ served });
      const pack = ctx.pack('demo');
      const runs = Array.from({ length: 8 }, () => () => buildPost(ctx, { pack }));
      const results = parallel ? await Promise.all(runs.map((f) => f())) : await runs.reduce(async (acc, f) => [...(await acc), await f()], Promise.resolve([]));
      const spent = monthSpend(ctx.db).usd;
      assert.ok(spent <= 0.75 + 1e-9, `${label}: spent $${spent} of $0.75`);
      assert.ok(results.some((r) => r.kind === 'budget'), `${label}: the cap stopped some posts`);
      assert.equal(monthReserved(ctx.db).usd, 0, `${label}: no money is left held`);
    }
  } finally {
    cleanup();
  }
});

/** A fake Message Batches API: answers every request from the demo's basil recording, billed at the worst case. */
function fakeBatchApi(pack, { onCreate = () => {} } = {}) {
  const batches = new Map();
  const rec = JSON.parse(JSON.stringify(require_('basil-containers', pack)));
  let n = 0;
  return {
    batches,
    async create(requests) {
      const id = `msgbatch_${++n}`;
      batches.set(id, requests);
      onCreate(requests);
      return { id, status: 'in_progress' };
    },
    async retrieve(id) {
      return { id, status: 'ended', counts: { succeeded: batches.get(id).length } };
    },
    async *results(id) {
      for (const r of batches.get(id)) {
        const sys = r.params.system.map((b) => b.text).join('\n');
        const data = /TASK: PLAN ONE POST/.test(sys) ? rec.outline : /TASK: WRITE ONE POST/.test(sys) ? rec.slides : /TASK: FIND THE DETAILS/.test(sys) ? { details: [] } : { reviews: [] };
        yield { custom_id: r.custom_id, result: { type: 'succeeded', message: { model: r.params.model, stop_reason: 'end_turn', usage: worstUsage(r.params), content: [{ type: 'text', text: JSON.stringify(data) }] } } };
      }
    },
  };
}
import { readFileSync } from 'node:fs';
const require_ = (key, pack) => JSON.parse(readFileSync(path.join(pack.recordingsDir, 'drafts', `${key}.json`), 'utf8'));

test('the day is drafted in batches: one batch per round for every post at once, billed at half price from the usage', async () => {
  const { home, cleanup } = tempHome();
  try {
    keepOnly(path.join(home, 'packs', 'demo'), ['basil-containers']);
    initState();
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const sizes = [];
    const api = fakeBatchApi(pack, { onCreate: (reqs) => sizes.push(reqs.length) });
    const batcher = makeBatcher(ctx, { api, pollMs: [1] });
    const bctx = { ...ctx, llm: batcher };
    const res = await Promise.all([0, 1, 2].map(() => batcher.run(() => buildPost(bctx, { pack, formatKey: 'care-guide' }))));
    assert.deepEqual(res.map((r) => r.status), ['queued', 'queued', 'queued'], JSON.stringify(res.map((r) => r.reason)));
    assert.deepEqual(sizes, [3, 3, 3, 3], 'three posts: their outlines in one batch, then their details, then their slides, then their reviews');
    const rows = ctx.db.all("SELECT * FROM spend WHERE api = 'claude'");
    assert.equal(rows.length, 12);
    assert.ok(rows.every((r) => r.batch === 1 && r.usage_json && !r.estimated), 'every call recorded from its usage, as a batch call');
    const outline = rows.find((r) => r.tag === 'outline');
    assert.ok(Math.abs(outline.usd - claudeCost(JSON.parse(outline.usage_json), outline.model) / 2) < 1e-12, 'at half price');
    assert.equal(monthReserved(ctx.db).usd, 0);
    assert.ok(ctx.db.all("SELECT status FROM batches").every((b) => b.status === 'recorded'));
    // And every one of them in the spend file the cap is checked against: the batch path once went past it uncounted.
    const file = spendStatus();
    assert.equal(file.calls, 12);
    assert.ok(Math.abs(file.usd - rows.reduce((t, r) => t + r.usd, 0)) < 1e-4, 'the file holds what the ledger holds');
  } finally {
    cleanup();
  }
});

test('a batch a restart left behind is still recorded, and its money is never lost track of', async () => {
  const { home, cleanup } = tempHome();
  try {
    initState();
    const ctx = contextFor(home);
    const pack = ctx.pack('demo');
    const api = fakeBatchApi(pack);
    // A batch sent by a process that then died: its row and its holds are all that is left.
    const params = { model: 'claude-sonnet-5-5', max_tokens: 100, system: [{ type: 'text', text: 'TASK: PLAN ONE POST' }], messages: [{ role: 'user', content: 'x' }], output_config: {} };
    const rid = reserve(ctx.db, { pack, usd: 0.5 });
    const { id } = await api.create([{ custom_id: 'p1-outline-1', params }]);
    ctx.db.insert('batches', { id, status: 'in_progress', requests_json: { 'p1-outline-1': { account_id: 'demo', post_id: 'p1', model: params.model, tag: 'outline', reservation: rid } }, created_at: new Date().toISOString() });
    assert.equal(monthReserved(ctx.db).usd, 0.5);
    assert.deepEqual(await recoverBatches(ctx, { api }), [id]);
    assert.equal(monthReserved(ctx.db).usd, 0, 'the hold is released');
    const row = ctx.db.get("SELECT * FROM spend WHERE tag = 'outline'");
    assert.ok(row && row.batch === 1 && row.usd > 0 && row.usd <= 0.5, 'and what the batch really cost is recorded');
    assert.ok(Math.abs(spendStatus().usd - row.usd) < 1e-6, 'in the spend file too');
    assert.deepEqual(await recoverBatches(ctx, { api }), [], 'once');
  } finally {
    cleanup();
  }
});

test('money short: the weakest account comes down first, half a post a day at a time, the website says so, and 100% stops generation', async () => {
  const { home, cleanup } = tempHome({ packs: {} });
  try {
    copyPack(home, 'demo');
    copyPack(home, 'second', (f) => {
      f.theme.template = 'poster';
      f.theme.fonts.display = 'Secular One';
      Object.assign(f.theme.colors, { bg: '#101820', surface: '#1C2733', ink: '#F4F4F4', muted: '#B8C0C8', accent: '#3FA7D6', onAccent: '#101820' });
    });
    const ctx = contextFor(home);
    const t = israelInstant('2026-10-05', '07:30').getTime();
    setNow(t);
    // The second account has been approved far more often: it is the stronger one.
    const at = new Date(t - 86_400_000).toISOString();
    for (let i = 0; i < 6; i++) {
      ctx.db.insert('posts', { id: `d${i}`, account_id: 'demo', status: i < 2 ? 'published' : 'rejected', created_at: at, updated_at: at });
      ctx.db.insert('posts', { id: `s${i}`, account_id: 'second', status: i < 5 ? 'published' : 'rejected', created_at: at, updated_at: at });
    }
    process.env.OF_BUDGET_MONTHLY_USD = '15';
    let plan = planMonth(ctx.db, ctx.packs, { t });
    assert.equal(plan.level, 'ok');
    assert.ok(plan.accounts.every((a) => !a.cut), 'two posts a day each fit in $15');
    // A month that costs more: $0.40 a post would not fit at two a day.
    for (const id of ['demo', 'second']) for (let i = 0; i < 4; i++) ctx.db.insert('spend', { account_id: id, api: 'claude', usd: 0.4 / 4 * 4, month: '2026-10', at, estimated: 0 });
    ctx.db.run("UPDATE posts SET created_at = ?", at);
    plan = planMonth(ctx.db, ctx.packs, { t });
    const demo = plan.accounts.find((a) => a.id === 'demo');
    const second = plan.accounts.find((a) => a.id === 'second');
    assert.equal(demo.basis, 'approval');
    assert.ok(demo.cut && demo.perDay < 2, 'the weaker account is cut');
    assert.ok(demo.perDay <= second.perDay, 'the weaker account is cut first and deepest');
    assert.ok(plan.accounts.every((a) => a.perDay >= 0.5 && (a.perDay * 2) % 1 === 0), 'in half-post steps, never under a post every other day');
    assert.ok(plan.forecast > 0 && plan.postsLeft >= 0);
    savePlan(ctx.db, plan, { t });
    const banner = budgetBanner({ level: plan.level, share: plan.spent / plan.cap, cap: plan.cap, forecast: plan.forecast, nextMonth: plan.nextMonth, cuts: plan.accounts.filter((a) => a.cut).map((a) => ({ name: a.name, perDay: a.perDay, planned: a.planned })) });
    assert.match(banner, /(פוסט כל יומיים|פוסט אחד ביום|3 פוסטים ביומיים) במקום 2 ביום/);
    if (!second.cut) assert.ok(second.alloc > demo.alloc, 'the money a cut frees goes to the account that keeps its volume');
    // At the warning level (ANTHROPIC_BUDGET_WARN_USD, here $12 of $15): a warning on every page.
    process.env.ANTHROPIC_BUDGET_WARN_USD = '12';
    ctx.db.insert('spend', { account_id: null, api: 'claude', usd: 12 - plan.spent, month: '2026-10', at, estimated: 0 });
    plan = planMonth(ctx.db, ctx.packs, { t });
    assert.equal(plan.level, 'warn');
    assert.match(budgetBanner({ level: 'warn', share: 0.8, cap: 15, forecast: 16, nextMonth: '2026-11-01', cuts: [] }), /80%/);
    // 100%: nothing is generated until the next month.
    ctx.db.insert('spend', { account_id: null, api: 'claude', usd: 3, month: '2026-10', at, estimated: 0 });
    const r = await tick(ctx, { t });
    assert.equal(r.budget, 'stop');
    assert.equal(r.generated.length, 0);
    assert.equal(r.budgetStop, true);
    assert.match(budgetBanner({ level: 'stop', share: 1, cap: 15, nextMonth: '2026-11-01', cuts: [] }), /שום פוסט לא נכתב עד/);
  } finally {
    delete process.env.ANTHROPIC_BUDGET_WARN_USD;
    cleanup();
  }
});
