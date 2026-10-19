import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { nowIso } from '../core/clock.js';
import { getSetting, setSetting } from '../core/store.js';
import { doorFetch } from '../core/net.js';

// Telling the owner something now: a TikTok draft to publish, a reminder, a post the fallback put out, a duplicate.
//
// Every notification is kept (the `notifications` table) and shown in Teder whether or not a browser was there to
// show it. Each browser that asked for them (Settings) also gets a Web Push: an empty one, signed with the server's
// VAPID key. It carries no words, so nothing about a post leaves the server: the browser's service worker wakes,
// asks Teder for the latest notification behind the owner's session, and shows it. Telegram was the other way;
// its API is a social host, and the network door refuses every write to one (HARD RULE 1).
//
// The push services a browser can name are the only hosts this writes to (src/core/net.js lists them).

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The server's VAPID key pair, made once and kept: { publicKey (the browser's applicationServerKey), jwk }. */
export function vapid(db) {
  let k = getSetting(db, 'push:vapid', null);
  if (!k) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = privateKey.export({ format: 'jwk' });
    k = { jwk, publicKey: b64url(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])) };
    setSetting(db, 'push:vapid', k);
  }
  return k;
}

/** The Authorization header for one push service: a VAPID JWT for its origin, signed ES256. */
export function vapidAuth(db, endpoint, { t = Date.now() } = {}) {
  const k = vapid(db);
  const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const contact = String(process.env.OF_PUSH_CONTACT || '').trim() || 'mailto:owner@localhost';
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(t / 1000) + 12 * 3600, sub: contact }));
  const sig = sign('sha256', Buffer.from(`${head}.${claims}`), { key: createPrivateKey({ key: k.jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${k.publicKey}`;
}

/** A browser's subscription, kept by its endpoint. Returns { ok } or { problem }. */
export function subscribe(db, { endpoint }, { userId = null } = {}) {
  let u;
  try {
    u = new URL(String(endpoint || ''));
  } catch {
    return { problem: 'not a push endpoint' };
  }
  if (u.protocol !== 'https:') return { problem: 'not a push endpoint' };
  db.run('INSERT INTO push_subs (endpoint, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET failed = 0', u.href, userId, nowIso());
  return { ok: true };
}

/**
 * Tell the owner: kept, then pushed to every browser that asked. `send` replaces the network for the tests.
 * Returns the notification's id. A push that fails is counted, and a browser that is gone (404, 410) is forgotten.
 */
export async function notify(ctx, { accountId = null, postId = null, kind, title, body, url = '/' }, { send = null } = {}) {
  const { db } = ctx;
  const id = db.insert('notifications', { account_id: accountId, post_id: postId, kind, title, body, url, created_at: nowIso() });
  const subs = db.all('SELECT * FROM push_subs WHERE failed < 5');
  let pushed = 0;
  for (const s of subs) {
    try {
      const res = await (send || pushOne)(db, s.endpoint);
      if (res.status === 404 || res.status === 410) db.run('DELETE FROM push_subs WHERE id = ?', s.id);
      else if (res.status >= 200 && res.status < 300) pushed++;
      else db.run('UPDATE push_subs SET failed = failed + 1 WHERE id = ?', s.id);
    } catch (e) {
      db.run('UPDATE push_subs SET failed = failed + 1 WHERE id = ?', s.id);
      ctx.log?.(`push: ${e.message}`);
    }
  }
  if (pushed) db.run('UPDATE notifications SET pushed = ? WHERE id = ?', pushed, id);
  return id;
}

/** One empty push to one browser, through the door. */
async function pushOne(db, endpoint) {
  return doorFetch(endpoint, { method: 'POST', headers: { authorization: vapidAuth(db, endpoint), ttl: '86400', urgency: 'high', 'content-length': '0' }, timeoutMs: 15_000 });
}

/** The newest notification, for the service worker to show. */
export const latestNotification = (db) => db.get('SELECT id, title, body, url, created_at FROM notifications ORDER BY id DESC LIMIT 1') || null;

/** The last few, for Teder's own pages. */
export const recentNotifications = (db, { limit = 10, since = null } = {}) =>
  since ? db.all('SELECT * FROM notifications WHERE created_at >= ? ORDER BY id DESC LIMIT ?', since, limit) : db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', limit);
