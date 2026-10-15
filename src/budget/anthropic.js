import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';
import { now } from '../core/clock.js';
import { ofHome } from '../core/paths.js';
import { BudgetError } from './ledger.js';
import { isPriced } from './pricing.js';

// The Anthropic API's monthly spend, kept in its own small file beside the
// engine's database: $OF_HOME/data/anthropic-spend.json, by UTC month ("2026-10").
//
// It is the safety net under the ledger (ledger.js). The ledger reserves each
// call's ceiling against the caps in the database; this file is written after
// every real API call and read before every one, so a database that is lost,
// replaced or rebuilt cannot start the month again from $0. Every API call goes
// through askJson (llm/index.js), and only claude.js imports the SDK (a test
// holds that), so this is the one door.
//
//   before a call   the model must be in the pricing table, the file must be
//                   readable, and this month's spend, what calls in flight hold,
//                   and this call's ceiling must fit under the cap. Otherwise a
//                   BudgetExceededError, which the runner treats like any budget
//                   stop: that job is skipped and logged, the engine goes on
//   after a call    its real cost from the usage block is added (written whole to
//                   a temporary file, flushed, renamed over the old one), one line
//                   goes to $OF_HOME/logs/anthropic-calls.jsonl (time, model,
//                   tokens, cost, job: never the prompt, the answer or the key),
//                   and the first call of a month past the warning level says so
//   missing file    every API call is blocked and the reason logged: never a
//                   silent $0. `npm run budget -- init` creates it once, from what
//                   the ledger has recorded for the month
//
// Limits: ANTHROPIC_MONTHLY_BUDGET_USD ($20) and ANTHROPIC_BUDGET_WARN_USD ($15)
// in $OF_HOME/.env.

export const DEFAULT_CAP_USD = 20;
export const DEFAULT_WARN_USD = 15;

export class BudgetExceededError extends BudgetError {
  constructor(message, { reason, spent = 0, cap = 0 } = {}) {
    super(message, { scope: 'anthropic', spent, cap });
    this.name = 'BudgetExceededError';
    this.reason = reason;
  }
}

/** The calendar month, in UTC, that a moment's spend counts against. */
export const utcMonth = (t = now()) => new Date(t).toISOString().slice(0, 7);
export const statePath = (env = process.env) => path.join(ofHome(env), 'data', 'anthropic-spend.json');
export const logPath = (env = process.env) => path.join(ofHome(env), 'logs', 'anthropic-calls.jsonl');

/** The cap and the warning level, in dollars. The warning is never above the cap. */
export function limits(env = process.env) {
  const n = (v, d) => {
    const x = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(x) && x > 0 ? x : d;
  };
  const cap = n(env.ANTHROPIC_MONTHLY_BUDGET_USD || env.OF_BUDGET_MONTHLY_USD, DEFAULT_CAP_USD);
  return { cap, warn: Math.min(cap, n(env.ANTHROPIC_BUDGET_WARN_USD, DEFAULT_WARN_USD)) };
}

const loud = (msg) => console.error(`[budget] ${msg}`);

/** The spend file, or a refusal: missing or unreadable blocks every call, it never reads as $0. */
export function readState(env = process.env) {
  const file = statePath(env);
  if (!existsSync(file)) {
    throw new BudgetExceededError(`the Anthropic spend file is missing (${file}): every API call is blocked until it is restored, or created with \`npm run budget -- init\``, { reason: 'state_missing' });
  }
  let state;
  try {
    state = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new BudgetExceededError(`the Anthropic spend file is unreadable (${file}): every API call is blocked until it is fixed`, { reason: 'state_corrupt' });
  }
  const months = state?.months;
  const ok = state?.version === 1 && months && typeof months === 'object' && Object.values(months).every((m) => Number.isFinite(m?.usd) && m.usd >= 0);
  if (!ok) throw new BudgetExceededError(`the Anthropic spend file is not in its expected shape (${file}): every API call is blocked until it is fixed`, { reason: 'state_corrupt' });
  return state;
}

/** Written whole to a temporary file, flushed to disk, then renamed over the old one: a crash leaves one or the other. */
export function writeState(state, env = process.env) {
  const file = statePath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

/** One writer at a time across processes (the runner and the website): a lock file, taken over when stale. */
function withFileLock(file, fn) {
  const lock = `${file}.lock`;
  const until = Date.now() + 5000;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) {
          rmSync(lock, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > until) throw new BudgetExceededError('the Anthropic spend file is held by another process', { reason: 'state_locked' });
      Atomics.wait(nap, 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * Create the spend file when there is none, starting each month at no less than
 * the ledger has recorded for it (seedUsd: { "2026-10": 1.23 }). An existing file
 * is never touched.
 */
export function initState({ seedUsd = {}, env = process.env } = {}) {
  const file = statePath(env);
  if (existsSync(file)) return { created: false, file };
  const months = Object.fromEntries(Object.entries(seedUsd).map(([m, usd]) => [m, { usd: Math.max(0, Number(usd) || 0), calls: 0, warned: false }]));
  writeState({ version: 1, months }, env);
  return { created: true, file };
}

/**
 * Before an API call. inFlightUsd: what calls already in flight hold (the
 * ledger's reservations). Throws BudgetExceededError, or returns the month.
 */
export function checkCall({ model, ceilingUsd, inFlightUsd = 0, t = now(), env = process.env }) {
  if (!isPriced(model)) {
    throw new BudgetExceededError(`unknown model "${model}": it is not in the pricing table (src/budget/pricing.js), so its cost cannot be bounded; refused`, { reason: 'unknown_model' });
  }
  let state;
  try {
    state = readState(env);
  } catch (e) {
    loud(e.message);
    throw e;
  }
  const { cap } = limits(env);
  const month = utcMonth(t);
  const spent = state.months[month]?.usd || 0;
  if (spent + inFlightUsd + ceilingUsd > cap + 1e-9) {
    throw new BudgetExceededError(
      `the Anthropic API's monthly cap: $${spent.toFixed(4)} spent and $${inFlightUsd.toFixed(4)} held in ${month}, and this call could cost up to $${ceilingUsd.toFixed(4)}, over $${cap}`,
      { reason: 'cap', spent, cap }
    );
  }
  return { month, spent, cap };
}

/**
 * After an API call: its real cost added to the month, one line in the call log,
 * and the warning, once a month, when the spend first reaches the warning level.
 * usage: the response's usage block (token counts only are logged).
 */
export function recordCall({ model, usage = null, usd, job = null, batch = false, t = now(), env = process.env, log = null }) {
  const file = statePath(env);
  return withFileLock(file, () => {
    const state = readState(env);
    const m = utcMonth(t);
    const month = (state.months[m] ??= { usd: 0, calls: 0, warned: false });
    month.usd = Math.round((month.usd + Math.max(0, Number(usd) || 0)) * 1e6) / 1e6;
    month.calls = (month.calls || 0) + 1;
    const { cap, warn } = limits(env);
    const crossed = !month.warned && month.usd >= warn;
    if (crossed) month.warned = true;
    writeState(state, env);
    mkdirSync(path.dirname(logPath(env)), { recursive: true });
    appendFileSync(
      logPath(env),
      `${JSON.stringify({
        at: new Date(t).toISOString(),
        month: m,
        model,
        job,
        batch: Boolean(batch),
        input: usage?.input_tokens ?? null,
        output: usage?.output_tokens ?? null,
        cacheWrite: usage?.cache_creation_input_tokens ?? null,
        cacheRead: usage?.cache_read_input_tokens ?? null,
        usd: Math.round((Number(usd) || 0) * 1e6) / 1e6,
      })}\n`
    );
    if (crossed) {
      const msg = `Anthropic spend in ${m} is $${month.usd.toFixed(2)}, past the $${warn} warning level (the cap is $${cap})`;
      loud(msg);
      log?.(msg);
    }
    return { month: m, usd: month.usd, calls: month.calls, warned: crossed };
  });
}

/** This month's spend from the file, with the limits: what `npm run budget` prints. Throws when the file cannot be read. */
export function spendStatus({ t = now(), env = process.env } = {}) {
  const state = readState(env);
  const month = utcMonth(t);
  const m = state.months[month] || { usd: 0, calls: 0, warned: false };
  return { month, usd: m.usd, calls: m.calls || 0, warned: Boolean(m.warned), ...limits(env) };
}
