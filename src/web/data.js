import { latestFeedback } from '../metrics/feedback.js';
import { DAY, monthKey, now } from '../core/clock.js';
import { waitingImages } from '../images/index.js';
import { KEYS, isSet } from '../core/env.js';
import { settings } from '../core/store.js';
import { j } from '../db/index.js';
import { DEFAULT_MONTHLY_USD, monthSpend } from '../budget/ledger.js';
import { planMonth, WARN_AT } from '../budget/plan.js';
import { loadPost } from '../pipeline/build.js';
import { israelDate, israelInstant, addDays } from '../schedule/israel.js';
import { groupsOf, hookStats, mixOf, relative, postScore } from '../formats/rotation.js';
import { hookPatterns, kindOf } from '../formats/kinds.js';
import { takedowns } from '../publish/takedown.js';
import { engineMode } from '../engine.js';
import { publisherFor, tiktokMode, wantedPublisher } from '../publish/index.js';
import { zernioConfigured } from '../publish/zernio.js';
import { igConfig, instagramConfigured } from '../publish/instagram.js';
import { getSetting } from '../core/store.js';
import { resolveFormat } from '../trends/index.js';
import { factProblems, factState, readTopics } from '../sources/facts.js';
import { rivalsOf, timesBeside } from '../pipeline/rivals.js';
import { SOUNDS, soundsOf, recentSoundIds } from '../pipeline/sounds.js';
import { vapid } from '../notify/index.js';
import path from 'node:path';

// What each page shows, as plain queries. Pages never touch the database
// themselves, so what a page can see is listed here.

/** The month's budget plan, computed at most every few seconds (a page asks for it more than once). */
const planOf = (ctx) => {
  if (!ctx._plan || Date.now() - ctx._plan.at > 5000) ctx._plan = { at: Date.now(), plan: planMonth(ctx.db, ctx.packs) };
  return ctx._plan.plan;
};

export function header(ctx) {
  const s = settings(ctx.db);
  const plan = planOf(ctx);
  const waiting = ctx.db.get("SELECT COUNT(*) AS n FROM posts WHERE status = 'queued' AND sample = 0").n;
  return {
    spend: { usd: plan.spent, cap: plan.cap },
    budget: { level: plan.level, share: plan.cap ? plan.spent / plan.cap : 0, warnAt: plan.warnAt ?? WARN_AT, forecast: plan.forecast, cap: plan.cap, nextMonth: plan.nextMonth, cuts: plan.accounts.filter((a) => a.cut).map((a) => ({ id: a.id, name: a.name, perDay: a.perDay, planned: a.planned })) },
    waiting,
    globalKill: s.globalKill,
  };
}

export function accountRows(ctx) {
  const plan = planOf(ctx);
  return ctx.packs.map((pack) => {
    const acc = ctx.db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
    const spend = monthSpend(ctx.db, pack.id);
    const p = plan.accounts.find((a) => a.id === pack.id) || null;
    const cap = p ? p.alloc : 0;
    return { pack, acc, spend: spend.usd, cap, plan: p, reached: p ? spend.usd >= cap - 1e-9 : false, publishers: publishersOf(ctx, pack) };
  });
}

/** Each platform's publisher: what the pack asks for, and what it really goes through now. */
export function publishersOf(ctx, pack) {
  return pack.meta.platforms.map((platform) => ({ platform, wants: wantedPublisher(pack, platform), via: publisherFor(pack, platform, { db: ctx.db }) }));
}

/** Today: what waits for a decision, what is scheduled, what was refused and what went out. */
export function today(ctx, t = now()) {
  const day = israelDate(t);
  const from = israelInstant(day, '00:00').toISOString();
  const groups = accountRows(ctx).filter((row) => row.acc?.status !== 'onboarding').map((row) => {
    const id = row.pack.id;
    const ids = (sql, ...a) => ctx.db.all(sql, ...a).map((r) => loadPost(ctx.db, r.id));
    return {
      ...row,
      waiting: ids("SELECT id FROM posts WHERE account_id = ? AND status = 'queued' AND sample = 0 ORDER BY slot_at IS NULL, slot_at, created_at", id),
      scheduled: ids("SELECT id FROM posts WHERE account_id = ? AND status = 'approved' ORDER BY slot_at", id),
      blocked: ctx.db.all("SELECT id, hook, topic, reason, format_id, created_at FROM posts WHERE account_id = ? AND status = 'blocked' AND created_at >= ? ORDER BY created_at DESC", id, from),
      published: ctx.db.all("SELECT id, hook, published_at, publish_json FROM posts WHERE account_id = ? AND status = 'published' AND published_at >= ? ORDER BY published_at DESC", id, from),
      // TikTok drafts of the last day and a half, each with where it stands (src/publish/draft.js); a duplicate stays
      // on the page until it is a day old.
      drafts: ctx.db
        .all("SELECT id, hook, slot_at, published_at, publish_json FROM posts WHERE account_id = ? AND publish_json LIKE '%\"flow\"%' AND published_at >= ? ORDER BY published_at DESC", id, new Date(t - 36 * 3_600_000).toISOString())
        .map((p) => ({ id: p.id, hook: p.hook, slotAt: p.slot_at || p.published_at, flow: j(p.publish_json, {}).tiktok?.flow || {} })),
    };
  });
  const summary = ctx.db.get('SELECT * FROM summaries WHERE account_id IS NULL ORDER BY day DESC LIMIT 1');
  const live = new Set(groups.map((g) => g.pack.id));
  const summaryRows = summary
    ? ctx.db
        .all('SELECT account_id, data_json FROM summaries WHERE day = ? AND account_id IS NOT NULL', summary.day)
        .filter((r) => live.has(r.account_id))
        .map((r) => ({ account_id: r.account_id, data: j(r.data_json, {}) }))
    : [];
  return { day, groups, summary, summaryRows, attention: attention(ctx) };
}

/** The last 7 Israel days for one account: posts published per day, and reach where it is known. */
export function week(ctx, accountId, t = now()) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(israelDate(t), -i);
    const from = israelInstant(d, '00:00').toISOString();
    const to = israelInstant(addDays(d, 1), '00:00').toISOString();
    const n = ctx.db.get("SELECT COUNT(*) AS n FROM posts WHERE account_id = ? AND status = 'published' AND published_at >= ? AND published_at < ?", accountId, from, to).n;
    days.push({ day: d, n, at: from });
  }
  const since = new Date(t - 7 * DAY).toISOString();
  const views = ctx.db.get(
    "SELECT SUM(m.views) AS v FROM metrics m JOIN posts p ON p.id = m.post_id WHERE p.account_id = ? AND p.published_at >= ? AND m.id IN (SELECT MAX(id) FROM metrics GROUP BY post_id, platform)",
    accountId,
    since
  ).v;
  const counts = Object.fromEntries(ctx.db.all("SELECT status, COUNT(*) AS n FROM posts WHERE account_id = ? AND created_at >= ? AND sample = 0 GROUP BY status", accountId, since).map((r) => [r.status, r.n]));
  return { days, views, counts };
}

/** Results: per post (newest reading per platform) and per format, with what is being dropped. */
export function results(ctx, t = now()) {
  const since = new Date(t - 30 * DAY).toISOString();
  const posts = ctx.db
    .all("SELECT p.id, p.account_id, p.hook, p.format_id, p.published_at FROM posts p WHERE p.status = 'published' AND p.published_at >= ? ORDER BY p.published_at DESC", since)
    .map((p) => {
      const m = ctx.db.all('SELECT * FROM metrics WHERE post_id = ? AND id IN (SELECT MAX(id) FROM metrics WHERE post_id = ? GROUP BY platform)', p.id, p.id);
      const per = Object.fromEntries(m.map((r) => [r.platform, { ...r, score: postScore(r.platform, r), demo: j(r.raw_json, {})?.source === 'demo-seed' }]));
      return { ...p, metrics: per };
    });
  const demo = posts.some((p) => Object.values(p.metrics).some((m) => m.demo));
  const medians = {};
  for (const plat of ['tiktok', 'instagram']) {
    const xs = posts.map((p) => p.metrics[plat]?.score).filter((x) => x != null).sort((a, b) => a - b);
    medians[plat] = xs.length ? xs[Math.floor(xs.length / 2)] : null;
  }
  const rel = (p) => {
    const r = ['tiktok', 'instagram'].map((pl) => (p.metrics[pl]?.score != null && medians[pl] ? p.metrics[pl].score / medians[pl] : null)).filter((x) => x != null);
    return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
  };
  const scored = posts.map((p) => ({ ...p, rel: rel(p) })).filter((p) => p.rel != null);
  // A post is a winner at or above the median and a loser under it, never both.
  const winners = scored.filter((p) => p.rel >= 1).sort((a, b) => b.rel - a.rel).slice(0, 5);
  const losers = scored.filter((p) => p.rel < 1).sort((a, b) => a.rel - b.rel).slice(0, 5);
  const formats = ctx.packs.map((pack) => {
    const rows = ctx.db.all('SELECT * FROM formats WHERE account_id = ? ORDER BY status, kind DESC, format_key', pack.id).map((f) => ({ ...f, results: j(f.results_json, []) }));
    const r = relative(rows, { t });
    return {
      pack,
      rows: rows.map((f) => {
        const mine = (r[f.format_key] || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const avg = mine.length ? mine.reduce((s, x) => s + x.rel, 0) / mine.length : null;
        const last = mine.slice(-3);
        const atRisk = f.status === 'active' && last.length >= 2 && last.slice(-2).every((x) => x.rel < 0.7);
        const def = resolveFormat(ctx.db, pack, f.format_key);
        return { ...f, name: def?.name || f.format_key, avg, last, atRisk, n: mine.length };
      }),
    };
  });
  const trends = ctx.db.all('SELECT * FROM trend_formats ORDER BY found_at DESC LIMIT 30').map((x) => ({ ...x, card: j(x.card_json, null) }));
  // The mix of entertaining and number posts, and the cover patterns, per account, in words.
  const learning = ctx.packs.map((pack) => {
    const share = mixOf(ctx.db, pack);
    const learned = getSetting(ctx.db, `mix:${pack.id}`, null);
    const stats = hookStats(ctx.db, pack.id, { t });
    const hooks = (pack.formats.formats || []).flatMap((f) =>
      hookPatterns(f).map((h) => ({ format: f.name, kind: kindOf(f).name, id: h.id, pattern: h.pattern, n: stats[f.id]?.[h.id]?.n || 0, avg: stats[f.id]?.[h.id]?.avg ?? null, used: ctx.db.get("SELECT COUNT(*) AS n FROM posts WHERE account_id = ? AND format_id = ? AND hook_pattern = ? AND status NOT IN ('blocked')", pack.id, f.id, h.id).n }))
    );
    const groups = groupsOf(pack);
    const recent = ctx.db.all("SELECT format_id, grp FROM posts WHERE account_id = ? AND status IN ('published', 'approved', 'queued') ORDER BY created_at DESC LIMIT 30", pack.id);
    const ent = recent.filter((p) => (p.grp || groups[p.format_id]) === 'entertaining').length;
    return { pack, share, learned, hooks, recent: recent.length, recentEnt: ent };
  });
  // The morning's feedback: each account's latest report and what became of its plans.
  const feedback = latestFeedback(ctx.db, ctx.packs);
  return { posts, scored, winners, losers, formats, medians, demo, trends, learning, feedback, blocks: blockRates(ctx, t) };
}

/**
 * Which checks stop posts: of the posts drafted in the last 30 days, how many each check blocked, and how many
 * first drafts failed it (the repair and the redraft mend most of those). A block with no checks recorded (one
 * before they were, or one that is not a check's: no source, no photograph, the reviewer) counts under its kind.
 */
export function blockRates(ctx, t = now()) {
  const since = new Date(t - 30 * DAY).toISOString();
  const posts = ctx.db.all("SELECT id, account_id, status FROM posts WHERE created_at >= ? AND sample = 0 AND status NOT IN ('drafting')", since);
  const rows = new Map();
  const row = (check) => rows.get(check) || rows.set(check, { check, blocked: 0, firstFail: 0 }).get(check);
  let blocked = 0;
  for (const p of posts) {
    const steps = ctx.db.all("SELECT step, detail_json FROM steps WHERE post_id = ? AND step IN ('slides', 'blocked') ORDER BY id", p.id).map((x) => ({ step: x.step, d: j(x.detail_json, {}) }));
    const first = steps.find((x) => x.step === 'slides');
    for (const c of first?.d.checks || []) row(c).firstFail++;
    const b = p.status === 'blocked' ? steps.filter((x) => x.step === 'blocked').pop() : null;
    if (!b) continue;
    blocked++;
    for (const c of b.d.checks?.length ? b.d.checks : [`kind:${b.d.kind || 'other'}`]) row(c).blocked++;
  }
  const list = [...rows.values()].sort((a, b) => b.blocked - a.blocked || b.firstFail - a.firstFail);
  return { total: posts.length, blocked, rows: list };
}

/** A pack's hand-checked facts, each with its state today and anything wrong with it. */
export function factsFor(ctx, pack) {
  return readTopics(path.join(pack.dir, 'facts')).map((t) => ({
    ...t,
    facts: t.facts.map((f) => ({ ...f, state: factState(f), problems: factProblems(f, { maxQuoteWords: pack.rules.maxQuoteWords || 40 }) })),
  }));
}

/** An account's sound list, how its TikTok posts go out, and which sounds its last drafts had. */
export function soundsFor(ctx, pack) {
  return { current: pack, sounds: soundsOf(ctx.db, pack.id), mode: tiktokMode(pack), recent: recentSoundIds(ctx.db, pack.id), limits: SOUNDS };
}

/** An account's rivals, and their posting hours beside the account's own slots. */
export function rivalsFor(ctx, pack) {
  const rivals = rivalsOf(ctx.db, pack.id);
  return { current: pack, rivals, times: timesBeside(rivals, pack.meta.schedule?.slots || []) };
}

export function sourcesFor(ctx, accountId) {
  return ctx.db.all("SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS docs FROM sources s WHERE s.account_id = ? ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.name", accountId).map((s) => ({ ...s, score: j(s.score_json, null), config: j(s.config_json, {}) }));
}

export function settingsData(ctx) {
  const s = settings(ctx.db);
  const envCap = Number(process.env.OF_BUDGET_MONTHLY_USD) > 0 ? Number(process.env.OF_BUDGET_MONTHLY_USD) : DEFAULT_MONTHLY_USD;
  return {
    settings: s,
    spend: monthSpend(ctx.db, undefined),
    month: monthKey(),
    plan: planOf(ctx),
    envCap,
    perAccount: accountRows(ctx),
    keys: KEYS.map((k2) => ({ ...k2, set: isSet(k2.name) })),
    mode: engineMode(),
    publishers: ctx.packs.map((p) => ({ id: p.id, name: p.meta.displayName, platforms: publishersOf(ctx, p) })),
    // What is known about each pack's Instagram token without asking Meta: the check script asks.
    instagram: ctx.packs
      .filter((p) => p.meta.platforms.includes('instagram') && wantedPublisher(p, 'instagram') === 'instagram')
      .map((p) => {
        const cfg = igConfig(p);
        const saved = getSetting(ctx.db, `instagram:token:${p.id}`, null);
        return { id: p.id, name: p.meta.displayName, auth: cfg.auth, tokenEnv: cfg.tokenEnv, userId: cfg.userId, configured: instagramConfigured(ctx.db, p), daysLeft: saved?.expiresAt ? Math.floor((saved.expiresAt - now()) / DAY) : null };
      }),
    zernio: zernioConfigured(),
    liveSwitch: process.env.PUBLISH_MODE === 'live',
    users: ctx.db.all('SELECT id, name, role, created_at, last_login_at FROM users ORDER BY id'),
    push: { key: vapid(ctx.db).publicKey, browsers: ctx.db.get('SELECT COUNT(*) AS n FROM push_subs WHERE failed < 5').n },
    audit: ctx.db.all('SELECT * FROM audit ORDER BY id DESC LIMIT 40').map((a) => ({ ...a, detail: j(a.detail_json, null) })),
  };
}

export const postFull = (ctx, id) => {
  const post = loadPost(ctx.db, id);
  if (!post) return null;
  return {
    post,
    pack: ctx.pack(post.account_id),
    steps: ctx.db.all('SELECT * FROM steps WHERE post_id = ? ORDER BY id', id).map((s) => ({ ...s, detail: j(s.detail_json, null) })),
    spend: ctx.db.all('SELECT api, model, usd, estimated, tag FROM spend WHERE post_id = ? ORDER BY id', id),
    // The photograph the page asks a person about: the first still waiting, else the lead one.
    image: waitingImages(ctx.db, post)[0] || (post.checks?.image ? ctx.db.get('SELECT * FROM images WHERE id = ?', post.checks.image) : null),
    metrics: ctx.db.all('SELECT * FROM metrics WHERE post_id = ? ORDER BY collected_at DESC', id),
    takedowns: takedowns(ctx.db, { limit: 200 }).filter((x) => x.post_id === id),
  };
};

/**
 * What waits for a person outside the queue: posts to delete by hand after a
 * takedown notice, and photographs the image screen could not clear.
 */
export function attention(ctx) {
  const waitingDeletes = takedowns(ctx.db, { limit: 200 }).filter((x) => x.waiting.length);
  const images = ctx.db
    .all("SELECT DISTINCT p.id, p.hook, p.account_id, i.id AS image_id, i.safety_json FROM posts p JOIN images i ON i.id = json_extract(p.checks_json, '$.image') OR i.id IN (SELECT image_id FROM slides WHERE post_id = p.id) WHERE p.status IN ('queued', 'approved') AND i.safety IS NOT NULL AND i.safety != 'ok' AND i.reviewed_at IS NULL GROUP BY p.id")
    .map((r) => ({ ...r, screen: j(r.safety_json, null) }));
  return { waitingDeletes, images };
}
