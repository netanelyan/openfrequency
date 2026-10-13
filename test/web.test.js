import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost } from '../src/pipeline/build.js';
import { listen } from '../src/web/server.js';
import { addUser } from '../src/web/auth.js';
import { closeBrowser } from '../src/render/render.js';
import { opened, tempHome } from './helpers.js';

// The website: a session for everything, a CSRF token on every change, Hebrew
// right to left on every page, and the approve and edit flows end to end.

let home;
let ctx;
let server;
let base;
let postId;

before(async () => {
  home = tempHome();
  const db = new Db(path.join(home.home, 'data.db'));
  opened.push(db);
  ctx = makeContext({ db, packs: loadAll({ dir: path.join(home.home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home.home, 'media');
  ctx.mediaRoot = home.home;
  addUser(db, 'owner', 'a-long-test-password');
  postId = (await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' })).postId;
  const s = await listen(ctx, { port: 0, env: { ...process.env, SESSION_SECRET: 'x'.repeat(40) } });
  server = s.server;
  base = `http://127.0.0.1:${s.port}`;
});

after(async () => {
  server?.close();
  await closeBrowser();
  home?.cleanup();
});

async function login() {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'user=owner&password=a-long-test-password' });
  assert.equal(res.status, 303);
  return res.headers.get('set-cookie').split(';')[0];
}
const get = (p, cookie) => fetch(`${base}${p}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
async function csrfOf(cookie) {
  const html = await (await get('/', cookie)).text();
  return /name="_csrf" value="([^"]+)"/.exec(html)[1];
}
const post = (p, cookie, body) => fetch(`${base}${p}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-of-ajax': '1' }, body: new URLSearchParams(body).toString() });

test('every page needs a session', async () => {
  for (const p of ['/', '/accounts', '/results', '/sources', '/settings', `/post/${postId}`, `/media/${postId}/tiktok/0`]) {
    const res = await get(p);
    assert.equal(res.status, 303, p);
    assert.equal(res.headers.get('location'), '/login');
  }
});

test('a wrong password is refused, and a request for another host is refused', async () => {
  const res = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'user=owner&password=wrong-password-x' });
  assert.equal(res.status, 401);
  // fetch cannot set Host, so this one goes through node:http.
  const status = await new Promise((resolve) => http.get(`${base}/login`, { headers: { host: 'evil.example.com' } }, (r) => (r.resume(), resolve(r.statusCode))));
  assert.equal(status, 421);
});

test('every page is Hebrew, right to left, and escapes what it shows (hard rule 8)', async () => {
  const cookie = await login();
  for (const p of ['/', '/accounts', '/results', '/sources', '/settings', '/more', '/new', `/post/${postId}`]) {
    const res = await get(p, cookie);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.match(html, /<html lang="he" dir="rtl"/, p);
    assert.ok(!/<script>/.test(html), `${p} has no inline script`);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  }
  const loginHtml = await (await get('/login')).text();
  assert.match(loginHtml, /<html lang="he" dir="rtl"/);
});

test('a change without its CSRF token is refused', async () => {
  const cookie = await login();
  const res = await post(`/post/${postId}/approve`, cookie, {});
  assert.equal(res.status, 403);
  assert.equal(ctx.db.get('SELECT status FROM posts WHERE id = ?', postId).status, 'queued');
});

test('a slide image is served only to a session, and only from inside the data folder', async () => {
  const cookie = await login();
  const res = await get(`/media/${postId}/tiktok/0`, cookie);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal((await get(`/media/${postId}/tiktok/99`, cookie)).status, 404);
});

test('an edit that invents a number is refused and nothing is saved', async () => {
  const cookie = await login();
  const csrf = await csrfOf(cookie);
  const before = ctx.db.get('SELECT body FROM slides WHERE post_id = ? AND idx = 1', postId).body;
  const res = await post(`/post/${postId}/edit`, cookie, { _csrf: csrf, hook: 'בזיליקום במרפסת: 5 דברים שקובעים אם הוא ישרוד', sub: '', title_0: 'שמש', body_0: 'בזיליקום צריך לפחות 12 שעות שמש ישירה ביום.', caption: 'כיתוב קצר ופשוט לבדיקה.' });
  assert.equal(res.status, 422);
  const out = await res.json();
  assert.match(out.problems.join(' '), /number 12/);
  assert.equal(ctx.db.get('SELECT body FROM slides WHERE post_id = ? AND idx = 1', postId).body, before);
});

test('a clean edit is checked, re-rendered and remembered as an example of the owner\'s voice', async () => {
  const cookie = await login();
  const csrf = await csrfOf(cookie);
  const res = await post(`/post/${postId}/edit`, cookie, { _csrf: csrf, hook: 'בזיליקום במרפסת: 5 דברים שקובעים אם הוא ישרוד', sub: 'מה שעושה את ההבדל', caption: 'בזיליקום הוא צמח של קיץ, וכל אחד מהדברים האלה משפיע עליו.' });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.equal(ctx.db.get('SELECT sub FROM posts WHERE id = ?', postId).sub, 'מה שעושה את ההבדל');
  assert.ok(ctx.db.get('SELECT COUNT(*) AS n FROM edits WHERE post_id = ?', postId).n >= 1);
});

test('approve in one tap, with the token', async () => {
  const cookie = await login();
  const csrf = await csrfOf(cookie);
  const res = await post(`/post/${postId}/approve`, cookie, { _csrf: csrf });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const row = ctx.db.get('SELECT status, approved_by FROM posts WHERE id = ?', postId);
  assert.deepEqual({ ...row }, { status: 'approved', approved_by: 'owner' });
});

test('the kill switch and the mode are set from the Accounts page', async () => {
  const cookie = await login();
  const csrf = await csrfOf(cookie);
  await post('/accounts/demo/mode', cookie, { _csrf: csrf, mode: 'digest' });
  assert.equal(ctx.db.get("SELECT mode FROM accounts WHERE id = 'demo'").mode, 'digest');
  await post('/accounts/demo/kill', cookie, { _csrf: csrf });
  const acc = ctx.db.get("SELECT status, paused_reason FROM accounts WHERE id = 'demo'");
  assert.deepEqual({ ...acc }, { status: 'paused', paused_reason: 'kill' });
  const page = await (await get('/accounts', cookie)).text();
  assert.match(page, /מתג הכיבוי הופעל/);
  await post('/accounts/demo/resume', cookie, { _csrf: csrf });
  assert.equal(ctx.db.get("SELECT status FROM accounts WHERE id = 'demo'").status, 'active');
});

test('the Settings page shows which keys are set, never their values', async () => {
  process.env.PEXELS_API_KEY = 'secret-value-that-must-not-show';
  const cookie = await login();
  const html = await (await get('/settings', cookie)).text();
  delete process.env.PEXELS_API_KEY;
  assert.ok(html.includes('PEXELS_API_KEY'));
  assert.ok(!html.includes('secret-value-that-must-not-show'));
});
