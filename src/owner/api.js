import { createServer } from 'node:http';
import { loadPost } from '../pipeline/build.js';
import { linesOf } from '../rules/overlay.js';
import * as act from '../web/actions.js';
import { forWorkspace, owns } from '../web/workspace.js';
import { assistantSecret, verify } from './sign.js';
import { bundle, full, inList, listed, slideOf, status } from './view.js';

// Teder's internal listener for the owner line (docs/internal-assistant.md): openfrequency-toran asks about a
// workspace's posts and acts on them for the owner who wrote on WhatsApp. A separate listener on 127.0.0.1, in the
// same process as the site, never behind Caddy.
//
// THE CHECKS, IN ORDER, ON EVERY REQUEST:
//   - it came straight from this machine: a loopback socket, a Host of 127.0.0.1 or localhost on our port, and no
//     X-Forwarded-For (or Forwarded), which only a proxy adds (403 not_local)
//   - OF_ASSISTANT_SECRET is set, 32 characters or more (503 not_configured)
//   - it is signed with it, now (401 stale, 401 bad_signature: src/owner/sign.js)
//   - it names a workspace that has a Teder account (404 no_teder), and works on that workspace's context
//     (src/web/workspace.js): another workspace's post is 404 not_found, the same answer as one that never was
//
// Toran is trusted to say which workspace and which person: it holds the secret, and it knows a phone number as one
// user of one workspace (openfrequency-accounts). Every change names the person (`actor`, e.g. wa:972500000123),
// and is recorded as theirs: approved_by, the edits, the post's trace and the audit log. The buttons are the
// dashboard's own (src/web/actions.js), so a post approved, rejected or edited from WhatsApp is changed exactly as
// one clicked on the website.

export const HOST = '127.0.0.1';
const PREFIX = '/internal/assistant/';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_BODY = 64 * 1024;
const STATUSES = ['drafting', 'blocked', 'queued', 'approved', 'rejected', 'expired', 'publishing', 'published', 'failed'];
/** The posts the owner may still reject or edit, as on the dashboard (a sample is the operator's). */
const OPEN = ['queued', 'approved'];
/** Why a post is rejected, as Toran names it, and as the post keeps it. */
export const REJECT_REASONS = { topic: 'הנושא לא מתאים', shorter: 'ארוך מדי', tone: 'הטון לא נכון', photo: 'התמונות לא מתאימות', other: 'משהו אחר' };

class ApiError extends Error {
  constructor(status, error, extra = {}) {
    super(error);
    Object.assign(this, { status, error, extra });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new ApiError(413, 'too_large');
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The workspace a request is about, as its context. */
function workspaceCtx(ctx, raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, 'bad_workspace');
  const w = forWorkspace(ctx, id);
  if (!w.packs.length) throw new ApiError(404, 'no_teder');
  return w;
}

const mustPost = (w, id) => {
  const post = loadPost(w.db, id);
  if (!post || !owns(w, post.account_id) || post.sample) throw new ApiError(404, 'not_found');
  return post;
};

/** Who asked, as the dashboard's actions take a person. */
function actorOf(body) {
  const a = String(body.actor ?? '').trim();
  if (!a || a.length > 80 || /[\r\n]/.test(a)) throw new ApiError(400, 'bad_actor');
  return { id: null, name: a, email: null, role: 'assistant', operator: false, readOnly: false };
}

/** A dashboard refusal, in the API's words. */
function fromAction(e) {
  if (!(e instanceof act.ActionError)) throw e;
  if (e.status === 404) throw new ApiError(404, 'not_found');
  if (e.status === 422) throw new ApiError(422, 'failed_checks', { problems: e.problems || [e.message] });
  throw new ApiError(409, 'not_pending');
}

/**
 * The form the dashboard's edit sends (src/web/pages.js postPage), with one line changed: `slide` and `line` are
 * 1-based; line 1 is the title (the cover's is the cover line), line k is the body's line k-1 (the cover's is the
 * line under it). Only what the dashboard edits can be changed: the cover and the content slides.
 */
export function editForm(post, { slide, line, text }) {
  const s = Number(slide);
  const l = Number(line);
  const target = Number.isInteger(s) ? post.slides[s - 1] : null;
  const value = String(text ?? '').replace(/\r/g, '').trim();
  if (!target || !Number.isInteger(l) || l < 1 || !['cover', 'item'].includes(target.kind) || !value || /\n/.test(value)) throw new ApiError(400, 'bad_line');
  const form = { hook: post.hook || '', sub: post.sub || '', caption: post.caption || '' };
  if (post.caption_ig) form.caption_short = post.data?.captionShort || '';
  let item = -1;
  let at = null;
  post.slides.forEach((x, i) => {
    if (x.kind !== 'item') return;
    item++;
    form[`title_${item}`] = x.title || '';
    form[`body_${item}`] = x.body || '';
    if (i === s - 1) at = item;
  });
  const swap = (body) => {
    const lines = linesOf(body);
    if (l - 1 > lines.length) throw new ApiError(400, 'bad_line');
    lines[l - 2] = value;
    return lines.join('\n');
  };
  if (target.kind === 'cover') {
    if (l === 1) form.hook = value;
    else form.sub = swap(form.sub);
  } else if (l === 1) form[`title_${at}`] = value;
  else form[`body_${at}`] = swap(form[`body_${at}`]);
  return form;
}

/** The handler. `env` is read for the secret on every request, so setting it needs no restart of the routes. */
export function createInternalHandler(ctx, { port, env = process.env } = {}) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const opts = () => ({ env });

  const ROUTES = [
    ['GET', /^\/internal\/assistant\/status$/, (q) => status(workspaceCtx(ctx, q.get('workspace')))],
    [
      'GET', /^\/internal\/assistant\/posts$/,
      (q) => {
        const w = workspaceCtx(ctx, q.get('workspace'));
        const want = q.get('status') || 'queued';
        if (!STATUSES.includes(want)) throw new ApiError(400, 'bad_status');
        const ids = w.packs.map((p) => p.id);
        const rows = w.db.all(`SELECT id FROM posts WHERE account_id IN (${inList(ids)}) AND status = ? AND sample = 0 ORDER BY slot_at IS NULL, slot_at, created_at LIMIT 100`, ...ids, want);
        return { posts: rows.map((r) => listed(w, loadPost(w.db, r.id), opts())) };
      },
    ],
    ['GET', /^\/internal\/assistant\/posts\/([\w-]+)$/, (q, m) => {
      const w = workspaceCtx(ctx, q.get('workspace'));
      return { post: full(w, mustPost(w, m[1]), opts()) };
    }],
    ['GET', /^\/internal\/assistant\/posts\/([\w-]+)\/bundle$/, (q, m) => {
      const w = workspaceCtx(ctx, q.get('workspace'));
      return bundle(w, mustPost(w, m[1]), opts());
    }],
    [
      'POST', /^\/internal\/assistant\/posts\/([\w-]+)\/approve$/,
      (b, m) => {
        const w = workspaceCtx(ctx, b.workspace);
        const user = actorOf(b);
        const post = mustPost(w, m[1]);
        if (post.status !== 'queued') throw new ApiError(409, 'not_pending');
        try {
          act.approve(w, user, { id: post.id });
        } catch (e) {
          fromAction(e);
        }
        return { post: { id: post.id, status: loadPost(w.db, post.id).status } };
      },
    ],
    [
      'POST', /^\/internal\/assistant\/posts\/([\w-]+)\/reject$/,
      (b, m) => {
        const w = workspaceCtx(ctx, b.workspace);
        const user = actorOf(b);
        if (!Object.hasOwn(REJECT_REASONS, String(b.reason))) throw new ApiError(400, 'bad_reason');
        const post = mustPost(w, m[1]);
        if (!OPEN.includes(post.status)) throw new ApiError(409, 'not_pending');
        try {
          act.reject(w, user, { id: post.id }, { reason: REJECT_REASONS[b.reason], note: String(b.note ?? '').slice(0, 300) });
        } catch (e) {
          fromAction(e);
        }
        // The dashboard's reject writes no replacement and counts no redos: Teder has no monthly plan of them yet.
        return { post: { id: post.id, status: loadPost(w.db, post.id).status }, replacement: null, redosLeft: null };
      },
    ],
    [
      'POST', /^\/internal\/assistant\/posts\/([\w-]+)\/edit$/,
      async (b, m) => {
        const w = workspaceCtx(ctx, b.workspace);
        const user = actorOf(b);
        const post = mustPost(w, m[1]);
        if (!OPEN.includes(post.status)) throw new ApiError(409, 'not_pending');
        const form = editForm(post, b);
        try {
          await act.edit(w, user, { id: post.id }, form);
        } catch (e) {
          fromAction(e);
        }
        const after = loadPost(w.db, post.id);
        return { post: listed(w, after, opts()), slide: slideOf(after, Number(b.slide) - 1, opts()) };
      },
    ],
  ];

  const handler = async function handler(req, res) {
    try {
      const forwarded = req.headers['x-forwarded-for'] != null || req.headers.forwarded != null;
      if (!LOOPBACK.has(req.socket?.remoteAddress) || forwarded || !hosts.has(String(req.headers.host || '').toLowerCase())) throw new ApiError(403, 'not_local');
      const secret = assistantSecret(env);
      if (!secret) throw new ApiError(503, 'not_configured');
      const body = await readBody(req);
      const v = verify(secret, { headers: req.headers, method: req.method, path: req.url, body });
      if (!v.ok) throw new ApiError(401, v.error);
      const url = new URL(req.url, `http://${HOST}`);
      if (!url.pathname.startsWith(PREFIX)) throw new ApiError(404, 'not_found');
      for (const [method, re, fn] of ROUTES) {
        const m = re.exec(url.pathname);
        if (!m) continue;
        if (req.method !== method) throw new ApiError(405, 'method_not_allowed');
        let input = url.searchParams;
        if (method === 'POST') {
          try {
            input = JSON.parse(body || '{}');
          } catch {
            throw new ApiError(400, 'bad_json');
          }
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'bad_json');
        }
        const out = await fn(input, m);
        if (method === 'POST') ctx._plan = null; // as after a click: the next page computes the budget plan afresh
        return send(res, 200, out);
      }
      throw new ApiError(404, 'not_found');
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.error, ...e.extra });
      // The stack goes to the log, never to the answer.
      ctx.log?.(`[internal] ${req.method} ${req.url}: ${e.stack || e.message}`);
      return send(res, 500, { error: 'internal' });
    }
  };
  handler.routes = ROUTES.map(([method, re]) => [method, re]);
  return handler;
}

/** Listen on 127.0.0.1:TEDER_INTERNAL_PORT (default 4701). Resolves to { server, port, handler }. */
export function listenInternal(ctx, { port = Number(process.env.TEDER_INTERNAL_PORT) || 4701, env = process.env } = {}) {
  let inner = null;
  const server = createServer((req, res) => inner(req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      inner = createInternalHandler(ctx, { port: actual, env });
      resolve({ server, port: actual, handler: inner });
    });
  });
}
