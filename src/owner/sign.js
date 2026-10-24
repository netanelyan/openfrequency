import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { now } from '../core/clock.js';
import { sessionSecret } from '../web/auth.js';

// The owner line (docs/internal-assistant.md): Teder and openfrequency-toran sign everything they send each other
// with one secret, OF_ASSISTANT_SECRET, the same value in both .env files. Toran's questions to Teder's internal
// listener and Teder's events to Toran are signed the same way:
//
//   X-OF-Timestamp: <unix seconds>
//   X-OF-Signature: v1=<hex HMAC-SHA256(secret, "v1\n" + ts + "\n" + METHOD + "\n" + pathWithQuery + "\n" + sha256hex(rawBody))>
//
// The body of a GET is the empty string. A timestamp more than SKEW_S from our clock is stale; a signature is
// compared in constant time.
//
// The slide links the internal API hands out (/m/<token>.jpg) are signed with SESSION_SECRET instead: they leave this
// machine (WhatsApp fetches them from Meta's servers), and a link names one slide of one post until it expires.

export const SKEW_S = 300;
export const MIN_SECRET = 32;
/** How long a slide link opens. */
export const LINK_TTL_S = 7 * 24 * 3600;

/** The shared secret, or null while it is unset or shorter than MIN_SECRET: the owner line is then off both ways. */
export function assistantSecret(env = process.env) {
  const s = String(env.OF_ASSISTANT_SECRET || '').trim();
  return s.length >= MIN_SECRET ? s : null;
}

const sha256 = (body) => createHash('sha256').update(body ?? '').digest('hex');

/** The string a signature is over. */
export const signedText = ({ ts, method, path, body = '' }) => `v1\n${ts}\n${String(method).toUpperCase()}\n${path}\n${sha256(body)}`;

/** The two headers for one request. `path` is the path with its query, exactly as sent. */
export function sign(secret, { method, path, body = '', t = now() }) {
  const ts = String(Math.floor(t / 1000));
  return { 'x-of-timestamp': ts, 'x-of-signature': `v1=${createHmac('sha256', secret).update(signedText({ ts, method, path, body })).digest('hex')}` };
}

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Check one request's headers (lower-case names, as node gives them). Returns { ok } or { ok: false, error: 'stale' | 'bad_signature' }. */
export function verify(secret, { headers, method, path, body = '', t = now() }) {
  const ts = String(headers['x-of-timestamp'] || '');
  if (!/^\d{1,12}$/.test(ts) || Math.abs(Math.floor(t / 1000) - Number(ts)) > SKEW_S) return { ok: false, error: 'stale' };
  const given = String(headers['x-of-signature'] || '');
  const want = `v1=${createHmac('sha256', secret).update(signedText({ ts, method, path, body })).digest('hex')}`;
  return same(given, want) ? { ok: true } : { ok: false, error: 'bad_signature' };
}

// ---- the slide links

const linkSig = (secret, payload) => createHmac('sha256', secret).update(`media:v1:${payload}`).digest('base64url');

/** The public origin the slide links are under: https://PUBLIC_HOST behind Caddy, the local site on a laptop. */
export function publicBase(env = process.env) {
  const host = String(env.PUBLIC_HOST || '').trim().toLowerCase();
  return host ? `https://${host}` : `http://127.0.0.1:${Number(env.PORT) || 4700}`;
}

/**
 * A link to one rendered slide: the post, the platform, the slide's index (0-based, as in media_json) and the expiry,
 * signed. The expiry is rounded up to the hour, so the same slide asked for twice within it has the same link.
 */
export function mediaUrl({ postId, platform, idx, t = now(), env = process.env }) {
  const e = Math.ceil((Math.floor(t / 1000) + LINK_TTL_S) / 3600) * 3600;
  const payload = `${postId}.${platform}.${idx}.${e}`;
  return `${publicBase(env)}/m/${payload}.${linkSig(sessionSecret(env), payload)}.jpg`;
}

const LINK = /^\/m\/([\w-]+)\.(tiktok|instagram)\.(\d{1,3})\.(\d{1,12})\.([\w-]{43})\.jpg$/;

/** What a slide link's path names: { postId, platform, idx } while it holds, { error: 'expired' | 'bad' } otherwise. */
export function readMediaPath(p, { t = now(), env = process.env } = {}) {
  const m = LINK.exec(p);
  if (!m) return { error: 'bad' };
  const [, postId, platform, idx, e, sig] = m;
  if (!same(sig, linkSig(sessionSecret(env), `${postId}.${platform}.${idx}.${e}`))) return { error: 'bad' };
  if (Number(e) * 1000 <= t) return { error: 'expired' };
  return { postId, platform, idx: Number(idx) };
}

export const isMediaPath = (p) => p.startsWith('/m/');
