// The only door to the network.
//
// HARD RULE 1: the engine never likes, follows, comments, DMs, or reads other
// accounts by logging in, on any platform. The cheapest way to make that true and
// keep it true is to give every request one door and write down, here, every
// place the door opens onto:
//
//   - WRITES (anything but GET) are allowed to exactly two endpoints: Claude's
//     messages endpoint, and Zernio's create-post endpoint. Nothing else.
//   - READS from a social platform are allowed only through the official read
//     APIs listed below (YouTube Data API search/videos). A social host is never
//     fetched as a web page, so nothing here can scrape a profile or a feed.
//   - READS from the open web (approved sources, feed discovery, image libraries)
//     are allowed for any https host that is not a social platform.
//   - Zernio paths that touch an inbox, messages, comments, likes or follows are
//     refused by name, even as reads.
//
// The test suite refuses any `fetch(` outside this file, and any rule that
// would let a write reach a social host. The Anthropic SDK is handed doorFetch
// as its fetch, so its requests pass through the same rules.

export const SOCIAL = [
  'tiktok.com', 'tiktokv.com', 'instagram.com', 'facebook.com', 'fb.com', 'threads.net', 'youtube.com',
  'x.com', 'twitter.com', 'whatsapp.com', 'wa.me', 'linkedin.com', 'telegram.org', 't.me', 'reddit.com',
  'snapchat.com', 'pinterest.com', 'discord.com',
];

const onHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);
export const isSocial = (host) => SOCIAL.some((d) => onHost(String(host).toLowerCase(), d));

// Zernio is a publishing gateway, and it also has an inbox. Only these paths.
const ZERNIO_FORBIDDEN = /inbox|message|comment|conversation|reply|repl(y|ies)|like|follow|dm\b|direct/i;

/** Every non-GET request the engine can make. Read top to bottom: that is all of it. */
export const WRITE_RULES = [
  { method: 'POST', host: 'api.anthropic.com', path: /^\/v1\/messages$/, why: 'Claude: drafting, review, scoring' },
  { method: 'POST', host: 'zernio.com', path: /^\/api\/v1\/posts$/, why: 'Zernio: create a post on our own account' },
];

/** Reads that are allowed even though the host is special. */
export const READ_RULES = [
  { host: 'www.googleapis.com', path: /^\/youtube\/v3\/(search|videos)$/, why: 'YouTube Data API: Shorts and their public counts, read only' },
  { host: 'zernio.com', path: /^\/api\/v1\/(posts\/[A-Za-z0-9_-]+|accounts|analytics)$/, why: 'Zernio: our own posts, accounts and analytics' },
  { host: 'i.ytimg.com', why: 'YouTube thumbnails' },
];

export class NetError extends Error {
  constructor(message, { status = null, code = 'network' } = {}) {
    super(message);
    this.name = 'NetError';
    this.status = status;
    this.code = code;
  }
}

/** The rule that allows this request, or a throw. Pure, so the tests can read it. */
export function assertAllowed(method, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new NetError(`not a URL: ${url}`, { code: 'refused' });
  }
  const m = String(method || 'GET').toUpperCase();
  if (u.protocol !== 'https:') throw new NetError(`refused ${m} ${u.protocol}//${u.hostname}: https only`, { code: 'refused' });
  const host = u.hostname.toLowerCase();

  if (onHost(host, 'zernio.com') && ZERNIO_FORBIDDEN.test(u.pathname)) {
    throw new NetError(`refused ${m} ${host}${u.pathname}: the engine never touches an inbox, comments or messages`, { code: 'refused' });
  }

  if (m !== 'GET' && m !== 'HEAD') {
    const rule = WRITE_RULES.find((r) => r.method === m && r.host === host && r.path.test(u.pathname));
    if (!rule) throw new NetError(`refused ${m} ${host}${u.pathname}: not on the write allowlist`, { code: 'refused' });
    return rule;
  }

  const special = READ_RULES.find((r) => r.host === host && (!r.path || r.path.test(u.pathname)));
  if (special) return special;
  if (isSocial(host) || onHost(host, 'zernio.com')) {
    throw new NetError(`refused GET ${host}${u.pathname}: a social platform is read only through its official API`, { code: 'refused' });
  }
  return { host, why: 'the open web: a source, a feed, an image library' };
}

const UA = 'open-frequency/0.1 (+https://github.com/open-frequency)';

/**
 * fetch, through the rules. Redirects are followed by hand so every hop is
 * checked: a source that redirects onto a social host is refused at the hop.
 */
export async function doorFetch(input, init = {}) {
  const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
  const headers = new Headers(init.headers || (typeof input === 'object' ? input?.headers : undefined) || {});
  if (!headers.has('user-agent')) headers.set('user-agent', UA);
  const timeoutMs = init.timeoutMs ?? 30_000;

  for (let hop = 0; hop < 6; hop++) {
    assertAllowed(method, url);
    let res;
    try {
      res = await fetch(url, {
        ...init,
        method,
        headers,
        redirect: 'manual',
        signal: init.signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new NetError(e.name === 'TimeoutError' ? `timed out: ${url}` : `${e.message}: ${url}`, { code: 'network' });
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location') && method === 'GET') {
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    Object.defineProperty(res, 'finalUrl', { value: url });
    return res;
  }
  throw new NetError(`too many redirects: ${url}`, { code: 'redirects' });
}

export async function getText(url, { accept, timeoutMs, headers = {}, maxBytes = 5_000_000 } = {}) {
  const res = await doorFetch(url, { headers: { accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', ...headers }, timeoutMs });
  if (!res.ok) throw new NetError(`HTTP ${res.status}: ${url}`, { status: res.status, code: 'http' });
  const len = Number(res.headers.get('content-length') || 0);
  if (len > maxBytes) throw new NetError(`too large (${len} bytes): ${url}`, { code: 'too_large' });
  return { body: await res.text(), finalUrl: res.finalUrl || url, contentType: res.headers.get('content-type') || '' };
}

export async function getJson(url, { headers = {}, timeoutMs } = {}) {
  const res = await doorFetch(url, { headers: { accept: 'application/json', ...headers }, timeoutMs });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* the status says enough */
  }
  if (!res.ok) {
    const reason = body?.error?.message || (typeof body?.error === 'string' ? body.error : null) || body?.message || `HTTP ${res.status}`;
    throw Object.assign(new NetError(String(reason).slice(0, 300), { status: res.status, code: 'http' }), { body });
  }
  return body;
}

export async function postJson(url, payload, { headers = {}, timeoutMs } = {}) {
  const res = await doorFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(payload),
    timeoutMs,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* the status says enough */
  }
  if (!res.ok) {
    const err = body?.error && typeof body.error === 'object' ? body.error : body;
    throw Object.assign(new NetError(String(err?.message || (typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`)).slice(0, 300), { status: res.status, code: err?.code || 'http' }), { body });
  }
  return body;
}

export async function getBytes(url, { maxBytes = 12_000_000, timeoutMs, headers = {} } = {}) {
  const res = await doorFetch(url, { headers, timeoutMs });
  if (!res.ok) throw new NetError(`HTTP ${res.status}: ${url}`, { status: res.status, code: 'http' });
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\//.test(type)) throw new NetError(`not an image (${type}): ${url}`, { code: 'type' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new NetError(`too large (${buf.length} bytes): ${url}`, { code: 'too_large' });
  return { buf, type };
}
