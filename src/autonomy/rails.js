import { nowIso, monthKey } from '../core/clock.js';
import { audit, settings } from '../core/store.js';
import { customerCap, monthReserved, monthSpend } from '../budget/ledger.js';
import { notify } from '../notify/index.js';

// The safety rails, in every mode:
//   - a kill switch per account and a global one
//   - auto-pause on a failed fact check, a platform strike, a streak of publish
//     errors, an exhausted budget, or the customer's own monthly cap
// A paused account says why, on the website, and stays paused until the owner
// resumes it, except a budget pause, which lifts itself when the month turns,
// and a customer-cap pause, which lifts when the month turns or the operator
// raises the cap.

export const PAUSE_REASONS = {
  kill: 'מתג הכיבוי הופעל',
  manual: 'הושהה ידנית',
  fact_check: 'בדיקת עובדות נכשלה',
  strike: 'הפלטפורמה דחתה פוסט כהפרת מדיניות',
  publish_errors: 'רצף שגיאות פרסום',
  budget: 'התקציב החודשי נגמר',
  customer_cap: 'הגיע לתקרת העלות החודשית שלו',
  takedowns: 'הודעות הסרה חוזרות',
};

export function pauseAccount(db, accountId, reason, detail = null, actor = 'engine') {
  const acc = db.get('SELECT status, paused_reason FROM accounts WHERE id = ?', accountId);
  if (!acc) return;
  // A kill switch outranks any automatic reason; never overwrite it.
  if (acc.status === 'paused' && acc.paused_reason === 'kill' && reason !== 'kill') return;
  db.update('accounts', accountId, { status: 'paused', paused_reason: reason, paused_detail: detail ? String(detail).slice(0, 500) : null, paused_at: nowIso(), updated_at: nowIso() });
  audit(db, { actor, action: 'pause', accountId, detail: { reason, detail } });
}

export function resumeAccount(db, accountId, actor = 'engine') {
  db.update('accounts', accountId, { status: 'active', paused_reason: null, paused_detail: null, paused_at: null, updated_at: nowIso() });
  audit(db, { actor, action: 'resume', accountId });
}

/** Can this account publish or generate right now? { ok, why } */
export function canRun(db, accountId) {
  if (settings(db).globalKill) return { ok: false, why: 'מתג הכיבוי הכללי מופעל' };
  const acc = db.get('SELECT status, paused_reason FROM accounts WHERE id = ?', accountId);
  if (!acc) return { ok: false, why: 'אין חשבון כזה' };
  if (acc.status !== 'active') return { ok: false, why: PAUSE_REASONS[acc.paused_reason] || acc.status };
  return { ok: true, why: null };
}

/** Consecutive failed publishes, newest first, until the last success. */
export function publishErrorStreak(db, accountId) {
  const rows = db.all("SELECT status FROM posts WHERE account_id = ? AND status IN ('published','failed') ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 20", accountId);
  let n = 0;
  for (const r of rows) {
    if (r.status !== 'failed') break;
    n++;
  }
  return n;
}

/**
 * The customer's monthly cap was hit: the account stops generating and the operator is told, once. Its notification
 * is the operator's alone (no account on the row, so no customer browser is woken by it). Returns whether it paused.
 */
export async function capPause(ctx, pack, detail = null) {
  const { db } = ctx;
  const acc = db.get('SELECT status, paused_reason FROM accounts WHERE id = ?', pack.id);
  if (!acc || (acc.status === 'paused' && ['customer_cap', 'kill'].includes(acc.paused_reason))) return false;
  const spent = monthSpend(db, pack.id).usd + monthReserved(db, pack.id).usd;
  const cap = customerCap(db, pack.id);
  pauseAccount(db, pack.id, 'customer_cap', detail || `$${spent.toFixed(2)} of $${cap.toFixed(2)} this month`);
  await notify(ctx, {
    kind: 'customer_cap',
    title: `${pack.meta.displayName} הגיע לתקרה החודשית`,
    body: `הוצאו $${spent.toFixed(2)} מתוך $${cap.toFixed(2)} החודש, אז הכתיבה בחשבון נעצרה. היא תחזור בתחילת החודש הבא, או כשמעלים את התקרה בהגדרות.`,
    url: '/settings#quotas',
  }).catch((e) => ctx.log?.(`notify: ${e.message}`));
  return true;
}

/** After the operator changed an account's cap: a cap pause lifts at once when there is money under the new one. */
export function liftCapPause(db, accountId, actor = 'engine') {
  const acc = db.get('SELECT status, paused_reason FROM accounts WHERE id = ?', accountId);
  if (acc?.status !== 'paused' || acc.paused_reason !== 'customer_cap') return false;
  if (monthSpend(db, accountId).usd + monthReserved(db, accountId).usd >= customerCap(db, accountId) - 1e-9) return false;
  resumeAccount(db, accountId, actor);
  return true;
}

/**
 * A budget pause lifts itself in a new month, or sooner when the month's plan
 * gave the account room again (a cut elsewhere freed money): at least three
 * posts' worth left in its allocation, and the global budget not stopped.
 */
export function liftBudgetPauses(db, t = Date.now(), plan = null) {
  const lifted = [];
  // The customer's cap is the month's: a new month lifts it. Within the month only a higher cap does (liftCapPause),
  // or an account a cent under its cap would be lifted, refused and paused again every day, telling the operator each time.
  for (const a of db.all("SELECT id, paused_at FROM accounts WHERE status = 'paused' AND paused_reason = 'customer_cap'")) {
    if (monthKey(Date.parse(a.paused_at)) !== monthKey(t)) {
      resumeAccount(db, a.id);
      lifted.push(a.id);
    }
  }
  for (const a of db.all("SELECT id, paused_at FROM accounts WHERE status = 'paused' AND paused_reason = 'budget'")) {
    const row = plan?.level !== 'stop' ? plan?.accounts?.find((x) => x.id === a.id) : null;
    const room = row ? row.alloc - row.spent - row.reserved >= 3 * row.costPerPost : false;
    if (monthKey(Date.parse(a.paused_at)) !== monthKey(t) || room) {
      resumeAccount(db, a.id);
      lifted.push(a.id);
    }
  }
  return lifted;
}
