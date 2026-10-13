import { now, nowIso } from '../core/clock.js';
import { audit, getSetting, setSetting, settings } from '../core/store.js';
import { j } from '../db/index.js';
import { israelDate, israelInstant, addDays, hhmm } from '../schedule/israel.js';
import { inShabbat } from '../schedule/shabbat.js';
import { inWindows, slotsFor } from '../schedule/slots.js';
import { buildPost, PausedError } from '../pipeline/build.js';
import { publishPost } from '../publish/index.js';
import { REWRITE_AT } from '../voice/review.js';
import { collectMetrics, learn } from '../metrics/collect.js';
import { canRun, liftBudgetPauses, pauseAccount } from './rails.js';

// The engine running on its own: one tick a minute.
//
//   1. lift budget pauses in a new month
//   2. generate: once a day, at settings.generateAt (Israel time), each running
//      account gets a post for each of today's slots (Shabbat and out-of-window
//      slots are dropped by slotsFor and never planned)
//   3. modes, at each post's slot:
//        approve  the post waits for the owner; unapproved by the end of its
//                 day, it expires
//        digest   it is approved by the engine at its slot unless the owner
//                 rejected it before then
//        auto     it is approved by the engine and goes out; a daily summary
//                 says what happened
//      In digest and auto, a post the reviewer scored as sounding a little like
//      a bot (4 or 5) waits for the owner instead.
//   4. publish what is approved and due, inside the account's windows, outside
//      Shabbat
//   5. read metrics, credit them to formats at 72 hours, judge the formats
//   6. write yesterday's summary
//
// The rails (kill switches, pauses) are checked before every generation and
// every publish, and the reasons a post was blocked pause the account when they
// should (a failed fact check, an exhausted budget).

export async function tick(ctx, { t = now() } = {}) {
  const { db } = ctx;
  const report = { at: new Date(t).toISOString(), generated: [], published: [], expired: [], approved: [], errors: [], lifted: liftBudgetPauses(db, t) };
  const today = israelDate(t);
  const cfg = settings(db);

  for (const pack of ctx.packs) {
    const acc = db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
    if (!acc || acc.status === 'onboarding') continue;
    const run = canRun(db, pack.id);

    // ---- 2. generate today's posts, once
    const genKey = `generated:${pack.id}:${today}`;
    if (run.ok && !getSetting(db, genKey) && t >= israelInstant(today, cfg.generateAt).getTime()) {
      setSetting(db, genKey, nowIso());
      const { slots } = slotsFor(today, pack.meta.schedule, { notBefore: t });
      const have = new Set(db.all("SELECT slot_at FROM posts WHERE account_id = ? AND slot_at IS NOT NULL AND status NOT IN ('blocked')", pack.id).map((r) => r.slot_at));
      for (const slot of slots) {
        if (have.has(slot.toISOString())) continue;
        try {
          const res = await buildPost(ctx, { pack, slotAt: slot.toISOString() });
          db.update('posts', res.postId, { mode_at_queue: acc.mode });
          report.generated.push({ account: pack.id, post: res.postId, status: res.status, reason: res.reason });
          if (res.kind === 'fact_check') pauseAccount(db, pack.id, 'fact_check', res.reason);
          if (res.kind === 'budget') pauseAccount(db, pack.id, 'budget', res.reason);
          if (res.kind === 'fact_check' || res.kind === 'budget') break;
        } catch (e) {
          if (e instanceof PausedError) break;
          report.errors.push({ account: pack.id, step: 'generate', error: e.message });
        }
      }
    }

    // ---- 3. modes at the slot
    const due = db.all("SELECT * FROM posts WHERE account_id = ? AND status = 'queued' AND slot_at IS NOT NULL AND slot_at <= ?", pack.id, new Date(t).toISOString());
    for (const p of due) {
      if (acc.mode === 'approve' || (p.review_score ?? 0) >= REWRITE_AT) {
        if (israelDate(Date.parse(p.slot_at)) < today) {
          db.update('posts', p.id, { status: 'expired', reason: acc.mode === 'approve' ? 'לא אושר עד סוף היום' : 'נשמע קצת כמו בוט וחיכה לאישור', updated_at: nowIso() });
          report.expired.push(p.id);
        }
        continue;
      }
      db.update('posts', p.id, { status: 'approved', approved_at: nowIso(), approved_by: `engine:${acc.mode}`, updated_at: nowIso() });
      audit(db, { action: 'auto_approved', accountId: pack.id, postId: p.id, detail: { mode: acc.mode } });
      report.approved.push(p.id);
    }

    // ---- 4. publish what is approved and due
    if (!run.ok || inShabbat(t) || !inWindows(t, pack.meta.schedule?.windows)) continue;
    const ready = db.all("SELECT id FROM posts WHERE account_id = ? AND status = 'approved' AND (slot_at IS NULL OR slot_at <= ?) ORDER BY slot_at", pack.id, new Date(t).toISOString());
    for (const p of ready.slice(0, 1)) {
      try {
        const r = await publishPost(ctx, p.id, { t });
        report.published.push({ account: pack.id, post: p.id, ok: r.ok, via: r.via });
      } catch (e) {
        report.errors.push({ account: pack.id, post: p.id, step: 'publish', error: e.message });
      }
    }
  }

  // ---- 5. metrics and learning, every few hours
  const lastM = getSetting(db, 'metrics:last');
  if (!lastM || t - Date.parse(lastM) > 6 * 3_600_000) {
    setSetting(db, 'metrics:last', new Date(t).toISOString());
    report.metrics = await collectMetrics(ctx, { t });
    report.formats = learn(ctx, { t });
  }

  // ---- 6. yesterday's summary
  const yesterday = addDays(today, -1);
  if (!db.get('SELECT id FROM summaries WHERE day = ? AND account_id IS NULL', yesterday) && t >= israelInstant(today, cfg.generateAt).getTime()) {
    writeSummaries(ctx, yesterday);
  }
  return report;
}

/** One summary per account and one overall, for a past Israel date. */
export function writeSummaries(ctx, day) {
  const { db } = ctx;
  const from = israelInstant(day, '00:00').toISOString();
  const to = israelInstant(addDays(day, 1), '00:00').toISOString();
  const lines = [];
  for (const pack of ctx.packs) {
    const pub = db.all("SELECT id, hook, publish_json FROM posts WHERE account_id = ? AND status = 'published' AND published_at >= ? AND published_at < ?", pack.id, from, to);
    const blocked = db.all("SELECT reason FROM posts WHERE account_id = ? AND status = 'blocked' AND created_at >= ? AND created_at < ?", pack.id, from, to);
    const spend = db.get('SELECT COALESCE(SUM(usd),0) AS usd FROM spend WHERE account_id = ? AND at >= ? AND at < ?', pack.id, from, to).usd;
    const text = `${pack.meta.displayName}: ${pub.length} פורסמו, ${blocked.length} נחסמו, $${spend.toFixed(2)}`;
    db.run('INSERT OR REPLACE INTO summaries (day, account_id, text, data_json, at) VALUES (?, ?, ?, ?, ?)', day, pack.id, text, JSON.stringify({ published: pub.map((p) => ({ id: p.id, hook: p.hook, via: Object.values(j(p.publish_json, {}))[0]?.via })), blocked: blocked.map((b) => b.reason), spend }), nowIso());
    lines.push(text);
  }
  db.run('INSERT OR REPLACE INTO summaries (day, account_id, text, data_json, at) VALUES (?, NULL, ?, NULL, ?)', day, lines.join('\n') || 'אין חשבונות פעילים', nowIso());
}

/** Run tick() every minute until stopped. One at a time: a slow tick delays the next, never overlaps it. */
export function startRunner(ctx, { everyMs = 60_000 } = {}) {
  let busy = false;
  let stopped = false;
  const go = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const r = await tick(ctx);
      const n = r.generated.length + r.published.length + r.expired.length + r.approved.length + r.errors.length;
      if (n) ctx.log?.(`runner ${hhmm(Date.parse(r.at))}: ${r.generated.length} generated, ${r.approved.length} auto-approved, ${r.published.length} published, ${r.expired.length} expired${r.errors.length ? `, errors: ${r.errors.map((e) => e.error).join('; ')}` : ''}`);
    } catch (e) {
      ctx.log?.(`runner: ${e.stack || e.message}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(go, everyMs);
  go();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
