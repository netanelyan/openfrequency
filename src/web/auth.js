import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// What is left of Teder's own login after it moved to openfrequency-accounts
// (src/web/accounts.js asks accounts who a session is): the CSRF token, the
// cookie parser, and what the proxy on this machine may say about a request.
//
// Every state-changing request carries a CSRF token derived from the accounts
// session id (an HMAC of it, keyed by SESSION_SECRET), checked in constant time,
// and the Origin must be our own.

export function sessionSecret(env = process.env) {
  const s = String(env.SESSION_SECRET || '').trim();
  if (s.length >= 32) return s;
  // A per-process secret: forms opened before a restart need a reload, which is
  // the safe failure for a missing setting.
  globalThis.__ofEphemeralSecret ??= randomBytes(32).toString('hex');
  return globalThis.__ofEphemeralSecret;
}

const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');

export const csrfFor = (session, secret) => sign(`csrf:${session}`, secret).slice(0, 32);
export function csrfOk(given, session, secret) {
  const want = Buffer.from(csrfFor(session, secret));
  const got = Buffer.from(String(given || ''));
  return want.length === got.length && timingSafeEqual(want, got);
}

export function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => {
        try {
          return [k, decodeURIComponent(v.join('='))];
        } catch {
          return [k, ''];
        }
      })
  );
}

const fromProxy = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

/** Did this request reach us over HTTPS? Only the proxy on this machine may say so. */
export const isHttps = (req) => fromProxy(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
