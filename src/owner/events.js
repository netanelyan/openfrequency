import { randomBytes } from 'node:crypto';
import { HOUR, now } from '../core/clock.js';
import { localFetch } from '../core/net.js';
import { j } from '../db/index.js';
import { loadPost } from '../pipeline/build.js';
import { addDays, israelDate, israelInstant, wallClock } from '../schedule/israel.js';
import { forWorkspace, workspaceOfAccount } from '../web/workspace.js';
import { assistantSecret, sign } from './sign.js';
import { inList, listed, quotaOf } from './view.js';

// What Teder tells the owner line (docs/internal-assistant.md): openfrequency-toran writes it to the owner on
// WhatsApp, inside their quiet time's rules. Five events:
//
//   post.ready       a run queued posts for approval: one event per workspace, the posts of that run
//   post.reminder    an approved post's slot came, and its TikTok part is a draft the owner posts themselves
//   post.unposted    the slot passed and a platform's part did not go out (a failed publish, a fallback that failed,
//                    a reminder too late to send)
//   quota.low        the month's suggestions reached 80% of the plan, or two redos are left: once a month per kind
//   weekly.summary   Sunday 09:00 Israel time, the seven days before
//
// THE OUTBOX. An event is a row in owner_events, written where it happens, inside the run that makes it, and nothing
// else: emitting never waits for the network and never throws into the run. The sender (startEvents) posts each one
// to TORAN_INTERNAL/internal/teder/events, signed (src/owner/sign.js), beside the runner; anything but a 2xx is
// tried again after 1, 5, 15 and 60 minutes, then hourly, until a day has passed since the event, and then dropped.
// Toran answers 200 to an event it already has, so a send whose answer was lost is safe to repeat.
//
// Only an account in a workspace has an owner to tell, and nothing is written while OF_ASSISTANT_SECRET is unset or
// short: the line is off, and a backlog would arrive stale the day it is turned on.

export const TYPES = ['post.ready', 'post.reminder', 'post.unposted', 'quota.low', 'weekly.summary'];
/** Minutes before each try again; after the last, hourly. */
export const BACKOFF_MIN = [1, 5, 15, 60];
/** An event older than this is not sent. */
export const KEEP_MS = 24 * HOUR;
export const WEEKLY_AT = '09:00';

let kick = null;

/**
 * Write one event to the outbox, for a workspace. `once` makes it the only event of its key (a reminder per post, a
 * quota warning per month): a second is not written. Returns the event's id, or null when none was written.
 */
export function emit(ctx, { type, workspaceId, data, once = null, t = now(), env = process.env }) {
  try {
    if (!assistantSecret(env) || workspaceId == null) return null;
    if (!TYPES.includes(type)) throw new Error(`unknown event ${type}`);
    const id = `evt_${Math.floor(t / 1000).toString(36)}${randomBytes(8).toString('hex')}`;
    const at = new Date(t).toISOString();
    const r = ctx.db.run('INSERT OR IGNORE INTO owner_events (id, type, workspace_id, once_key, data_json, at, next_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, type, workspaceId, once, JSON.stringify(data), at, at);
    if (!r.changes) return null;
    kick?.();
    return id;
  } catch (e) {
    ctx.log?.(`owner line: ${type}: ${e.message}`);
    return null;
  }
}

/** A post as the events carry it, seen from its workspace. */
const postFor = (ctx, postId, opts) => {
  const post = loadPost(ctx.db, postId);
  const ws = post ? workspaceOfAccount(ctx.db, post.account_id) : null;
  if (ws == null) return null;
  return { ws, view: listed(forWorkspace(ctx.global || ctx, ws), post, opts) };
};

/** post.ready: the posts a run queued, one event per workspace. `posts` are ids. */
export function postsReady(ctx, postIds, { t = now(), env = process.env } = {}) {
  const by = new Map();
  for (const id of postIds) {
    const p = postFor(ctx, id, { env, t });
    if (!p || p.view.status !== 'queued') continue;
    if (!by.has(p.ws)) by.set(p.ws, []);
    by.get(p.ws).push(p.view);
  }
  return [...by].map(([workspaceId, posts]) => emit(ctx, { type: 'post.ready', workspaceId, data: { posts }, t, env })).filter(Boolean);
}

/** post.reminder and post.unposted: one post, one platform, once each. */
export function postEvent(ctx, type, postId, platform, { t = now(), env = process.env } = {}) {
  try {
    const p = postFor(ctx, postId, { env, t });
    if (!p) return null;
    return emit(ctx, { type, workspaceId: p.ws, data: { post: p.view, platform }, once: `${type}:${postId}:${platform}`, t, env });
  } catch (e) {
    ctx.log?.(`owner line: ${type} ${postId}: ${e.message}`);
    return null;
  }
}

/** The workspaces that have a Teder account here. */
export const workspaces = (ctx) => {
  const loaded = new Set((ctx.global || ctx).packs.map((p) => p.id));
  return [...new Set(ctx.db.all('SELECT id, workspace_id FROM accounts WHERE workspace_id IS NOT NULL').filter((r) => loaded.has(r.id)).map((r) => r.workspace_id))];
};

/** Two redos left, or 80% of the suggestions used. */
const isLow = (kind, { used, limit }) => limit > 0 && (kind === 'redos' ? limit - used <= 2 : used >= 0.8 * limit);

/** quota.low for one workspace's quota ({ month, suggested, redos }, src/owner/view.js quotaOf): once a month per kind. */
export function quotaLow(ctx, workspaceId, quota, { t = now(), env = process.env } = {}) {
  if (!quota) return [];
  return ['suggested', 'redos']
    .filter((kind) => quota[kind] && isLow(kind, quota[kind]))
    .map((kind) => emit(ctx, { type: 'quota.low', workspaceId, data: { kind, used: quota[kind].used, limit: quota[kind].limit, month: quota.month }, once: `quota.low:${workspaceId}:${quota.month}:${kind}`, t, env }))
    .filter(Boolean);
}

/** The seven days before Sunday `day` (an Israel date), for one workspace: what weekly.summary carries. */
export function weekSummary(ctx, workspaceId, day, { t = now() } = {}) {
  const w = forWorkspace(ctx.global || ctx, workspaceId);
  const ids = w.packs.map((p) => p.id);
  const from = addDays(day, -7);
  const to = addDays(day, -1);
  const a = israelInstant(from, '00:00').toISOString();
  const b = israelInstant(day, '00:00').toISOString();
  const n = (sql, ...params) => ctx.db.get(sql, ...ids, ...params).n;
  const posts = `SELECT COUNT(*) AS n FROM posts WHERE account_id IN (${inList(ids)}) AND sample = 0`;
  return {
    from,
    to,
    // Every post that reached the owner's queue (or went past it on its own): not one our checks stopped.
    made: n(`${posts} AND created_at >= ? AND created_at < ? AND status NOT IN ('drafting', 'blocked')`, a, b),
    approved: n(`${posts} AND approved_at >= ? AND approved_at < ?`, a, b),
    rejected: n(`SELECT COUNT(DISTINCT post_id) AS n FROM audit WHERE account_id IN (${inList(ids)}) AND action = 'reject' AND at >= ? AND at < ?`, a, b),
    published: n(`${posts} AND published_at >= ? AND published_at < ?`, a, b),
    expired: n(`${posts} AND status = 'expired' AND updated_at >= ? AND updated_at < ?`, a, b),
    pending: n(`${posts} AND status = 'queued'`),
    quota: quotaOf(w, t),
  };
}

/**
 * The runner's pass, once a tick: the weekly summary from Sunday WEEKLY_AT, and the quota check. Each is written once
 * (the outbox's once key), so a tick that comes again changes nothing.
 */
export function ownerTick(ctx, { t = now(), env = process.env } = {}) {
  if (!assistantSecret(env)) return [];
  const out = [];
  const today = israelDate(t);
  const sunday = wallClock(t).day === 0 && t >= israelInstant(today, WEEKLY_AT).getTime();
  for (const ws of workspaces(ctx)) {
    const once = `weekly.summary:${ws}:${today}`;
    if (sunday && !ctx.db.get('SELECT 1 AS x FROM owner_events WHERE once_key = ?', once)) {
      const id = emit(ctx, { type: 'weekly.summary', workspaceId: ws, data: weekSummary(ctx, ws, today, { t }), once, t, env });
      if (id) out.push(id);
    }
    out.push(...quotaLow(ctx, ws, quotaOf(forWorkspace(ctx.global || ctx, ws), t), { t, env }));
  }
  return out;
}

const wait = (tries) => (BACKOFF_MIN[tries - 1] ?? 60) * 60_000;

/**
 * Send what is due: each pending event whose time has come, oldest first, signed. `send(url, init)` replaces the
 * network for the tests. Returns [{ id, ok, status }].
 */
export async function deliver(ctx, { t = now(), env = process.env, send = localFetch, limit = 20 } = {}) {
  const secret = assistantSecret(env);
  if (!secret) return [];
  const { db } = ctx;
  const base = String(env.TORAN_INTERNAL || 'http://127.0.0.1:4710').trim().replace(/\/+$/, '');
  const path = '/internal/teder/events';
  const out = [];
  for (const e of db.all("SELECT * FROM owner_events WHERE state = 'pending' AND next_at <= ? ORDER BY at LIMIT ?", new Date(t).toISOString(), limit)) {
    if (t - Date.parse(e.at) > KEEP_MS) {
      db.run("UPDATE owner_events SET state = 'dropped' WHERE id = ?", e.id);
      out.push({ id: e.id, ok: false, status: 'dropped' });
      continue;
    }
    const body = JSON.stringify({ id: e.id, type: e.type, workspace: e.workspace_id, at: e.at, data: j(e.data_json, {}) });
    let status = null;
    let error = null;
    try {
      const res = await send(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(secret, { method: 'POST', path, body, t }) }, body, timeoutMs: 10_000 });
      status = res.status;
      await res.text().catch(() => '');
    } catch (x) {
      error = String(x.message).slice(0, 300);
    }
    const tries = e.tries + 1;
    if (status >= 200 && status < 300) {
      db.run("UPDATE owner_events SET state = 'sent', tries = ?, sent_at = ?, last_error = NULL WHERE id = ?", tries, new Date(t).toISOString(), e.id);
      out.push({ id: e.id, ok: true, status });
      continue;
    }
    const next = t + wait(tries);
    const gone = next - Date.parse(e.at) > KEEP_MS;
    db.run('UPDATE owner_events SET state = ?, tries = ?, next_at = ?, last_error = ? WHERE id = ?', gone ? 'dropped' : 'pending', tries, new Date(next).toISOString(), error || `HTTP ${status}`, e.id);
    out.push({ id: e.id, ok: false, status: status ?? 'network' });
  }
  return out;
}

/**
 * The sender, beside the runner: every 30 seconds, and at once after an event is written. One pass at a time.
 * Returns stop().
 */
export function startEvents(ctx, { everyMs = 30_000, env = process.env } = {}) {
  let busy = false;
  let again = false;
  const go = async () => {
    if (busy) return void (again = true);
    busy = true;
    try {
      do {
        again = false;
        await deliver(ctx, { env });
      } while (again);
    } catch (e) {
      ctx.log?.(`owner line: ${e.stack || e.message}`);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(go, everyMs);
  timer.unref?.();
  kick = () => setImmediate(go);
  go();
  return () => {
    clearInterval(timer);
    kick = null;
  };
}
