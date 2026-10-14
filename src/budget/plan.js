import { DAY, monthKey, now } from '../core/clock.js';
import { getSetting, setSetting } from '../core/store.js';
import { addDays, israelDate } from '../schedule/israel.js';
import { slotsFor } from '../schedule/slots.js';
import { postScore } from '../formats/rotation.js';
import { ENGINE_RESERVE, globalCap, monthReserved, monthSpend } from './ledger.js';

// The month, planned against the cap: what was spent, what the rest of the
// month will cost at the planned volume, and how many posts the money left buys.
//
// CUT VOLUME, NEVER QUALITY. When the forecast is over the cap, the planner
// does not reach for a cheaper model or a shorter prompt: it posts less. The
// weakest account comes down half a post a day at a time (1.5 is three posts in
// two days) to one a day first, then the next weakest, until the forecast fits;
// if every account is at one a day and it still does not, the weakest goes on
// to a post every other day, then the next. The money a cut frees goes to the accounts that keep their
// volume. The website says which account was cut and why.
//
//   weakest   by its own results (each post's 72-hour score against the
//             median of its platform, over 30 days); with no results yet, by
//             how often the owner approved its posts; with neither, the one
//             whose posts cost the most
//   80%       of the cap spent: a warning on every page
//   100%      every call is refused (ledger.js) and the runner generates
//             nothing until the next month
//
// The plan is written once a day before generation, and the ledger reads each
// account's allocation from it as that account's cap for the month.

/**
 * What a post costs until an account has a history, replaced by each account's own measured cost once it has four
 * posts: the launch rounds' measured cost per post made, the attempts the checks stopped included, at the API's
 * batched and cached rates (docs/costs.md).
 */
export const DEFAULT_COST_PER_POST = 0.15;
/** The least a cut leaves an account: a post every other day. */
export const MIN_PER_DAY = 0.5;
export const WARN_AT = 0.8;

/** AI spend per produced post over the last 30 days: every call, including the ones that ended blocked. */
export function costPerPost(db, accountId, t = now()) {
  const since = new Date(t - 30 * DAY).toISOString();
  const spend = db.get("SELECT COALESCE(SUM(usd), 0) AS usd, MAX(estimated) AS est FROM spend WHERE account_id = ? AND api = 'claude' AND at >= ?", accountId, since);
  const made = db.get("SELECT COUNT(*) AS n FROM posts WHERE account_id = ? AND sample = 0 AND created_at >= ? AND status NOT IN ('blocked', 'drafting')", accountId, since).n;
  if (made < 4 || spend.est) return null;
  return spend.usd / made;
}

/** How strong an account is, for deciding who gets cut first: { score, basis }. Higher is stronger. */
export function strength(db, accountId, t = now()) {
  const since = new Date(t - 30 * DAY).toISOString();
  const latest = db.all(
    "SELECT p.account_id, m.* FROM metrics m JOIN posts p ON p.id = m.post_id WHERE p.published_at >= ? AND m.id IN (SELECT MAX(id) FROM metrics GROUP BY post_id, platform)",
    since
  );
  const scored = latest.map((m) => ({ ...m, score: postScore(m.platform, m) })).filter((m) => m.score != null);
  const median = {};
  for (const plat of ['tiktok', 'instagram']) {
    const xs = scored.filter((m) => m.platform === plat).map((m) => m.score).sort((a, b) => a - b);
    median[plat] = xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }
  const mine = scored.filter((m) => m.account_id === accountId && median[m.platform]).map((m) => m.score / median[m.platform]);
  if (mine.length >= 3) return { score: mine.reduce((a, b) => a + b, 0) / mine.length, basis: 'results' };
  const d = db.get(
    "SELECT SUM(CASE WHEN status IN ('approved','published','publishing') THEN 1 ELSE 0 END) AS yes, SUM(CASE WHEN status IN ('rejected','expired') THEN 1 ELSE 0 END) AS no FROM posts WHERE account_id = ? AND sample = 0 AND created_at >= ?",
    accountId,
    since
  );
  if ((d.yes || 0) + (d.no || 0) >= 4) return { score: (d.yes || 0) / ((d.yes || 0) + (d.no || 0)), basis: 'approval' };
  return { score: null, basis: 'none' };
}

const monthEnd = (day) => {
  let d = day;
  while (addDays(d, 1).slice(0, 7) === day.slice(0, 7)) d = addDays(d, 1);
  return d;
};

/**
 * Slots still to be generated this month at `perDay` posts a day. Posts are
 * drafted a day ahead, so a generation on day d is for the slots of d+1, and the
 * month's last generation is for the first day of the next one. Shabbat and the
 * festivals have no slots.
 */
export function remainingSlots(pack, { t = now(), perDay, generatedToday = false } = {}) {
  const today = israelDate(t);
  const last = monthEnd(today);
  let n = 0;
  for (let d = generatedToday ? addDays(today, 1) : today; d <= last; d = addDays(d, 1)) {
    n += slotsFor(addDays(d, 1), { ...pack.meta.schedule, postsPerDay: perDay }).slots.length;
  }
  return n;
}

const plannedPerDay = (pack) => Number(pack.meta.schedule?.postsPerDay) || Math.max(1, (pack.meta.schedule?.slots || []).length);

/**
 * The plan for the rest of this month. Pure apart from reading the database.
 * Returns { month, cap, spent, reserved, forecast, postsLeft, level, accounts: [...] }.
 */
export function planMonth(db, packs, { t = now(), env = process.env } = {}) {
  const month = monthKey(t);
  const today = israelDate(t);
  const cap = globalCap(db, env);
  const spent = monthSpend(db, undefined, t).usd;
  const reserved = monthReserved(db, undefined, t).usd;
  const weights = getSetting(db, 'budget:weights', {}) || {};
  const live = packs.filter((p) => db.get('SELECT status FROM accounts WHERE id = ?', p.id)?.status !== 'onboarding');

  const rows = live.map((pack) => {
    const cpp = costPerPost(db, pack.id, t);
    const st = strength(db, pack.id, t);
    return {
      id: pack.id,
      name: pack.meta.displayName,
      pack,
      weight: Number(weights[pack.id]) || 1,
      spent: monthSpend(db, pack.id, t).usd,
      reserved: monthReserved(db, pack.id, t).usd,
      costPerPost: cpp ?? DEFAULT_COST_PER_POST,
      measured: cpp != null,
      strength: st.score,
      basis: st.basis,
      planned: plannedPerDay(pack),
      perDay: plannedPerDay(pack),
      generatedToday: Boolean(getSetting(db, `generated:${pack.id}:${today}`)),
      cut: false,
    };
  });
  const forecastOf = (r) => r.spent + r.reserved + remainingSlots(r.pack, { t, perDay: r.perDay, generatedToday: r.generatedToday }) * r.costPerPost;
  const pool = cap * (1 - ENGINE_RESERVE);
  // Weakest first: lowest strength; unknown strength after known, the dearer post first.
  const order = rows.slice().sort((a, b) => {
    if (a.strength != null && b.strength != null) return a.strength - b.strength;
    if (a.strength != null) return -1;
    if (b.strength != null) return 1;
    return b.costPerPost - a.costPerPost;
  });
  const total = () => rows.reduce((s, r) => s + forecastOf(r), 0);
  const cutTo = (floor) => {
    for (const r of order) {
      while (total() > pool && r.perDay - 0.5 >= floor) {
        r.perDay -= 0.5;
        r.cut = true;
      }
    }
  };
  cutTo(1);
  cutTo(MIN_PER_DAY);
  const forecasts = rows.map(forecastOf);
  const sum = forecasts.reduce((a, b) => a + b, 0);
  const wsum = rows.reduce((s, r) => s + r.weight, 0) || 1;
  rows.forEach((r, i) => {
    r.forecast = forecasts[i];
    // What is left over goes out by weight, so a cheap month leaves room, never a wall.
    r.alloc = sum <= pool ? forecasts[i] + ((pool - sum) * r.weight) / wsum : Math.max(r.spent + r.reserved, (pool * r.weight) / wsum);
    r.remainingPosts = remainingSlots(r.pack, { t, perDay: r.perDay, generatedToday: r.generatedToday });
  });
  const avg = rows.length ? rows.reduce((s, r) => s + r.costPerPost, 0) / rows.length : DEFAULT_COST_PER_POST;
  const forecast = spent + reserved + rows.reduce((s, r) => s + r.remainingPosts * r.costPerPost, 0);
  const left = Math.max(0, cap - spent - reserved);
  const level = spent >= cap - 1e-9 || left < avg ? 'stop' : spent >= cap * WARN_AT ? 'warn' : sum > pool ? 'short' : 'ok';
  return {
    month,
    cap,
    spent,
    reserved,
    forecast,
    left,
    postsLeft: Math.floor(left / avg),
    costPerPost: avg,
    level,
    nextMonth: addDays(monthEnd(today), 1),
    accounts: rows.map(({ pack, ...r }) => r),
  };
}

/** Write the plan for the month: the ledger reads each account's allocation as its cap. */
export function savePlan(db, plan, { t = now() } = {}) {
  setSetting(db, `budget:alloc:${plan.month}`, Object.fromEntries(plan.accounts.map((a) => [a.id, Number(a.alloc.toFixed(4))])));
  setSetting(db, `budget:plan:${plan.month}`, { at: new Date(t).toISOString(), level: plan.level, cuts: plan.accounts.filter((a) => a.cut).map((a) => ({ id: a.id, perDay: a.perDay, planned: a.planned, basis: a.basis })) });
}

/** This month's cut for one account, as the runner applies it: posts per day, or null for the planned number. */
export function perDayFor(db, accountId, t = now()) {
  const p = getSetting(db, `budget:plan:${monthKey(t)}`, null);
  return p?.cuts?.find((c) => c.id === accountId)?.perDay ?? null;
}

