import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { nowIso } from '../core/clock.js';
import { audit } from '../core/store.js';

// The login in front of every page and every button.
//
// Users live in the database (one owner today, more later: `npm run user:add`).
// Passwords are scrypt hashes with a per-user salt. A session is a signed
// cookie: user id, expiry and an HMAC over both, keyed by SESSION_SECRET.
// HttpOnly, SameSite=Strict, Secure with the __Host- prefix behind HTTPS.
//
// Every state-changing request carries a CSRF token derived from the session
// (an HMAC of it), checked in constant time, and the Origin must be our own.
//
// Failed logins are limited per address (5 in 15 minutes); under a wider attack
// (20 failures in an hour from anywhere) each address gets one try, and the
// login never locks for everyone, so a stranger cannot lock the owner out.

const DAY = 86_400_000;
export const SESSION_DAYS = 30;

export function hashPassword(password, salt = randomBytes(16)) {
  const key = scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function checkPassword(password, stored) {
  const m = /^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(String(stored || ''));
  if (!m) return false;
  const want = Buffer.from(m[2], 'hex');
  const got = scryptSync(String(password), Buffer.from(m[1], 'hex'), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

export function addUser(db, name, password, role = 'owner') {
  if (String(password).length < 12) throw new Error('a password needs at least 12 characters');
  const id = db.insert('users', { name: String(name).trim(), password_hash: hashPassword(password), role, created_at: nowIso() });
  audit(db, { action: 'user_added', detail: { name, role } });
  return id;
}

/** On first start with no users, create one from OF_ADMIN_USER / OF_ADMIN_PASSWORD. */
export function bootstrapOwner(db, env = process.env) {
  if (db.get('SELECT COUNT(*) AS n FROM users').n) return null;
  const name = String(env.OF_ADMIN_USER || '').trim() || 'owner';
  const pass = String(env.OF_ADMIN_PASSWORD || '');
  if (pass.length < 12) return null;
  return addUser(db, name, pass, 'owner');
}

export function sessionSecret(env = process.env) {
  const s = String(env.SESSION_SECRET || '').trim();
  if (s.length >= 32) return s;
  // A per-process secret: sessions do not survive a restart, which is the safe
  // failure for a missing setting.
  globalThis.__ofEphemeralSecret ??= randomBytes(32).toString('hex');
  return globalThis.__ofEphemeralSecret;
}

const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

export function makeSession(userId, secret, t = Date.now()) {
  const body = `v1.${userId}.${t + SESSION_DAYS * DAY}`;
  return `${body}.${sign(body, secret)}`;
}

/** The user id a cookie value proves, or null. */
export function sessionUser(value, secret, t = Date.now()) {
  const m = /^(v1\.(\d+)\.(\d+))\.([A-Za-z0-9_-]+)$/.exec(String(value || ''));
  if (!m) return null;
  const want = Buffer.from(sign(m[1], secret));
  const got = Buffer.from(m[4]);
  if (want.length !== got.length || !timingSafeEqual(want, got) || Number(m[3]) <= t) return null;
  return Number(m[2]);
}

export const csrfFor = (session, secret) => sign(`csrf:${session}`, secret).slice(0, 32);
export function csrfOk(given, session, secret) {
  const want = Buffer.from(csrfFor(session, secret));
  const got = Buffer.from(String(given || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

export const cookieName = (secure) => (secure ? '__Host-of' : 'of');

export function sessionCookie(value, { secure, clear = false } = {}) {
  const parts = [`${cookieName(secure)}=${clear ? '' : value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86_400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

export const sessionFrom = (req) => {
  const jar = cookies(req);
  return jar['__Host-of'] || jar.of || null;
};

const fromProxy = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

/** Did this request reach us over HTTPS? Only the proxy on this machine may say so. */
export const isHttps = (req) => fromProxy(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';

export function clientIp(req) {
  if (fromProxy(req)) {
    const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (f) return f;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function createLimiter({ perIp = { max: 5, windowMs: 15 * 60_000 }, global = { max: 20, windowMs: 60 * 60_000 } } = {}) {
  const fails = new Map();
  let all = [];
  const prune = (list, windowMs, t) => list.filter((x) => t - x < windowMs);
  return {
    check(ip, t = Date.now()) {
      all = prune(all, global.windowMs, t);
      const max = all.length >= global.max ? 1 : perIp.max;
      const mine = prune(fails.get(ip) || [], perIp.windowMs, t);
      fails.set(ip, mine);
      return mine.length >= max ? Math.ceil((perIp.windowMs - (t - mine[mine.length - max])) / 1000) : null;
    },
    fail(ip, t = Date.now()) {
      fails.set(ip, [...prune(fails.get(ip) || [], perIp.windowMs, t), t]);
      all = [...prune(all, global.windowMs, t), t];
    },
    succeed(ip) {
      fails.delete(ip);
    },
  };
}
