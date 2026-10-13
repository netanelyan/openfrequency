import { now, nowIso } from '../core/clock.js';
import { audit, getSetting, setSetting, settings } from '../core/store.js';
import { j } from '../db/index.js';
import { israelDate, israelInstant, addDays, hhmm } from '../schedule/israel.js';
import { inRest } from '../schedule/shabbat.js';
import { inWindows, slotsFor } from '../schedule/slots.js';
import { buildPost, PausedError } from '../pipeline/build.js';
import { publishPost } from '../publish/index.js';
import { REWRITE_AT } from '../voice/review.js';
import { collectMetrics, learn } from '../metrics/collect.js';
import { canRun, liftBudgetPauses, pauseAccount } from './rails.js';
import { runTrends, youtubeConfigured } from '../trends/index.js';
import { perDayFor, planMonth, savePlan } from '../budget/plan.js';
import { makeBatcher, recoverBatches } from '../llm/batch.js';
import { wantedPublisher } from '../publish/index.js';
import { currentToken, igConfig, refreshToken } from '../publish/instagram.js';

// The engine running on its own: one tick a minute.
//
//   1. plan the month against the budget; lift a budget pause when the money is
//      there again (a new month, or room in the account's allocation)
//   2. generate, a day ahead: once a day, at settings.generateAt (Israel time),
//      each running account gets a post for each of tomorrow's slots (Shabbat,
//      the festivals and out-of-window slots are dropped by slotsFor and never
//      planned), plus any of today's slots that have none and are far enough
//      away. The planner may have cut the account to one post a day. With
//      Claude live, the whole day's posts are drafted together through the
//      Message Batches API at half price, in the background, while the ticks go
//      on publishing. Nothing is generated once the month's budget is spent.
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
//      Shabbat and the festivals
//   5. read metrics, credit them to formats at 72 hours, judge the formats
//   6. write yesterday's summary
//
// The rails (kill switches, pauses) are checked before every generation and
// every publish, and the reasons a post was blocked pause the account when they
// should (a failed fact check, an exhausted budget).

/** Batches draft in minutes to hours: today's empty slots are filled only when this far away. */
export const CATCH_UP_LEAD_MS = 3 * 3_600_000;

/** The slots to draft for one account at today's generation: tomorrow's, and today's that have no post yet. */
export function generationTargets(db, pack, { t = now(), lead = 0 } = {}) {
  const today = israelDate(t);
  const cut = perDayFor(db, pack.id, t);
  const sched = { ...pack.meta.schedule, ...(cut ? { postsPerDay: cut } : {}) };
  const cap = Number(sched.postsPerDay) || Infinity;
  const live = db.all("SELECT slot_at FROM posts WHERE account_id = ? AND slot_at IS NOT NULL AND status NOT IN ('blocked', 'drafting')", pack.id).map((r) => r.slot_at);
  const have = new Set(live);
  const onDay = (d) => live.filter((s) => israelDate(Date.parse(s)) === d).length;
  const out = [];
  for (const [day, notBefore] of [[today, t + lead], [addDays(today, 1), null]]) {
    const room = Math.max(0, cap - onDay(day));
    const free = slotsFor(day, sched, { notBefore }).slots.filter((s) => !have.has(s.toISOString()));
    out.push(...free.slice(0, room).map((s) => s.toISOString()));
  }
  return out;
}

/**
 * Draft posts for these slots: [{ pack, slotAt }]. Through a batch when Claude
 * is live, every post at once; otherwise one after another.
 */
export async function generate(ctx, plans, report) {
  const { db } = ctx;
  const useBatch = ctx.llm.kind === 'claude' && ctx.batchApi && process.env.OF_BATCH !== 'off';
  const stopped = new Set();
  const one = async (gctx, { pack, slotAt }) => {
    if (stopped.has(pack.id)) return;
    try {
      const res = await buildPost(gctx, { pack, slotAt });
      db.update('posts', res.postId, { mode_at_queue: db.get('SELECT mode FROM accounts WHERE id = ?', pack.id)?.mode });
      report.generated.push({ account: pack.id, post: res.postId, status: res.status, reason: res.reason, cost: res.cost });
      if (res.kind === 'fact_check') pauseAccount(db, pack.id, 'fact_check', res.reason);
      if (res.kind === 'budget') pauseAccount(db, pack.id, 'budget', res.reason);
      if (res.kind === 'fact_check' || res.kind === 'budget') stopped.add(pack.id);
    } catch (e) {
      if (e instanceof PausedError) stopped.add(pack.id);
      else report.errors.push({ account: pack.id, step: 'generate', error: e.message });
    }
  };
  if (!useBatch) {
    for (const p of plans) await one(ctx, p);
    return report;
  }
  const batcher = makeBatcher(ctx, { api: ctx.batchApi });
  ctx.batchesInFlight = batcher.owned;
  const bctx = { ...ctx, llm: batcher };
  await Promise.all(plans.map((p) => batcher.run(() => one(bctx, p))));
  return report;
}

export async function tick(ctx, { t = now() } = {}) {
  const { db } = ctx;
  const today = israelDate(t);
  const cfg = settings(db);
  const plan = planMonth(db, ctx.packs, { t });
  const report = { at: new Date(t).toISOString(), generated: [], published: [], expired: [], approved: [], errors: [], budget: plan.level, lifted: liftBudgetPauses(db, t, plan) };

  // ---- 0. a batch a restart left behind is recorded, so no paid call goes unbilled
  if (ctx.batchApi && db.get("SELECT id FROM batches WHERE status != 'recorded' LIMIT 1")) {
    const last = getSetting(db, 'batches:recovered');
    if (!last || t - Date.parse(last) > 10 * 60_000) {
      setSetting(db, 'batches:recovered', new Date(t).toISOString());
      report.recovered = await recoverBatches(ctx, { api: ctx.batchApi, skip: ctx.batchesInFlight || new Set() }).catch((e) => (report.errors.push({ step: 'batches', error: e.message }), []));
    }
  }

  // ---- 2. generate, a day ahead, once a day
  const plans = [];
  if (!ctx.generating && t >= israelInstant(today, cfg.generateAt).getTime()) {
    for (const pack of ctx.packs) {
      const acc = db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
      const genKey = `generated:${pack.id}:${today}`;
      if (!acc || acc.status === 'onboarding' || getSetting(db, genKey) || !canRun(db, pack.id).ok) continue;
      if (plan.level === 'stop') {
        report.budgetStop = true;
        continue;
      }
      if (!plans.length) savePlan(db, plan, { t });
      setSetting(db, genKey, nowIso());
      const lead = ctx.llm.kind === 'claude' && ctx.batchApi && process.env.OF_BATCH !== 'off' ? CATCH_UP_LEAD_MS : 0;
      for (const slotAt of generationTargets(db, pack, { t, lead })) plans.push({ pack, slotAt });
    }
  }
  if (plans.length) {
    const job = generate(ctx, plans, report);
    if (ctx.llm.kind === 'claude' && ctx.batchApi && process.env.OF_BATCH !== 'off') {
      // A batch takes minutes to hours: it runs beside the ticks, which go on publishing.
      ctx.generating = job
        .then((r) => ctx.log?.(`generated ${r.generated.length}: ${r.generated.map((g) => `${g.account} ${g.status}`).join(', ')}`))
        .catch((e) => ctx.log?.(`generation: ${e.stack || e.message}`))
        .finally(() => (ctx.generating = null));
      report.generating = plans.length;
    } else await job;
  }

  for (const pack of ctx.packs) {
    const acc = db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
    if (!acc || acc.status === 'onboarding') continue;
    const run = canRun(db, pack.id);

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
    if (!run.ok || inRest(t) || !inWindows(t, pack.meta.schedule?.windows)) continue;
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

  // ---- 5a. an Instagram Login token is refreshed before its 60 days run out (once a day it is asked)
  for (const pack of ctx.packs) {
    if (wantedPublisher(pack, 'instagram') !== 'instagram' || igConfig(pack).auth !== 'instagram' || !currentToken(db, pack)) continue;
    const key = `instagram:refreshed:${pack.id}`;
    const last = getSetting(db, key);
    if (last && t - Date.parse(last) < 86_400_000) continue;
    setSetting(db, key, new Date(t).toISOString());
    try {
      const r = await refreshToken(db, pack, { t });
      if (r.refreshed) audit(db, { action: 'instagram_token_refreshed', accountId: pack.id, detail: { daysLeft: Math.floor(r.daysLeft) } });
    } catch (e) {
      report.errors.push({ account: pack.id, step: 'instagram token', error: e.message });
    }
  }

  // ---- 5b. formats that work now, once a week per account, when YouTube is connected
  if (youtubeConfigured()) {
    for (const pack of ctx.packs) {
      const key = `trends:${pack.id}`;
      const last = getSetting(db, key);
      if (last && t - Date.parse(last) < 7 * 86_400_000) continue;
      setSetting(db, key, new Date(t).toISOString());
      try {
        report.trends = { ...(report.trends || {}), [pack.id]: await runTrends(ctx, pack, { t }) };
      } catch (e) {
        report.errors.push({ account: pack.id, step: 'trends', error: e.message });
      }
    }
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
  // A post still "drafting" when the process starts lost its builder in a restart.
  // Its batch, if it had one, is recorded by the first tick; the post itself is closed.
  const orphans = ctx.db.run("UPDATE posts SET status = 'blocked', reason = 'הכתיבה נקטעה באתחול של המערכת', updated_at = ? WHERE status = 'drafting'", nowIso()).changes;
  if (orphans) ctx.log?.(`runner: ${orphans} post(s) interrupted by a restart were closed`);
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
