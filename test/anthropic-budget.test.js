import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { opened, tempHome } from './helpers.js';
import { Db } from '../src/db/index.js';
import { askJson } from '../src/llm/index.js';
import { claudeCost } from '../src/budget/ledger.js';
import { MODEL_RATES } from '../src/budget/pricing.js';
import { BudgetExceededError, checkCall, initState, limits, logPath, readState, recordCall, spendStatus, statePath } from '../src/budget/anthropic.js';
import { ROOT } from '../src/core/paths.js';

// The Anthropic API's monthly cap (src/budget/anthropic.js). Every test mocks the
// API: a client that counts its calls and answers with a usage block. No real call.

const OCT = Date.parse('2026-10-15T12:00:00Z');
const NOV = Date.parse('2026-11-01T00:30:00Z');
const env = (extra = {}) => ({ OF_HOME: process.env.OF_HOME, ANTHROPIC_MONTHLY_BUDGET_USD: '20', ANTHROPIC_BUDGET_WARN_USD: '15', ...extra });

function home() {
  const t = tempHome();
  initState({ env: env() });
  return t;
}

/** A mocked API client: counts calls, answers with a fixed usage block. */
function apiClient(usage = { input_tokens: 1000, output_tokens: 500 }) {
  const c = {
    kind: 'claude',
    backend: 'api',
    calls: 0,
    fallsBack: () => false,
    async json(req) {
      c.calls++;
      return { data: { ok: true }, usage, model: req.model, estimated: false };
    },
  };
  return c;
}

function ctxWith(llm) {
  const db = new Db(path.join(process.env.OF_HOME, 'data', 'test.db'));
  opened.push(db);
  return { db, pack: null, postId: null, llm, log: () => {} };
}

const req = (extra = {}) => ({ task: 'test', model: 'claude-sonnet-5-5', system: 'system', user: 'user', schema: { type: 'object', properties: {}, additionalProperties: true }, maxTokens: 1000, tag: 'test', ...extra });

test('the cost of a call, per model, cache writes and reads and the batch discount included', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
  for (const [model, r] of Object.entries(MODEL_RATES)) {
    // Without the 5-minute/1-hour split a cache write is billed at the dearer 1-hour rate.
    const want = r.in + r.out + r.write1h + r.cacheRead;
    const tier = r.long && 3_000_000 > r.long.over ? r.long : r;
    const expect = r.long ? tier.in + tier.out + tier.write1h + tier.cacheRead : want;
    assert.ok(Math.abs(claudeCost(usage, model) - expect) < 1e-9, model);
    assert.ok(Math.abs(claudeCost(usage, model, { batch: true }) - expect / 2) < 1e-9, `${model} in a batch`);
  }
  const split = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 2_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } };
  assert.ok(Math.abs(claudeCost(split, 'claude-sonnet-5-5') - (2.5 + 4)) < 1e-9, 'the split is billed at each rate');
});

test('the cap and the warning level come from the env, $20 and $15 by default, the warning never above the cap', () => {
  assert.deepEqual(limits({}), { cap: 20, warn: 15 });
  assert.deepEqual(limits({ ANTHROPIC_MONTHLY_BUDGET_USD: '30', ANTHROPIC_BUDGET_WARN_USD: '25' }), { cap: 30, warn: 25 });
  assert.deepEqual(limits({ ANTHROPIC_MONTHLY_BUDGET_USD: '10' }), { cap: 10, warn: 10 });
});

test('a call is refused at the cap, and the estimate before it keeps the month from running over', async () => {
  const { cleanup } = home();
  try {
    recordCall({ model: 'claude-sonnet-5-5', usd: 19.9, job: 'earlier', t: OCT, env: env() });
    assert.throws(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.2, t: OCT, env: env() }), (e) => e instanceof BudgetExceededError && e.reason === 'cap');
    assert.doesNotThrow(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.05, t: OCT, env: env() }));
    assert.throws(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.05, inFlightUsd: 0.06, t: OCT, env: env() }), /monthly cap/, 'calls in flight count');
    // Through the one door: a call whose ceiling does not fit is never made.
    process.env.ANTHROPIC_MONTHLY_BUDGET_USD = '20';
    const client = apiClient();
    const ctx = ctxWith(client);
    const big = req({ user: 'x'.repeat(200_000), maxTokens: 32_000 });
    const before = readState(env()).months['2026-10']?.usd;
    await assert.rejects(askJson(ctx, big), (e) => e instanceof BudgetExceededError);
    assert.equal(client.calls, 0, 'refused before the call');
    assert.equal(readState(env()).months['2026-10']?.usd, before, 'nothing added');
  } finally {
    delete process.env.ANTHROPIC_MONTHLY_BUDGET_USD;
    cleanup();
  }
});

test('a new month starts from what it has spent, not from the month before', () => {
  const { cleanup } = home();
  try {
    recordCall({ model: 'claude-sonnet-5-5', usd: 20, job: 'october', t: OCT, env: env() });
    assert.throws(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.01, t: OCT, env: env() }), /monthly cap/);
    assert.doesNotThrow(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.01, t: NOV, env: env() }));
    assert.equal(spendStatus({ t: NOV, env: env() }).usd, 0);
    assert.equal(spendStatus({ t: OCT, env: env() }).usd, 20);
  } finally {
    cleanup();
  }
});

test('a missing or unreadable spend file blocks every API call: it never reads as $0', async () => {
  const { cleanup } = home();
  try {
    const file = statePath(env());
    rmSync(file);
    assert.throws(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.01, t: OCT, env: env() }), (e) => e.reason === 'state_missing');
    const client = apiClient();
    await assert.rejects(askJson(ctxWith(client), req()), (e) => e instanceof BudgetExceededError && e.reason === 'state_missing');
    assert.equal(client.calls, 0);
    writeFileSync(file, '{ not json');
    assert.throws(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.01, t: OCT, env: env() }), (e) => e.reason === 'state_corrupt');
    writeFileSync(file, JSON.stringify({ version: 1, months: { '2026-10': { usd: -5 } } }));
    assert.throws(() => checkCall({ model: 'claude-sonnet-5-5', ceilingUsd: 0.01, t: OCT, env: env() }), (e) => e.reason === 'state_corrupt', 'a negative total is not believed');
    // init creates it only when it is missing, never over an existing one.
    rmSync(file);
    assert.equal(initState({ seedUsd: { '2026-10': 3.5 }, env: env() }).created, true);
    assert.equal(readState(env()).months['2026-10'].usd, 3.5, 'it starts at what the ledger recorded');
    assert.equal(initState({ env: env() }).created, false);
  } finally {
    cleanup();
  }
});

test('a model that is not in the pricing table is refused, never guessed', async () => {
  const { cleanup } = home();
  try {
    assert.throws(() => checkCall({ model: 'claude-mystery-9', ceilingUsd: 0, t: OCT, env: env() }), (e) => e.reason === 'unknown_model');
    const client = apiClient();
    await assert.rejects(askJson(ctxWith(client), req({ model: 'claude-mystery-9' })), (e) => e.reason === 'unknown_model');
    assert.equal(client.calls, 0);
  } finally {
    cleanup();
  }
});

test('after a call: its real cost is added, one log line with no prompt in it, and the warning once a month', async () => {
  const { cleanup } = home();
  try {
    const client = apiClient({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 });
    const ctx = ctxWith(client);
    const r = await askJson(ctx, req({ user: 'a secret prompt that must never reach a log' }));
    assert.equal(client.calls, 1);
    const want = claudeCost({ input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 }, 'claude-sonnet-5-5');
    assert.ok(Math.abs(r.usd - want) < 1e-12);
    const month = Object.values(readState(env()).months)[0];
    assert.ok(Math.abs(month.usd - want) < 1e-6 && month.calls === 1);
    const log = readFileSync(logPath(env()), 'utf8');
    assert.match(log, /"model":"claude-sonnet-5-5"/);
    assert.match(log, /"cacheRead":2000/);
    assert.doesNotMatch(log, /secret prompt|sk-ant/, 'never the prompt or a key');
    // The warning: the first call past $15 says so, the next one does not.
    const warned = [];
    const a = recordCall({ model: 'claude-sonnet-5-5', usd: 15, job: 'big', t: OCT, env: env(), log: (m) => warned.push(m) });
    const b = recordCall({ model: 'claude-sonnet-5-5', usd: 1, job: 'big', t: OCT, env: env(), log: (m) => warned.push(m) });
    assert.equal(a.warned, true);
    assert.equal(b.warned, false);
    assert.equal(warned.length, 1);
    assert.match(warned[0], /warning level/);
  } finally {
    cleanup();
  }
});

test('the spend file is written whole: no temporary file is left beside it', () => {
  const { cleanup } = home();
  try {
    for (let i = 0; i < 20; i++) recordCall({ model: 'claude-haiku-5-5', usd: 0.01, job: 'many', t: OCT, env: env() });
    const dir = path.dirname(statePath(env()));
    assert.deepEqual(readdirSync(dir).filter((f) => /anthropic-spend/.test(f)), ['anthropic-spend.json']);
    assert.ok(Math.abs(readState(env()).months['2026-10'].usd - 0.2) < 1e-9);
    assert.ok(statSync(statePath(env())).size > 0);
  } finally {
    cleanup();
  }
});

test('the Anthropic SDK is imported in one file only: every call goes through the one door', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f === 'node_modules' || f.startsWith('.')) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|cjs|ts)$/.test(f)) files.push(p);
    }
  };
  for (const d of ['src', 'scripts']) if (existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  const importing = files.filter((f) => /@anthropic-ai\/sdk/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
  assert.deepEqual(importing, ['src/llm/claude.js']);
});

test('the batch path answers to the cap: its client is the paid API, and a month never reads below the ledger', async () => {
  const { makeBatcher } = await import('../src/llm/batch.js');
  const { ledgerUsd, reconcileState } = await import('../src/budget/anthropic.js');
  const { cleanup } = home();
  try {
    const ctx = ctxWith(null);
    // The runner's daily drafts all go through the batcher: it must be checked and recorded like any API call.
    const batcher = makeBatcher(ctx, { api: { create: async () => ({}), retrieve: async () => ({}), results: async function* () {} } });
    assert.equal(batcher.backend, 'api');
    assert.equal(batcher.batch, true);
    // A batched answer is recorded in the spend file, at the batch rate.
    const usage = { input_tokens: 1_000_000, output_tokens: 0 };
    const llm = { ...apiClient(usage), batch: true, async json(r) { return { data: { ok: true }, usage, model: r.model, estimated: false, batch: true, settled: true }; } };
    await askJson({ ...ctxWith(llm) }, req());
    const s = spendStatus({ env: env() });
    assert.equal(s.calls, 1);
    assert.ok(Math.abs(s.usd - claudeCost(usage, 'claude-sonnet-5-5', { batch: true })) < 1e-6);
    // What the database settled without the file is raised into it; a file already above the ledger is left alone.
    const month = new Date().toISOString().slice(0, 7);
    const before = readState(env()).months[month].usd;
    assert.equal(reconcileState({ month, ledgerUsd: before - 0.5, env: env() }), null);
    assert.equal(readState(env()).months[month].usd, before);
    const r = reconcileState({ month, ledgerUsd: before + 2, env: env() });
    assert.deepEqual([r.from, r.to], [before, Math.round((before + 2) * 1e6) / 1e6]);
    assert.equal(readState(env()).months[month].usd, r.to);
    assert.equal(typeof ledgerUsd(ctx.db, month), 'number');
  } finally {
    cleanup();
  }
});
