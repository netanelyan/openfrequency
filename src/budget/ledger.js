import { monthKey, now, nowIso } from '../core/clock.js';
import { getSetting, settings } from '../core/store.js';

// HARD RULE 7: a monthly cost cap, global and per account, that nothing can cross.
//
// THE GLOBAL CAP is OF_BUDGET_MONTHLY_USD in $OF_HOME/.env ($15 by default). It
// covers every metered service the engine calls (Claude, Brave, image APIs)
// and nothing else: Zernio is a subscription, billed per connected account, and
// is tracked outside it. The website can set a lower cap, never a higher one.
//
// EACH ACCOUNT HAS A SHARE of the global cap, by the weights in its pack.json
// (budget.share, 1 by default) after a small reserve for engine-wide work
// (onboarding a new account). The planner (plan.js) can move money between
// accounts when it cuts the weakest one's volume; its allocation, when there is
// one for this month, is the account's cap.
//
// HOW THE CAP HOLDS. Every paid call reserves its ceiling first: the most it can
// possibly cost, from the size of the prompt in bytes (no token is shorter than
// a byte) and max_tokens (no answer is longer), at the dearest rate the call can
// be billed at. The reservation is refused if what was spent plus what is
// already reserved plus this ceiling would cross either cap. When the answer
// comes back, the reservation is replaced by the real cost from the usage block
// the API returned. A call can cost less than its ceiling, never more, so the
// sum of real costs never crosses the cap, however many calls are in flight
// (a batch of the day's drafts is many reservations at once).
//
// Claude is priced from the usage block, at the published rates below. An
// unknown model is billed at the dearest rate, so a typo in a setting overstates
// the spend rather than hiding it.

/**
 * $ per 1M tokens (platform.claude.com/docs/en/about-claude/pricing, read
 * 2026-10-13): input, output, cache read, 5-minute and 1-hour cache writes.
 * Claude Haiku 5.5 has a second tier for prompts over 100,000 tokens.
 */
export const MODEL_RATES = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25, write5m: 12.5, write1h: 20 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, write5m: 2.5, write1h: 4 },
  'claude-sonnet-5': { in: 2, out: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, write5m: 0.125, write1h: 0.2, long: { over: 100_000, in: 0.5, out: 2.5, cacheRead: 0.05, write5m: 0.625, write1h: 1 } },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 },
};
export const WORST = Object.values(MODEL_RATES).reduce((a, b) => (b.in + b.out > a.in + a.out ? b : a));
/** The Message Batches API: half price on every token, cache reads and writes included. */
export const BATCH_FACTOR = 0.5;

const ratesFor = (model, promptTokens = 0) => {
  const r = MODEL_RATES[model] || WORST;
  return r.long && promptTokens > r.long.over ? r.long : r;
};

/** Dollars for one Claude response's usage block. */
export function claudeCost(usage = {}, model, { batch = false } = {}) {
  const fresh = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  const r = ratesFor(model, fresh + write + read);
  // The usage block splits cache writes by duration when it can; without the
  // split, a write is billed at the dearer 1-hour rate (overstating, never hiding).
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens;
  const w5m = usage.cache_creation?.ephemeral_5m_input_tokens;
  const writeUsd = w1h != null || w5m != null ? (w1h || 0) * r.write1h + (w5m || 0) * r.write5m : write * r.write1h;
  const usd = (fresh * r.in + writeUsd + read * r.cacheRead + out * r.out) / 1e6;
  return batch ? usd * BATCH_FACTOR : usd;
}

/**
 * The most one call can cost: every prompt token billed at the dearest input
 * rate (a 1-hour cache write), and max_tokens of output. promptTokens must be an
 * upper bound (bytes, plus framing). With a server-side fallback the call may be
 * re-run on another model, so it is priced at the dearest model there is.
 */
export function ceilingUsd({ model, promptTokens, maxTokens, batch = false, fallback = false }) {
  const r = fallback ? WORST : ratesFor(model, promptTokens);
  const worstIn = Math.max(r.in, r.write1h || r.in * 2);
  const usd = (promptTokens * worstIn + maxTokens * r.out) / 1e6;
  return batch && !fallback ? usd * BATCH_FACTOR : usd;
}

/** Metered APIs other than Claude, per call. Zernio is a per-account subscription, outside the cap. */
export const API_PRICES = {
  brave: 5 / 1000,
  youtube: 0,
  pexels: 0,
  unsplash: 0,
  commons: 0,
};

export class BudgetError extends Error {
  constructor(message, { scope, accountId = null, spent = 0, cap = 0 } = {}) {
    super(message);
    this.name = 'BudgetError';
    this.code = 'budget';
    this.scope = scope;
    this.accountId = accountId;
    this.spent = spent;
    this.cap = cap;
  }
}

/** This month's spend: one account's, or everything when accountId is undefined. */
export function monthSpend(db, accountId, t = now()) {
  const month = monthKey(t);
  const row =
    accountId === undefined
      ? db.get('SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS calls FROM spend WHERE month = ?', month)
      : db.get('SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS calls FROM spend WHERE month = ? AND account_id IS ?', month, accountId);
  return { usd: row.usd, calls: row.calls, month };
}

/** Money reserved by calls still in flight this month: one account's, or all. */
export function monthReserved(db, accountId, t = now()) {
  const month = monthKey(t);
  const row =
    accountId === undefined
      ? db.get('SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS n FROM reservations WHERE month = ?', month)
      : db.get('SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS n FROM reservations WHERE month = ? AND account_id IS ?', month, accountId);
  return { usd: row.usd, n: row.n };
}

export const DEFAULT_MONTHLY_USD = 15;
/** The share of the cap kept for engine-wide work (a new account's discovery and samples). */
export const ENGINE_RESERVE = 0.05;

/** The global cap: OF_BUDGET_MONTHLY_USD, or a lower one set on the website. */
export function globalCap(db, env = process.env) {
  const fromEnv = Number(env.OF_BUDGET_MONTHLY_USD);
  const hard = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MONTHLY_USD;
  const set = Number(settings(db).globalBudgetUsd);
  return set > 0 ? Math.min(hard, set) : hard;
}

/** Each account's weight, written by syncAccounts from pack.json (budget.share). */
const weights = (db) => getSetting(db, 'budget:weights', {}) || {};

/** An account's equal-by-weight share of the cap, before any planner allocation. */
export function baseShare(db, accountId, env = process.env) {
  const w = weights(db);
  const total = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
  const mine = Number(w[accountId]) || 0;
  if (!total || !mine) return globalCap(db, env) * (1 - ENGINE_RESERVE);
  return (globalCap(db, env) * (1 - ENGINE_RESERVE) * mine) / total;
}

/**
 * The caps that apply to a call: the global one, and the account's (the
 * planner's allocation for this month if there is one, else its share; never
 * above the pack's own budget.monthlyUsd when the pack sets one).
 */
export function caps(db, pack, { t = now(), env = process.env } = {}) {
  const global = globalCap(db, env);
  if (!pack) return { global, account: 0 };
  const alloc = getSetting(db, `budget:alloc:${monthKey(t)}`, null)?.[pack.id];
  let account = Number(alloc) > 0 ? Number(alloc) : baseShare(db, pack.id, env);
  const own = Number(pack.meta?.budget?.monthlyUsd);
  if (own > 0) account = Math.min(account, own);
  return { global, account: Math.min(account, global) };
}

/**
 * Refuse a call that would cross a cap. `estimateUsd` is the most this call can
 * cost. Pass pack = null for engine-wide work (onboarding), which counts
 * against the global cap only.
 */
export function guard(db, { pack = null, estimateUsd = 0, t = now(), env = process.env } = {}) {
  const c = caps(db, pack, { t, env });
  const all = monthSpend(db, undefined, t).usd + monthReserved(db, undefined, t).usd;
  if (all + estimateUsd > c.global + 1e-12) {
    throw new BudgetError(`the global monthly budget is used up ($${all.toFixed(2)} of $${c.global}${estimateUsd ? `, this call could cost up to $${estimateUsd.toFixed(3)}` : ''})`, { scope: 'global', spent: all, cap: c.global });
  }
  if (pack) {
    const mine = monthSpend(db, pack.id, t).usd + monthReserved(db, pack.id, t).usd;
    if (mine + estimateUsd > c.account + 1e-12) {
      throw new BudgetError(`${pack.id}: this month's share is used up ($${mine.toFixed(2)} of $${c.account.toFixed(2)}${estimateUsd ? `, this call could cost up to $${estimateUsd.toFixed(3)}` : ''})`, { scope: 'account', accountId: pack.id, spent: mine, cap: c.account });
    }
  }
}

/**
 * Hold `usd` against the caps until the call it is for is settled. The check and
 * the hold are one transaction, so two calls cannot both pass on the same
 * remaining money. Returns the reservation id.
 */
export function reserve(db, { pack = null, postId = null, usd, tag = null, t = now(), env = process.env }) {
  return db.tx(() => {
    guard(db, { pack, estimateUsd: usd, t, env });
    return db.insert('reservations', { account_id: pack?.id ?? null, post_id: postId, usd, tag, month: monthKey(t), at: nowIso() });
  });
}

/** Drop a reservation (the call was never made, or was not billed). */
export function release(db, reservationId) {
  if (reservationId != null) db.run('DELETE FROM reservations WHERE id = ?', reservationId);
}

/** Replace a reservation by what the call really cost, in one transaction. */
export function settle(db, reservationId, row) {
  return db.tx(() => {
    release(db, reservationId);
    return record(db, row);
  });
}

export function record(db, { accountId = null, postId = null, api, model = null, units = 1, usd, estimated = false, tag = null, t = now(), batch = false, usage = null }) {
  db.insert('spend', { account_id: accountId, post_id: postId, api, model, units, usd, estimated: estimated ? 1 : 0, tag, month: monthKey(t), at: nowIso(), batch: batch ? 1 : 0, usage_json: usage });
  return usd;
}

/** A post's own total, for the cost-per-post figure. */
export const postSpend = (db, postId) => db.get('SELECT COALESCE(SUM(usd), 0) AS usd, MAX(estimated) AS estimated FROM spend WHERE post_id = ?', postId);
