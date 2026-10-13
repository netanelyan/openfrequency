import { DAY, monthKey, now } from '../core/clock.js';
import { KEYS, isSet } from '../core/env.js';
import { settings } from '../core/store.js';
import { j } from '../db/index.js';
import { monthSpend } from '../budget/ledger.js';
import { loadPost } from '../pipeline/build.js';
import { israelDate, israelInstant, addDays } from '../schedule/israel.js';
import { relative, postScore } from '../formats/rotation.js';
import { engineMode } from '../engine.js';
import { publisherFor } from '../publish/index.js';
import { zernioConfigured } from '../publish/zernio.js';

// What each page shows, as plain queries. Pages never touch the database
// themselves, so what a page can see is listed here.

export function header(ctx) {
  const s = settings(ctx.db);
  const spend = monthSpend(ctx.db, undefined);
  const waiting = ctx.db.get("SELECT COUNT(*) AS n FROM posts WHERE status = 'queued' AND sample = 0").n;
  return { spend: { usd: spend.usd, cap: s.globalBudgetUsd }, waiting, globalKill: s.globalKill };
}

export function accountRows(ctx) {
  return ctx.packs.map((pack) => {
    const acc = ctx.db.get('SELECT * FROM accounts WHERE id = ?', pack.id);
    const spend = monthSpend(ctx.db, pack.id);
    return { pack, acc, spend: spend.usd, cap: Number(pack.meta.budget?.monthlyUsd) || 0, reached: spend.usd >= (Number(pack.meta.budget?.monthlyUsd) || Infinity) };
  });
}

/** Today: what waits for a decision, what is scheduled, what was refused and what went out. */
export function today(ctx, t = now()) {
  const day = israelDate(t);
  const from = israelInstant(day, '00:00').toISOString();
  const groups = accountRows(ctx).map((row) => {
    const id = row.pack.id;
    const ids = (sql, ...a) => ctx.db.all(sql, ...a).map((r) => loadPost(ctx.db, r.id));
    return {
      ...row,
      waiting: ids("SELECT id FROM posts WHERE account_id = ? AND status = 'queued' AND sample = 0 ORDER BY slot_at IS NULL, slot_at, created_at", id),
      scheduled: ids("SELECT id FROM posts WHERE account_id = ? AND status = 'approved' ORDER BY slot_at", id),
      blocked: ctx.db.all("SELECT id, hook, topic, reason, format_id, created_at FROM posts WHERE account_id = ? AND status = 'blocked' AND created_at >= ? ORDER BY created_at DESC", id, from),
      published: ctx.db.all("SELECT id, hook, published_at, publish_json FROM posts WHERE account_id = ? AND status = 'published' AND published_at >= ? ORDER BY published_at DESC", id, from),
    };
  });
  const summary = ctx.db.get('SELECT * FROM summaries WHERE account_id IS NULL ORDER BY day DESC LIMIT 1');
  return { day, groups, summary };
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
        const def = pack.formats.formats.find((x) => x.id === f.format_key);
        return { ...f, name: def?.name || f.format_key, avg, last, atRisk, n: mine.length };
      }),
    };
  });
  return { posts, scored, winners, losers, formats, medians, demo };
}

export function sourcesFor(ctx, accountId) {
  return ctx.db.all("SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS docs FROM sources s WHERE s.account_id = ? ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, s.name", accountId).map((s) => ({ ...s, score: j(s.score_json, null), config: j(s.config_json, {}) }));
}

export function settingsData(ctx) {
  const s = settings(ctx.db);
  return {
    settings: s,
    spend: monthSpend(ctx.db, undefined),
    month: monthKey(),
    perAccount: accountRows(ctx),
    keys: KEYS.map((k2) => ({ ...k2, set: isSet(k2.name) })),
    mode: engineMode(),
    publishers: ctx.packs.map((p) => ({ id: p.id, name: p.meta.displayName, via: publisherFor(p), wants: p.meta.publisher })),
    zernio: zernioConfigured(),
    liveSwitch: process.env.PUBLISH_MODE === 'live',
    users: ctx.db.all('SELECT id, name, role, created_at, last_login_at FROM users ORDER BY id'),
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
    image: post.checks?.image ? ctx.db.get('SELECT * FROM images WHERE id = ?', post.checks.image) : null,
    metrics: ctx.db.all('SELECT * FROM metrics WHERE post_id = ? ORDER BY collected_at DESC', id),
  };
};
