import { createHash } from 'node:crypto';
import { deleteJson, getJson, NetError, postForm } from '../core/net.js';
import { getSetting, setSetting } from '../core/store.js';
import { DAY, now } from '../core/clock.js';

// Instagram, published directly through Meta's official Graph API. Free, and one
// connected account fewer on Zernio for every pack.
//
// Ported from the owner's earlier single-account pipeline. Two auth paths, chosen per
// pack in pack.json (instagram.auth):
//
//   "facebook"   Instagram API with Facebook Login, graph.facebook.com. The
//                Instagram account is a business or creator account linked to
//                a Facebook Page. The token is a Page access token made from a
//                long-lived user token, and it does not expire; Meta can still
//                end its data access after 90 days without use, which the
//                check script reports (npm run instagram:check).
//   "instagram"  Instagram API with Instagram Login, graph.instagram.com. No
//                Page. The long-lived token lasts 60 days and is refreshed here,
//                at least 24 hours old and before it runs out. A refreshed token
//                is stored in the database, so a restart does not lose it.
//
// The token comes from $OF_HOME/.env, in the variable the pack names
// (instagram.tokenEnv, IG_TOKEN_<PACK> by default). A refreshed one is kept in
// the database and wins, until .env holds a different token than the one it
// was refreshed from: then the new one in .env is the owner's and wins.
//
// A carousel is three steps, and only the last one publishes: a container per
// slide (is_carousel_item), a CAROUSEL container with the children in order,
// then media_publish. Instagram fetches every slide itself, by URL, so the
// slides are served from MEDIA_PUBLIC_BASE_URL like Zernio's. JPEG only, 2 to
// 10 slides, 4:5 to 1.91:1: our 1080x1350 slides are 4:5.
//
// Nothing here reads a comment, a mention, a message or another account; the
// network door refuses those Graph edges by name (src/core/net.js).

export const GRAPH_VERSION = () => process.env.GRAPH_API_VERSION || 'v25.0';
const host = (auth) => (auth === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.facebook.com');

export class InstagramError extends Error {
  constructor(message, { step, code = null, subcode = null, creationId = null, retryable = false } = {}) {
    super(message);
    this.name = 'InstagramError';
    this.step = step;
    this.code = code;
    this.subcode = subcode;
    this.creationId = creationId;
    this.retryable = retryable;
  }
}

// Throttles clear on their own within the hour: not now, rather than broken.
//   4 app limit, 17 user limit, 32 page limit, 613 custom limit, 80002 Instagram's own.
const THROTTLE = new Set([4, 17, 32, 613, 80002]);
export const isThrottle = (e) => e instanceof InstagramError && (THROTTLE.has(Number(e.code)) && Number(e.subcode) !== 2207051);
// 190 is a dead token: the account is unpublishable until the owner makes a new one.
export const isTokenProblem = (e) => e instanceof InstagramError && (Number(e.code) === 190 || Number(e.code) === 102);
// 2207051 is "this looks like spam": a platform refusal of the content, not a throttle.
export const isRefusal = (e) => e instanceof InstagramError && (Number(e.subcode) === 2207051 || /spam|violat|restricted|blocked/i.test(e.message));

/** The pack's Instagram settings, with the defaults filled in. */
export function igConfig(pack) {
  const c = pack.meta.instagram || {};
  return { userId: String(c.userId || '').trim(), auth: c.auth === 'instagram' ? 'instagram' : 'facebook', tokenEnv: c.tokenEnv || `IG_TOKEN_${pack.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}` };
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const tokenKey = (pack) => `instagram:token:${pack.id}`;

/** The token in use for a pack, or null: the refreshed one in the database, or the one in .env. */
export function currentToken(db, pack, env = process.env) {
  const seed = String(env[igConfig(pack).tokenEnv] || '').trim();
  const saved = getSetting(db, tokenKey(pack), null);
  if (saved?.token && (!seed || saved.from === sha(seed))) return saved.token;
  return seed || null;
}

export const instagramConfigured = (db, pack, env = process.env) => Boolean(igConfig(pack).userId && currentToken(db, pack, env));

const redact = (msg, token) => (token ? String(msg).split(token).join('***') : String(msg));

/** One Graph call. The token travels in the query of a read and in the body of a write. */
async function graph(db, pack, path, { method = 'GET', params = {}, step, token = currentToken(db, pack), base = null } = {}) {
  const cfg = igConfig(pack);
  const url = `${base || `${host(cfg.auth)}/${GRAPH_VERSION()}`}/${path}`;
  try {
    if (method === 'GET') return await getJson(`${url}?${new URLSearchParams({ ...params, access_token: token })}`, { timeoutMs: 30_000 });
    if (method === 'DELETE') return await deleteJson(`${url}?${new URLSearchParams({ ...params, access_token: token })}`, { timeoutMs: 30_000 });
    return await postForm(url, { ...params, access_token: token }, { timeoutMs: 60_000 });
  } catch (e) {
    const err = e.body?.error || {};
    throw new InstagramError(redact(err.message || e.message, token), {
      step,
      code: err.code ?? (e instanceof NetError ? e.code : null),
      subcode: err.error_subcode ?? null,
      retryable: e instanceof NetError && (e.code === 'network' || e.status >= 500),
    });
  }
}

// ---------------------------------------------------------------- tokens

const REFRESH_WHEN_DAYS_LEFT = 20;

/**
 * Refresh an Instagram Login token that is getting old. Returns { refreshed,
 * daysLeft, reason }. A Page token (Facebook Login) does not expire: nothing to do.
 */
export async function refreshToken(db, pack, { force = false, t = now(), env = process.env } = {}) {
  const cfg = igConfig(pack);
  if (cfg.auth !== 'instagram') return { refreshed: false, reason: 'a Page token does not expire' };
  const token = currentToken(db, pack, env);
  if (!token) return { refreshed: false, reason: 'no token' };
  const saved = getSetting(db, tokenKey(pack), null);
  const daysLeft = saved?.token === token && saved.expiresAt ? (saved.expiresAt - t) / DAY : null;
  // With no known expiry, one refresh establishes it.
  if (!force && daysLeft != null && daysLeft > REFRESH_WHEN_DAYS_LEFT) return { refreshed: false, daysLeft, reason: 'not due' };
  const r = await graph(db, pack, 'refresh_access_token', { params: { grant_type: 'ig_refresh_token' }, step: 'refresh', token, base: host('instagram') });
  if (!r?.access_token) throw new InstagramError('the refresh returned no token', { step: 'refresh' });
  const seed = String(env[cfg.tokenEnv] || '').trim();
  const expiresAt = t + (Number(r.expires_in) || 60 * 86_400) * 1000;
  setSetting(db, tokenKey(pack), { token: r.access_token, expiresAt, refreshedAt: new Date(t).toISOString(), from: sha(seed || saved?.from || r.access_token) });
  return { refreshed: true, daysLeft: (expiresAt - t) / DAY };
}

/** Store a token made by hand (npm run instagram:token), with its expiry when it has one. */
export function storeToken(db, pack, token, { expiresAt = null, env = process.env } = {}) {
  const seed = String(env[igConfig(pack).tokenEnv] || '').trim();
  setSetting(db, tokenKey(pack), { token, expiresAt, refreshedAt: new Date().toISOString(), from: sha(seed || token) });
}

/**
 * What is known about a pack's token, for the check script and the Settings
 * page: { configured, auth, daysLeft, dataAccessDaysLeft, valid, scopes }.
 * Facebook Login tokens are asked about through debug_token, which needs the
 * app's id and secret (META_APP_ID, META_APP_SECRET).
 */
export async function tokenStatus(db, pack, { t = now(), env = process.env } = {}) {
  const cfg = igConfig(pack);
  const token = currentToken(db, pack, env);
  const out = { configured: Boolean(cfg.userId && token), auth: cfg.auth, userId: cfg.userId || null, daysLeft: null, dataAccessDaysLeft: null, valid: null, scopes: null };
  if (!token) return out;
  if (cfg.auth === 'instagram') {
    const saved = getSetting(db, tokenKey(pack), null);
    if (saved?.token === token && saved.expiresAt) out.daysLeft = Math.floor((saved.expiresAt - t) / DAY);
    return out;
  }
  if (!env.META_APP_ID || !env.META_APP_SECRET) return out;
  const d = (await graph(db, pack, 'debug_token', { params: { input_token: token }, step: 'debug_token', token: `${env.META_APP_ID}|${env.META_APP_SECRET}` }))?.data || {};
  out.valid = Boolean(d.is_valid);
  out.scopes = d.scopes || null;
  out.daysLeft = d.expires_at ? Math.floor((d.expires_at * 1000 - t) / DAY) : null; // 0: never expires
  out.dataAccessDaysLeft = d.data_access_expires_at ? Math.floor((d.data_access_expires_at * 1000 - t) / DAY) : null;
  return out;
}

// ---------------------------------------------------------------- reading our own account

/** The account the token reaches: { id, username, account_type, media_count }. */
// With Instagram Login the node's "id" is app-scoped; the professional account's id (the one in pack.json, 17841...) is
// its "user_id". Facebook Login's IG User node has no such field: its id is that account id.
export const account = (db, pack) => graph(db, pack, igConfig(pack).userId, { params: { fields: igConfig(pack).auth === 'instagram' ? 'id,user_id,username,media_count' : 'id,username,media_count' }, step: 'account' });

/** How many API posts are left in the rolling 24 hours (Meta's own limit; the docs disagree on 50 or 100, so it is asked). */
export async function quota(db, pack) {
  const r = await graph(db, pack, `${igConfig(pack).userId}/content_publishing_limit`, { params: { fields: 'quota_usage,config' }, step: 'quota' });
  const row = r?.data?.[0];
  if (!row) return null;
  return { used: row.quota_usage ?? 0, total: row.config?.quota_total ?? null };
}

/** Our latest media ids, newest first. */
export async function recentMedia(db, pack, { limit = 5 } = {}) {
  const r = await graph(db, pack, `${igConfig(pack).userId}/media`, { params: { fields: 'id,media_type,timestamp,permalink', limit: String(limit) }, step: 'media' });
  return r?.data || [];
}

/**
 * One post's numbers: { views, reach, saves, shares, likes, comments }, or null
 * when Instagram has none yet. Only what it returned is filled in: a metric it
 * does not report for this post stays null, never zero.
 */
export async function insights(db, pack, mediaId) {
  const ask = (metrics) => graph(db, pack, `${mediaId}/insights`, { params: { metric: metrics.join(',') }, step: 'insights' });
  let r;
  try {
    r = await ask(['reach', 'saved', 'shares', 'likes', 'comments', 'views']);
  } catch (e) {
    // A post can predate a metric (views arrived in 2025): ask again without it.
    if (Number(e.code) !== 100) throw e;
    r = await ask(['reach', 'saved', 'shares', 'likes', 'comments']);
  }
  const v = {};
  for (const m of r?.data || []) v[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? null;
  if (v.reach == null && v.views == null) return null;
  const num = (x) => (x == null ? null : Number(x));
  return { views: num(v.views), reach: num(v.reach), saves: num(v.saved), shares: num(v.shares), likes: num(v.likes), comments: num(v.comments) };
}

// ---------------------------------------------------------------- publishing

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a container to be ready. Images take seconds; Meta asks to poll gently. */
async function waitFor(db, pack, id, { timeoutMs = 120_000, everyMs = 4_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await graph(db, pack, id, { params: { fields: 'status_code,status' }, step: 'container_status' });
    if (r.status_code === 'FINISHED' || r.status_code === 'PUBLISHED') return r.status_code;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new InstagramError(`container ${r.status_code}: ${r.status || 'no detail'}`, { step: 'container_status', creationId: id });
    if (Date.now() > deadline) throw new InstagramError(`container still ${r.status_code} after ${timeoutMs / 1000}s`, { step: 'container_status', creationId: id, retryable: true });
    await sleep(everyMs);
  }
}

/** Has this container already become a post? Asked, not inferred. Never throws. */
export async function containerPublished(db, pack, creationId) {
  try {
    return (await graph(db, pack, creationId, { params: { fields: 'status_code' }, step: 'publish_verify' }))?.status_code === 'PUBLISHED';
  } catch {
    return false;
  }
}

export const AI_LINE = 'התמונה בפוסט נוצרה בעזרת AI.';

/**
 * Publish one post as a carousel (2 to 10 slides). `priorCreationId` is the
 * container a failed earlier attempt left: if it became a post after all, it is
 * reported as published rather than posted twice.
 */
export async function publishInstagram(db, pack, { caption, imageUrls, aiLabel = false, priorCreationId = null }) {
  const { userId } = igConfig(pack);
  if (!userId) throw new InstagramError('no instagram.userId in pack.json', { step: 'config' });
  if (!currentToken(db, pack)) throw new InstagramError(`no Instagram token (${igConfig(pack).tokenEnv} in .env)`, { step: 'config' });
  if (imageUrls.length < 2 || imageUrls.length > 10) throw new InstagramError(`a carousel takes 2 to 10 slides, this one has ${imageUrls.length}`, { step: 'config' });
  if (imageUrls.some((u) => !/^https:\/\//.test(u))) throw new InstagramError('every slide URL must be https', { step: 'config' });
  if (priorCreationId && (await containerPublished(db, pack, priorCreationId))) return { via: 'instagram', mediaId: null, creationId: priorCreationId, status: 'published', note: 'already published by the last attempt' };

  const text = `${String(caption)}${aiLabel ? `\n\n${AI_LINE}` : ''}`.slice(0, 2200);
  const children = [];
  for (const [i, image_url] of imageUrls.entries()) {
    const c = await graph(db, pack, `${userId}/media`, { method: 'POST', params: { image_url, is_carousel_item: 'true' }, step: `slide ${i + 1}` });
    if (!c?.id) throw new InstagramError(`slide ${i + 1}: no container id`, { step: 'slide' });
    children.push(c.id);
  }
  for (const id of children) await waitFor(db, pack, id);
  const parent = await graph(db, pack, `${userId}/media`, { method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), caption: text }, step: 'carousel' });
  if (!parent?.id) throw new InstagramError('no carousel container id', { step: 'carousel' });
  await waitFor(db, pack, parent.id, { timeoutMs: 300_000 });
  let mediaId = null;
  try {
    mediaId = (await graph(db, pack, `${userId}/media_publish`, { method: 'POST', params: { creation_id: parent.id }, step: 'publish' }))?.id || null;
  } catch (e) {
    // Graph sometimes reports an error from media_publish for a post that went up. Ask the container.
    if (!(await containerPublished(db, pack, parent.id))) {
      e.creationId ||= parent.id;
      throw e;
    }
  }
  let permalink = null;
  if (mediaId) permalink = (await graph(db, pack, mediaId, { params: { fields: 'permalink' }, step: 'permalink' }).catch(() => null))?.permalink || null;
  return { via: 'instagram', mediaId, creationId: parent.id, url: permalink, status: 'published' };
}

/**
 * Delete one of our published posts (a carousel by its album id), after a
 * takedown notice. Meta allows it only through Facebook Login, with the
 * instagram_manage_contents permission; an Instagram Login account is deleted
 * by hand in the app, and so is a token without that permission.
 */
export async function deleteMedia(db, pack, mediaId) {
  if (igConfig(pack).auth !== 'facebook') throw new InstagramError('Instagram Login cannot delete a post through the API: delete it in the app', { step: 'delete' });
  if (!/^\d+$/.test(String(mediaId || ''))) throw new InstagramError('no media id to delete', { step: 'delete' });
  const r = await graph(db, pack, String(mediaId), { method: 'DELETE', step: 'delete' });
  if (r && r.success === false) throw new InstagramError('Meta answered that the post was not deleted', { step: 'delete' });
  return { deleted: true, id: r?.deleted_id || mediaId };
}
