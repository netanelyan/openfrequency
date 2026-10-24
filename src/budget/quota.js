import { HOUR, monthKey, now, nowIso } from '../core/clock.js';
import { customerCap, DEFAULT_CUSTOMER_CAP_USD, monthReserved, monthSpend } from './ledger.js';

// A customer's month: how many slideshows it is suggested, how many rejected ones are written again, and what it
// costs us. Every count is read from the posts themselves, never kept beside them, so nothing can drift.
//
//   suggestion   a post that passed every check and reached the customer for approval. It counts in the month it
//                reached them, whatever they did with it after: approved, rejected or left to expire
//   redo         a post written again because the customer rejected one, with their reason. It counts as a redo,
//                never as a suggestion; when the redos are used up a rejection only discards the post
//   retry        a post our checks blocked, and every repair call inside a post: our cost, never counted
//
// A post still being drafted holds its place (for a day at most: a batch takes hours, a draft that never finished
// was lost to a restart), so a batch of the day's posts cannot together go past the quota. When the suggestions are
// used up, nothing more is generated for the account until the next month (runner.js, buildPost).
//
// The money is the ledger's (ledger.js): the customer's cap is one more cap every paid call is refused against.

export const DEFAULT_PLAN = { suggested: 40, redos: 10 };
/** How long a draft in progress holds a place in the quota. */
export const HOLD_MS = 24 * HOUR;
/** The most the operator may set, so a typo cannot open an account to thousands of posts. */
export const MAX_PLAN = { suggested: 1000, redos: 1000, capUsd: 500 };

/** The reasons a customer rejects a post for, in the order the form lists them. */
export const REDO_REASONS = ['topic', 'shorter', 'tone', 'photo', 'other'];
/** Each reason as the rejection form offers it. */
export const REJECT_REASON_HE = { topic: 'הנושא לא מתאים', shorter: 'ארוך מדי', tone: 'הטון לא נכון', photo: 'התמונות לא מתאימות', other: 'משהו אחר' };
/** What the replacement is, said after "במקום הפוסט ההוא". */
export const REDO_REASON_HE = { topic: 'עם נושא אחר', shorter: 'בגרסה קצרה יותר', tone: 'בטון אחר', photo: 'עם תמונות אחרות', other: 'עם השינוי שביקשתם' };

/** An account's plan: { suggested, redos, capUsd }, each the operator's number or the default, and which ones are set. */
export function planOf(db, accountId) {
  const row = db.get('SELECT plan_suggested, plan_redos, cap_usd FROM accounts WHERE id = ?', accountId) || {};
  const int = (v, d) => (v == null ? d : Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : 0);
  return {
    suggested: int(row.plan_suggested, DEFAULT_PLAN.suggested),
    redos: int(row.plan_redos, DEFAULT_PLAN.redos),
    capUsd: customerCap(db, accountId),
    set: { suggested: row.plan_suggested != null, redos: row.plan_redos != null, capUsd: row.cap_usd != null },
  };
}

/**
 * The operator sets an account's plan. Each value is a whole number (dollars may have cents) from 0 to MAX_PLAN, or
 * '' / null for the default. Returns { problems } when a value is not one, else the plan as saved.
 */
export function setPlan(db, accountId, { suggested, redos, capUsd }) {
  const problems = [];
  const read = (v, key, { cents = false } = {}) => {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_PLAN[key] || (!cents && !Number.isInteger(n))) {
      problems.push(key);
      return undefined;
    }
    return cents ? Math.round(n * 100) / 100 : n;
  };
  const patch = { plan_suggested: read(suggested, 'suggested'), plan_redos: read(redos, 'redos'), cap_usd: read(capUsd, 'capUsd', { cents: true }) };
  if (problems.length) return { problems };
  db.update('accounts', accountId, { ...patch, updated_at: nowIso() });
  return planOf(db, accountId);
}

/**
 * Where an account stands this month: suggestions and redos used, held by drafts in progress, and left; and its cost
 * against the customer's cap. `used + held` is what a new draft is weighed against.
 */
export function usage(db, accountId, t = now()) {
  const month = monthKey(t);
  const plan = planOf(db, accountId);
  const used = Object.fromEntries(
    db.all("SELECT quota_kind, COUNT(*) AS n FROM posts WHERE account_id = ? AND quota_month = ? AND quota_kind IN ('suggestion', 'redo') GROUP BY quota_kind", accountId, month).map((r) => [r.quota_kind, r.n])
  );
  const since = new Date(t - HOLD_MS).toISOString();
  const held = Object.fromEntries(
    db.all("SELECT CASE WHEN redo_of IS NULL THEN 'suggestion' ELSE 'redo' END AS k, COUNT(*) AS n FROM posts WHERE account_id = ? AND status = 'drafting' AND sample = 0 AND created_at >= ? GROUP BY k", accountId, since).map((r) => [r.k, r.n])
  );
  const part = (k, limit) => {
    const u = used[k] || 0;
    const h = held[k] || 0;
    return { used: u, held: h, limit, left: Math.max(0, limit - u - h) };
  };
  const spent = monthSpend(db, accountId, t).usd;
  const reserved = monthReserved(db, accountId, t).usd;
  return {
    month,
    suggested: part('suggestion', plan.suggested),
    redos: part('redo', plan.redos),
    cost: { spent, reserved, cap: plan.capUsd, left: Math.max(0, plan.capUsd - spent - reserved), reached: spent + reserved >= plan.capUsd - 1e-9 },
    plan,
  };
}

/** May a new draft start? { ok, why, usage }. A redo is weighed against the redos, anything else against the suggestions. */
export function room(db, accountId, { redo = false, t = now() } = {}) {
  const u = usage(db, accountId, t);
  const part = redo ? u.redos : u.suggested;
  if (part.left > 0) return { ok: true, why: null, usage: u };
  const what = redo ? 'redos' : 'suggested slideshows';
  return { ok: false, why: `${accountId}: this month's ${what} are used up (${part.used}${part.held ? ` and ${part.held} in progress` : ''} of ${part.limit})`, usage: u };
}

/** The Israel month a post that reached the customer now is counted in. */
export const quotaMonth = (t = now()) => monthKey(t);

/**
 * What one account really cost in a month, by what each dollar was for:
 *   suggestion, redo, retry   the posts of each kind, and every call made for them (a suggestion's own repair rounds
 *                             included: they are inside the post)
 *   edit                      the fact check of a customer's light edit
 *   account                   the account's work that is no one post's (the morning's feedback, scoring topics)
 *   drafting, sample          a post still being written; an onboarding sample
 * Counts are of posts by the month they reached the customer (or were blocked); dollars are by the month they were
 * spent. `perDelivered` is every dollar over the suggestions and redos that reached the customer.
 */
export function ledger(db, accountId, month = monthKey()) {
  const rows = db.all(
    `SELECT CASE WHEN s.tag = 'edit-check' THEN 'edit' WHEN s.post_id IS NULL THEN 'account'
       ELSE COALESCE(p.quota_kind, CASE WHEN p.sample = 1 THEN 'sample' ELSE 'drafting' END) END AS bucket,
       COALESCE(SUM(s.usd), 0) AS usd, COUNT(*) AS calls, MAX(s.estimated) AS estimated
     FROM spend s LEFT JOIN posts p ON p.id = s.post_id WHERE s.account_id = ? AND s.month = ? GROUP BY bucket`,
    accountId,
    month
  );
  const posts = Object.fromEntries(db.all('SELECT quota_kind, COUNT(*) AS n FROM posts WHERE account_id = ? AND quota_month = ? AND quota_kind IS NOT NULL GROUP BY quota_kind', accountId, month).map((r) => [r.quota_kind, r.n]));
  // Named bucket, not kind: posts has a kind of its own (the format's), and GROUP BY kind would group by that.
  const by = Object.fromEntries(rows.map((r) => [r.bucket, { usd: r.usd, calls: r.calls, estimated: Boolean(r.estimated) }]));
  const kinds = ['suggestion', 'redo', 'retry', 'edit', 'account', 'drafting', 'sample'];
  const out = kinds.map((kind) => ({ kind, posts: posts[kind] ?? null, usd: by[kind]?.usd || 0, calls: by[kind]?.calls || 0, estimated: by[kind]?.estimated || false }));
  const total = out.reduce((s, r) => s + r.usd, 0);
  const delivered = (posts.suggestion || 0) + (posts.redo || 0);
  return { accountId, month, rows: out, total, delivered, perDelivered: delivered ? total / delivered : null, estimated: out.some((r) => r.estimated) };
}

/** The last `n` Israel months, newest first: for the ledger's table. */
export function lastMonths(n = 3, t = now()) {
  const out = [];
  let [y, m] = monthKey(t).split('-').map(Number);
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (!m) [y, m] = [y - 1, 12];
  }
  return out;
}

export { DEFAULT_CUSTOMER_CAP_USD };
