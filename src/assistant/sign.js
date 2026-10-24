import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { now } from '../core/clock.js';

// Teder and the WhatsApp assistant (openfrequency-toran) sign everything they send each other with one shared secret,
// OF_ASSISTANT_SECRET in private/.env on both sides (docs/assistant-api.md):
//
//   X-OF-Signature: t=<unix seconds>,n=<nonce>,s=<hex HMAC-SHA256>
//
// over these lines, joined by \n:
//
//   <direction>   toran->teder for a request to Teder, teder->toran for an event to the assistant, so a message
//                 signed for one way is refused the other way
//   <t>           when it was signed; more than SKEW_S away from our clock is refused
//   <nonce>       16 to 64 of [A-Za-z0-9_-], never the same twice: a nonce seen before is a replay
//   <METHOD>      GET, POST
//   <path>        with its query, as sent: /internal/assistant/customers/7/posts/pending
//   <sha256>      of the body, hex (of nothing for a GET)
//
// The same secret signs the slide links the assistant hands on (mediaLink): a link names one slide and an expiry,
// and nothing else opens with it.

export const SKEW_S = 300;
/** How long a nonce is kept: past this a signature is refused for its time alone. */
export const NONCE_KEEP_MS = 2 * SKEW_S * 1000;
export const MIN_SECRET = 32;
export const DIR = { in: 'toran->teder', out: 'teder->toran' };
/** How long a slide link opens. */
export const LINK_TTL_S = 24 * 3600;

/** The shared secret, or null when it is not set (32 characters or more): the assistant is then off. */
export function assistantSecret(env = process.env) {
  const s = String(env.OF_ASSISTANT_SECRET || '').trim();
  return s.length >= MIN_SECRET ? s : null;
}

const sha256 = (body) => createHash('sha256').update(body ?? '').digest('hex');
const hmac = (secret, text) => createHmac('sha256', secret).update(text).digest('hex');

/** The lines a signature is over. */
export const signedText = ({ dir, t, nonce, method, path, body }) => [dir, t, nonce, String(method).toUpperCase(), path, sha256(body)].join('\n');

/** The X-OF-Signature header for one message. `t` is unix seconds; a nonce is made when none is given. */
export function signature(secret, { dir, method, path, body = '', t = Math.floor(now() / 1000), nonce = randomBytes(16).toString('base64url') }) {
  return `t=${t},n=${nonce},s=${hmac(secret, signedText({ dir, t, nonce, method, path, body }))}`;
}

/** { t, nonce, sig } from a header, or null when it is not one. */
export function parseSignature(header) {
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((p) => p.trim().split('='))
      .filter((p) => p.length === 2)
  );
  if (!/^\d{1,12}$/.test(parts.t || '') || !/^[A-Za-z0-9_-]{16,64}$/.test(parts.n || '') || !/^[0-9a-f]{64}$/.test(parts.s || '')) return null;
  return { t: Number(parts.t), nonce: parts.n, sig: parts.s };
}

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Is this request the assistant's, and new? Returns { ok: true } or { ok: false, error } with error one of
 * bad_signature (missing, malformed or wrong), stale (its time is too far from ours) or replay (its nonce was seen).
 * The nonce is kept only once the signature holds, so nobody without the secret can use up nonces.
 */
export function verify(db, secret, { header, method, path, body, dir = DIR.in, t = now() }) {
  const p = parseSignature(header);
  if (!p) return { ok: false, error: 'bad_signature' };
  if (Math.abs(Math.floor(t / 1000) - p.t) > SKEW_S) return { ok: false, error: 'stale' };
  if (!same(hmac(secret, signedText({ dir, t: p.t, nonce: p.nonce, method, path, body })), p.sig)) return { ok: false, error: 'bad_signature' };
  db.run('DELETE FROM assistant_nonces WHERE at < ?', new Date(t - NONCE_KEEP_MS).toISOString());
  const fresh = db.run('INSERT OR IGNORE INTO assistant_nonces (nonce, at) VALUES (?, ?)', p.nonce, new Date(t).toISOString()).changes;
  if (!fresh) return { ok: false, error: 'replay' };
  return { ok: true };
}

/* ------------------------------------------------------------------ slide links */

const linkSig = (secret, { postId, platform, idx, exp }) => hmac(secret, ['media-link', postId, platform, idx, exp].join('\n'));

/** Where the links point: the public name when there is one (WhatsApp fetches them), else this machine. */
export function linkBase({ env = process.env, port = null } = {}) {
  const host = String(env.PUBLIC_HOST || '').trim().toLowerCase();
  return host ? `https://${host}` : `http://127.0.0.1:${port || Number(env.PORT) || 4700}`;
}

/** A signed link to one rendered slide, open for LINK_TTL_S. */
export function mediaLink(secret, { base, postId, platform, idx, t = now(), ttlS = LINK_TTL_S }) {
  const exp = Math.floor(t / 1000) + ttlS;
  return `${base}/m/${encodeURIComponent(postId)}/${platform}/${idx}?e=${exp}&s=${linkSig(secret, { postId, platform, idx, exp })}`;
}

/** Does this link still open? */
export function mediaLinkOk(secret, { postId, platform, idx, e, s, t = now() }) {
  if (!secret || !/^\d{1,12}$/.test(String(e || '')) || !/^[0-9a-f]{64}$/.test(String(s || ''))) return false;
  if (Number(e) < Math.floor(t / 1000)) return false;
  return same(linkSig(secret, { postId, platform, idx: Number(idx), exp: Number(e) }), s);
}
