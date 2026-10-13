import { monthKey, now, nowIso } from '../core/clock.js';
import { settings } from '../core/store.js';

// HARD RULE 7: a monthly cost cap per account and a global one.
//
// Every paid call asks guard() first and calls record() after with what it
// actually cost. The guard refuses a call that would take either total past its
// cap: the cap is a stop, not a forecast. Generation that hits it stops, the
// account is paused with reason 'budget', and the website says so.
//
// Claude is priced from the usage block each response reports, at the published
// rates below. An unknown model is billed at the dearest rate, so a typo in a
// setting overstates the spend rather than hiding it.

// $ per 1M tokens: input, output, cache read. A cache write is 1.25x input.
export const MODEL_RATES = {
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-opus-5': { in: 5, out: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
};
export const WORST = Object.values(MODEL_RATES).reduce((a, b) => (b.in + b.out > a.in + a.out ? b : a));

/** Dollars for one Claude response's usage block. */
export function claudeCost(usage = {}, model) {
  const r = MODEL_RATES[model] || WORST;
  const fresh = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (fresh * r.in + write * r.in * 1.25 + read * r.cacheRead + out * r.out) / 1e6;
}

/** Metered APIs other than Claude, per call. */
export const API_PRICES = {
  brave: 5 / 1000,
  youtube: 0,
  pexels: 0,
  unsplash: 0,
  commons: 0,
  zernio: 0,
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

/** The caps that apply: the account's from its pack, the global one from settings. */
export function caps(db, pack) {
  return {
    account: Number(pack?.meta?.budget?.monthlyUsd) || 0,
    global: Number(settings(db).globalBudgetUsd) || 0,
  };
}

/**
 * Refuse a call that would cross a cap. `estimateUsd` is the most this call
 * should cost. Pass pack = null for engine-wide work (onboarding, trends), which
 * counts against the global cap only.
 */
export function guard(db, { pack = null, estimateUsd = 0, t = now() } = {}) {
  const c = caps(db, pack);
  const all = monthSpend(db, undefined, t);
  if (c.global > 0 && all.usd + estimateUsd > c.global) {
    throw new BudgetError(`the global monthly budget is used up ($${all.usd.toFixed(2)} of $${c.global})`, { scope: 'global', spent: all.usd, cap: c.global });
  }
  if (pack) {
    const mine = monthSpend(db, pack.id, t);
    if (c.account > 0 && mine.usd + estimateUsd > c.account) {
      throw new BudgetError(`${pack.id}: this month's budget is used up ($${mine.usd.toFixed(2)} of $${c.account})`, { scope: 'account', accountId: pack.id, spent: mine.usd, cap: c.account });
    }
  }
}

export function record(db, { accountId = null, postId = null, api, model = null, units = 1, usd, estimated = false, tag = null, t = now() }) {
  db.insert('spend', { account_id: accountId, post_id: postId, api, model, units, usd, estimated: estimated ? 1 : 0, tag, month: monthKey(t), at: nowIso() });
  return usd;
}

/** A post's own total, for the cost-per-post figure. */
export const postSpend = (db, postId) => db.get('SELECT COALESCE(SUM(usd), 0) AS usd, MAX(estimated) AS estimated FROM spend WHERE post_id = ?', postId);
