import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { assetsDir, dataDir } from '../core/paths.js';
import { now, nowIso } from '../core/clock.js';
import { addDays, israelDate } from '../schedule/israel.js';
import { audit } from '../core/store.js';
import { bootstrapOwner, checkPassword, clientIp, cookies, createLimiter, csrfFor, csrfOk, isHttps, makeSession, sessionCookie, sessionFrom, sessionSecret, sessionUser } from './auth.js';
import * as data from './data.js';
import * as pages from './pages.js';
import * as act from './actions.js';
import { onboardingRoutes } from './onboarding.js';
import { loadPost } from '../pipeline/build.js';
import { lockedStyle } from '../render/style.js';
import { latestNotification } from '../notify/index.js';

// The website. It listens on 127.0.0.1 only; on the VPS, Caddy holds the
// certificate and passes requests to it.
//
// THE CHECKS, IN ORDER, ON EVERY REQUEST:
//   - the Host header is ours (defeats DNS rebinding)
//   - a request under the public name came over HTTPS, which only the proxy on
//     this machine can say
//   - every page, image and button needs a session, except the login page and
//     the static files
//   - every POST carries the CSRF token derived from its session, and an Origin
//     that is ours
// Server-rendered HTML with one small script; everything works without it.

export const HOST = '127.0.0.1';
const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const V = Date.now().toString(36);

const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function send(req, res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'content-security-policy': CSP, ...extra };
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  if (buf.length > 1024 && /gzip/.test(String(req.headers['accept-encoding'] || '')) && /text|json|javascript|svg|font/.test(type)) {
    buf = gzipSync(buf);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const json = (req, res, status, obj, extra) => send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const redirect = (res, to, extra = {}) => {
  res.writeHead(303, { location: to, 'cache-control': 'no-store', ...extra });
  res.end();
};

async function readForm(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

/** accounts.css: each account's own colour as --acc, so pages need no inline style. */
function accountsCss(ctx) {
  return ctx.packs.map((p) => `.acc-${p.id.replace(/[^a-z0-9-]/g, '')}{--acc:${/^#[0-9a-f]{3,8}$/i.test(p.theme.colors.accent) ? p.theme.colors.accent : '#888'}}`).join('\n');
}

const flash = (msg) => `of_flash=${encodeURIComponent(String(msg).slice(0, 200))}; Path=/; Max-Age=20; SameSite=Strict`;

/** Today and a year from today, Israel time, for the facts form's defaults. */
const factDates = () => {
  const today = israelDate(now());
  return { today, nextYear: addDays(today, 365) };
};

export function createHandler(ctx, { port, env = process.env, limiter = createLimiter(), failDelayMs = 400 } = {}) {
  const secret = sessionSecret(env);
  const publicHost = String(env.PUBLIC_HOST || '').trim().toLowerCase() || null;
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, ...(publicHost ? [publicHost] : [])]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(publicHost ? [`https://${publicHost}`] : [])]);
  bootstrapOwner(ctx.db, env);

  const ROUTES = [
    ['POST', /^\/post\/([\w-]+)\/approve$/, (u, m) => act.approve(ctx, u, { id: m[1] })],
    ['POST', /^\/post\/([\w-]+)\/unapprove$/, (u, m) => act.unapprove(ctx, u, { id: m[1] })],
    ['POST', /^\/post\/([\w-]+)\/reject$/, (u, m, f) => act.reject(ctx, u, { id: m[1] }, f)],
    ['POST', /^\/post\/([\w-]+)\/edit$/, (u, m, f) => act.edit(ctx, u, { id: m[1] }, f)],
    ['POST', /^\/post\/([\w-]+)\/publish-now$/, (u, m) => act.publishNow(ctx, u, { id: m[1] })],
    ['POST', /^\/post\/([\w-]+)\/takedown$/, (u, m, f) => act.takedown(ctx, u, { id: m[1] }, f)],
    ['POST', /^\/post\/([\w-]+)\/image-ok$/, (u, m) => act.imageOk(ctx, u, { id: m[1] })],
    ['POST', /^\/takedowns\/(\d+)\/deleted$/, (u, m, f) => act.takedownDeleted(ctx, u, { id: m[1] }, f)],
    ['POST', /^\/accounts\/([\w-]+)\/mode$/, (u, m, f) => act.setMode(ctx, u, { id: m[1] }, f)],
    ['POST', /^\/accounts\/([\w-]+)\/style$/, (u, m) => act.applyStyle(ctx, u, { id: m[1] })],
    ['POST', /^\/accounts\/([\w-]+)\/kill$/, (u, m) => act.killAccount(ctx, u, { id: m[1] })],
    ['POST', /^\/accounts\/([\w-]+)\/resume$/, (u, m) => act.resume(ctx, u, { id: m[1] })],
    ['POST', /^\/settings\/kill$/, (u, m, f) => act.globalKill(ctx, u, {}, f)],
    ['POST', /^\/settings\/budget$/, (u, m, f) => act.setBudget(ctx, u, {}, f)],
    ['POST', /^\/settings\/generate-at$/, (u, m, f) => act.setGenerateAt(ctx, u, {}, f)],
    ['POST', /^\/sources\/(\d+)\/approve$/, (u, m, f) => act.sourceStatus(ctx, u, { id: m[1] }, f, 'approved')],
    ['POST', /^\/sources\/(\d+)\/remove$/, (u, m, f) => act.sourceStatus(ctx, u, { id: m[1] }, f, 'removed')],
    ['POST', /^\/sources\/add$/, (u, m, f) => act.addSource(ctx, u, {}, f)],
    ['POST', /^\/sources\/catalog$/, (u, m, f) => act.addCatalogSource(ctx, u, {}, f)],
    ['POST', /^\/facts\/add$/, (u, m, f) => act.addFact(ctx, u, {}, f)],
    ['POST', /^\/facts\/confirm$/, (u, m, f) => act.confirmFact(ctx, u, {}, f)],
    ['POST', /^\/facts\/remove$/, (u, m, f) => act.removeFactAction(ctx, u, {}, f)],
    ['POST', /^\/rivals\/save$/, (u, m, f) => act.saveRivalAction(ctx, u, {}, f)],
    ['POST', /^\/rivals\/remove$/, (u, m, f) => act.removeRivalAction(ctx, u, {}, f)],
    ['POST', /^\/sounds\/save$/, (u, m, f) => act.saveSoundAction(ctx, u, {}, f)],
    ['POST', /^\/sounds\/remove$/, (u, m, f) => act.removeSoundAction(ctx, u, {}, f)],
    ['POST', /^\/push\/subscribe$/, (u, m, f) => act.subscribePush(ctx, u, {}, f)],
    ['POST', /^\/push\/unsubscribe$/, (u, m, f) => act.unsubscribePush(ctx, u, {}, f)],
    ['POST', /^\/post\/([\w-]+)\/old-drafts-deleted$/, (u, m) => act.oldDraftsDeleted(ctx, u, { id: m[1] })],
    ...onboardingRoutes(ctx),
  ];

  return async function handler(req, res) {
    try {
      const host = String(req.headers.host || '').toLowerCase();
      if (!hosts.has(host)) return send(req, res, 421, 'wrong host', 'text/plain; charset=utf-8');
      const secure = isHttps(req);
      if (publicHost && host === publicHost && !secure) return send(req, res, 403, 'HTTPS only', 'text/plain; charset=utf-8');
      const url = new URL(req.url, `http://${host}`);
      const p = decodeURIComponent(url.pathname);
      const jar = cookies(req);
      const theme = ['dark', 'light'].includes(jar.of_theme) ? jar.of_theme : null;

      // ---- static, no session
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (p === '/static/style.css') return send(req, res, 200, readFileSync(path.join(STATIC, 'style.css')), 'text/css; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
        if (p === '/static/app.js') return send(req, res, 200, readFileSync(path.join(STATIC, 'app.js')), 'text/javascript; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
        if (p === '/static/icon.svg') return send(req, res, 200, readFileSync(path.join(STATIC, 'icon.svg')), 'image/svg+xml', { 'cache-control': 'public, max-age=86400' });
        if (p === '/static/icon-180.png' || p === '/static/icon-512.png') return send(req, res, 200, readFileSync(path.join(STATIC, path.basename(p))), 'image/png', { 'cache-control': 'public, max-age=86400' });
        if (p === '/static/manifest.webmanifest') return send(req, res, 200, readFileSync(path.join(STATIC, 'manifest.webmanifest')), 'application/manifest+json; charset=utf-8', { 'cache-control': 'public, max-age=86400' });
        if (p === '/static/fonts/Assistant.ttf') return send(req, res, 200, readFileSync(path.join(assetsDir, 'fonts', 'Assistant.ttf')), 'font/ttf', { 'cache-control': 'public, max-age=31536000, immutable' });
        if (p === '/healthz') return send(req, res, 200, 'ok', 'text/plain; charset=utf-8');
        // The service worker, from the root so its scope is the whole site.
        if (p === '/sw.js') return send(req, res, 200, readFileSync(path.join(STATIC, 'sw.js')), 'text/javascript; charset=utf-8', { 'cache-control': 'no-cache', 'service-worker-allowed': '/' });
      }

      // ---- login
      if (p === '/login') {
        if (req.method === 'POST') {
          const ip = clientIp(req);
          const wait = limiter.check(ip);
          if (wait) return send(req, res, 429, pages.loginPage({ error: `יותר מדי ניסיונות. נסו שוב בעוד ${Math.ceil(wait / 60)} דקות.`, theme }), 'text/html; charset=utf-8', { 'retry-after': String(wait) });
          const origin = req.headers.origin;
          if (origin && !origins.has(origin)) return send(req, res, 403, 'cross-origin', 'text/plain; charset=utf-8');
          const form = await readForm(req, 4000);
          const user = ctx.db.get('SELECT * FROM users WHERE name = ?', String(form.user || '').trim());
          if (user && checkPassword(form.password || '', user.password_hash)) {
            limiter.succeed(ip);
            ctx.db.update('users', user.id, { last_login_at: nowIso() });
            audit(ctx.db, { actor: user.name, action: 'login' });
            return redirect(res, '/', { 'set-cookie': sessionCookie(makeSession(user.id, secret), { secure }) });
          }
          limiter.fail(ip);
          await new Promise((r) => setTimeout(r, failDelayMs));
          const none = !ctx.db.get('SELECT COUNT(*) AS n FROM users').n;
          return send(req, res, 401, pages.loginPage({ error: none ? 'עוד אין משתמש. הגדירו OF_ADMIN_PASSWORD ב-.env והפעילו מחדש, או הריצו npm run user:add.' : 'שם המשתמש או הסיסמה לא נכונים.', theme }));
        }
        return send(req, res, 200, pages.loginPage({ theme }));
      }

      // ---- everything else needs a session
      const session = sessionFrom(req);
      const uid = sessionUser(session, secret);
      const user = uid ? ctx.db.get('SELECT id, name, role FROM users WHERE id = ?', uid) : null;
      if (!user) {
        if (req.method !== 'GET') return json(req, res, 401, { ok: false, message: 'צריך להיכנס שוב.' });
        return redirect(res, '/login');
      }
      const csrf = csrfFor(session, secret);
      const ajax = req.headers['x-of-ajax'] === '1';

      // ---- the account shown. Every page is one account's; the switcher at the top changes it, and a link that names
      // one (a post, ?account=) switches to that one. A cookie keeps it.
      const acctCookie = (id) => `of_acct=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure ? '; Secure' : ''}`;
      const setCookies = [];
      const firstLive = () => ctx.packs.find((x) => ctx.db.get('SELECT status FROM accounts WHERE id = ?', x.id)?.status !== 'onboarding') || ctx.packs[0] || null;
      let current = ctx.pack(jar.of_acct) || firstLive();
      const switchTo = (pack) => {
        if (!pack) return;
        current = pack;
        if (jar.of_acct !== pack.id) setCookies.push(acctCookie(pack.id));
      };

      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !origins.has(origin)) return json(req, res, 403, { ok: false, message: 'בקשה מאתר אחר נחסמה.' });
        const form = await readForm(req);
        if (!csrfOk(form._csrf, session, secret)) return ajax ? json(req, res, 403, { ok: false, message: 'הדף ישן. רעננו אותו.' }) : send(req, res, 403, 'stale page, reload it', 'text/plain; charset=utf-8');
        if (p === '/logout') return redirect(res, '/login', { 'set-cookie': sessionCookie('', { secure, clear: true }) });
        // Developer mode: the settings a developer reads, opened by an owner from the version line, kept on this browser.
        if (p === '/settings/dev') {
          if (user.role !== 'owner') return ajax ? json(req, res, 403, { ok: false, message: 'רק הבעלים' }) : redirect(res, '/settings');
          const on = form.on === '1';
          const c = `of_dev=${on ? '1' : ''}; Path=/; Max-Age=${on ? 31536000 : 0}; SameSite=Strict; HttpOnly${secure ? '; Secure' : ''}`;
          if (on) audit(ctx.db, { actor: user.name, action: 'dev_mode' });
          return redirect(res, on ? '/settings#dev' : '/settings', { 'set-cookie': [c, flash(on ? 'מצב מפתח פתוח' : 'מצב מפתח כבוי')] });
        }
        if (p === '/account/switch') {
          const to = ctx.pack(String(form.to || ''));
          if (!to) return ajax ? json(req, res, 404, { ok: false, message: 'אין חשבון כזה' }) : redirect(res, '/');
          // Back to the same page of the other account; a post belongs to the account it was, so its page goes home.
          const ref = req.headers.referer && new URL(req.headers.referer).host === host ? new URL(req.headers.referer).pathname : '/';
          return redirect(res, /^\/post\//.test(ref) ? '/' : ref, { 'set-cookie': acctCookie(to.id) });
        }
        if (p === '/theme') {
          const next = theme === 'dark' ? 'light' : 'dark';
          const c = `of_theme=${next}; Path=/; Max-Age=31536000; SameSite=Strict`;
          return ajax ? json(req, res, 200, { ok: true, theme: next }, { 'set-cookie': c }) : redirect(res, req.headers.referer && new URL(req.headers.referer).host === host ? new URL(req.headers.referer).pathname : '/', { 'set-cookie': c });
        }
        for (const [method, re, fn] of ROUTES) {
          const m = method === 'POST' && re.exec(p);
          if (!m) continue;
          try {
            const r = await fn(user, m, form);
            ctx._plan = null; // a change can move the budget plan: the next page computes it afresh
            if (ajax) return json(req, res, 200, r);
            const back = r.redirect || (req.headers.referer && new URL(req.headers.referer).host === host ? new URL(req.headers.referer).pathname + new URL(req.headers.referer).search : '/');
            return redirect(res, back, { 'set-cookie': flash(r.message) });
          } catch (e) {
            if (!(e instanceof act.ActionError)) throw e;
            if (ajax) return json(req, res, e.status, { ok: false, message: e.message, problems: e.problems || [] });
            // A form that failed its checks comes back with the problems and what was typed.
            if (/\/edit$/.test(p)) {
              const d = data.postFull(ctx, m[1]);
              return send(req, res, e.status, pages.postPage({ ...pageCtx(), csrf }, d, { problems: e.problems || [e.message], values: e.values }));
            }
            if (p === '/sources/add') {
              const cur = ctx.pack(form.account) || ctx.packs[0];
              return send(req, res, e.status, pages.sourcesPage({ ...pageCtx(), csrf }, { packs: [cur], current: cur, sources: data.sourcesFor(ctx, cur.id), form, problems: e.problems || [e.message] }));
            }
            if (p === '/facts/add') {
              const cur = ctx.pack(form.account) || ctx.packs[0];
              return send(req, res, e.status, pages.factsPage({ ...pageCtx(), csrf }, { packs: [cur], current: cur, topics: data.factsFor(ctx, cur), ...factDates(), form, problems: e.problems || [e.message] }));
            }
            if (p === '/sounds/save') {
              const cur = ctx.pack(form.account) || ctx.packs[0];
              return send(req, res, e.status, pages.soundsPage({ ...pageCtx(), csrf }, { ...data.soundsFor(ctx, cur), packs: [cur], form, problems: e.problems || [e.message] }));
            }
            if (p === '/rivals/save') {
              const cur = ctx.pack(form.account) || ctx.packs[0];
              return send(req, res, e.status, pages.rivalsPage({ ...pageCtx(), csrf }, { ...data.rivalsFor(ctx, cur), packs: [cur], form, problems: e.problems || [e.message] }));
            }
            return redirect(res, req.headers.referer ? new URL(req.headers.referer).pathname : '/', { 'set-cookie': flash(e.message) });
          }
        }
        return json(req, res, 404, { ok: false, message: 'אין פעולה כזו' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'method not allowed', 'text/plain; charset=utf-8');

      // ---- media: a post's rendered slides, read only from inside the data folder
      const mm = /^\/media\/([\w-]+)\/(tiktok|instagram)\/(\d+)$/.exec(p);
      if (mm) {
        const post = loadPost(ctx.db, mm[1]);
        const file = post?.media?.[mm[2]]?.[Number(mm[3])];
        const root = path.resolve(ctx.mediaRoot || dataDir());
        if (!file || !path.resolve(file).startsWith(root) || !existsSync(file)) return send(req, res, 404, 'no such slide', 'text/plain; charset=utf-8');
        res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': statSync(file).size, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
        return createReadStream(file).pipe(res);
      }
      if (p === '/static/accounts.css') return send(req, res, 200, accountsCss(ctx), 'text/css; charset=utf-8', { 'cache-control': 'private, max-age=600' });

      const named = url.searchParams.get('account');
      if (named) switchTo(ctx.pack(named));
      const opened = /^\/post\/([\w-]+)$/.exec(p);
      if (opened) switchTo(ctx.pack(ctx.db.get('SELECT account_id FROM posts WHERE id = ?', opened[1])?.account_id));
      // What the pages read: the context seen from the account shown.
      const sc = data.scoped(ctx, current);
      const h = data.header(sc);
      const flashMsg = jar.of_flash ? decodeURIComponent(jar.of_flash) : null;
      if (flashMsg) setCookies.push('of_flash=; Path=/; Max-Age=0; SameSite=Strict');
      const clearFlash = setCookies.length ? { 'set-cookie': setCookies } : {};
      function pageCtx() {
        // The desk's sidebar, collapsed to its icons or not: a cookie the toggle sets, so the page arrives already in shape.
        return { csrf, user, theme, side: jar.of_side === 'mini' ? 'mini' : null, v: V, ...h, flash: flashMsg, dev: jar.of_dev === '1' && user.role === 'owner' };
      }
      const pc = pageCtx();
      const page = (html, status = 200) => send(req, res, status, flashMsg ? html.replace('<div id="toast" role="status" aria-live="polite"></div>', `<div id="toast" role="status" aria-live="polite" data-flash="${String(flashMsg).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}"></div>`) : html, 'text/html; charset=utf-8', clearFlash);

      if (p === '/') return page(pages.todayPage(pc, data.today(sc)));
      if (p === '/posts') return page(pages.postsPage(pc, data.today(sc)));
      const pm = /^\/post\/([\w-]+)$/.exec(p);
      if (pm) {
        const d = data.postFull(ctx, pm[1]);
        return d ? page(pages.postPage(pc, d)) : page(pages.notFoundPage(pc), 404);
      }
      if (p === '/accounts') return page(pages.accountsPage(pc, data.accountRows(sc).map((r) => ({ ...r, week: data.week(ctx, r.pack.id), style: lockedStyle(ctx.db, r.pack, ctx.packs) }))));
      if (p === '/results') return page(pages.resultsPage(pc, data.results(sc)));
      const cur = current;
      if (p === '/sources') {
        if (!cur) return page(pages.notFoundPage(pc), 404);
        return page(pages.sourcesPage(pc, { packs: sc.packs, current: cur, sources: data.sourcesFor(ctx, cur.id) }));
      }
      if (p === '/settings') return page(pages.settingsPage(pc, data.settingsData(sc)));
      if (p === '/facts') {
        if (!cur) return page(pages.notFoundPage(pc), 404);
        return page(pages.factsPage(pc, { packs: sc.packs, current: cur, topics: data.factsFor(ctx, cur), ...factDates() }));
      }
      if (p === '/sounds') {
        if (!cur) return page(pages.notFoundPage(pc), 404);
        return page(pages.soundsPage(pc, { ...data.soundsFor(ctx, cur), packs: sc.packs }));
      }
      // The service worker asks what to show for a push it was woken by.
      if (p === '/notifications/latest.json') return json(req, res, 200, latestNotification(ctx.db) || {});
      if (p === '/rivals') {
        if (!cur) return page(pages.notFoundPage(pc), 404);
        return page(pages.rivalsPage(pc, { ...data.rivalsFor(ctx, cur), packs: sc.packs }));
      }
      if (p === '/more') return page(pages.morePage(pc));
      for (const [method, re, fn] of ROUTES) {
        const m = method === 'GET' && re.exec(p);
        if (m) return page(await fn(user, m, Object.fromEntries(url.searchParams), pc));
      }
      return page(pages.notFoundPage(pc), 404);
    } catch (e) {
      // The stack goes to the log, never to the page.
      ctx.log?.(`[web] ${req.method} ${req.url}: ${e.stack || e.message}`);
      const status = e.status || 500;
      return send(req, res, status, status === 500 ? 'משהו השתבש. הפרטים ביומן.' : String(e.message), 'text/plain; charset=utf-8');
    }
  };
}

export function listen(ctx, { port = Number(process.env.PORT) || 4700, env = process.env } = {}) {
  let inner = null;
  const server = createServer((req, res) => inner(req, res));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      inner = createHandler(ctx, { port: actual, env });
      resolve({ server, port: actual });
    });
  });
}
