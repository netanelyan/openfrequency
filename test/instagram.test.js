import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost, loadPost } from '../src/pipeline/build.js';
import { publishPost, publisherFor } from '../src/publish/index.js';
import { currentToken, insights, publishInstagram, refreshToken, AI_LINE } from '../src/publish/instagram.js';
import { collectMetrics } from '../src/metrics/collect.js';
import { postScore } from '../src/formats/rotation.js';
import { getSetting } from '../src/core/store.js';
import { closeBrowser } from '../src/render/render.js';
import { israelInstant } from '../src/schedule/israel.js';
import { copyPack, opened, tempHome } from './helpers.js';

// Instagram, directly through Meta's Graph API. The network is a stub under the
// engine's own door: every request still passes the door's rules, so a call the
// rules refuse fails here exactly as it would live.

after(() => closeBrowser());
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ['PUBLISH_MODE', 'IG_TOKEN_DEMO', 'MEDIA_PUBLIC_BASE_URL']) delete process.env[k];
});

/** A fake Graph API. `answer(method, url, params)` returns a body or throws { code, subcode }. Records every call. */
function stubGraph(answer) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const params = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : Object.fromEntries(u.searchParams);
    calls.push({ method: init.method || 'GET', path: u.pathname, params, url: String(url) });
    try {
      return new Response(JSON.stringify(answer(init.method || 'GET', u, params)), { status: 200, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: e.message, code: e.code, error_subcode: e.subcode } }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
  };
  return calls;
}

/** Meta's carousel flow, honestly: containers, their status, the carousel, publish. */
function carouselApi({ publishFails = null, containerState = 'FINISHED' } = {}) {
  let n = 0;
  const published = new Set();
  return (method, u, p) => {
    const parts = u.pathname.split('/').filter(Boolean);
    if (method === 'POST' && parts.at(-1) === 'media') return { id: p.media_type === 'CAROUSEL' ? '17900000000000009' : `1790000000000000${++n}` };
    if (method === 'POST' && parts.at(-1) === 'media_publish') {
      published.add(p.creation_id);
      if (publishFails) throw Object.assign(new Error('Application request limit reached'), publishFails);
      return { id: '18000000000000001' };
    }
    if (method === 'GET' && p.fields === 'status_code,status') return { status_code: containerState };
    if (method === 'GET' && p.fields === 'status_code') return { status_code: published.has(parts.at(-1)) ? 'PUBLISHED' : 'FINISHED' };
    if (method === 'GET' && p.fields === 'permalink') return { permalink: 'https://www.instagram.com/p/abc/' };
    throw Object.assign(new Error(`unexpected ${method} ${u.pathname}`), { code: 100 });
  };
}

const pack = (over = {}) => ({ id: 'demo', meta: { instagram: { userId: '17841400000000001', auth: 'facebook', ...over } } });
const urls = ['https://media.example.com/x/1.jpg', 'https://media.example.com/x/2.jpg', 'https://media.example.com/x/3.jpg'];

test('a post is published as one carousel: a container per slide in order, the carousel, then publish', async () => {
  const db = new Db(':memory:');
  process.env.IG_TOKEN_DEMO = 'tok-123';
  const calls = stubGraph(carouselApi());
  const r = await publishInstagram(db, pack(), { caption: 'כיתוב', imageUrls: urls, aiLabel: true });
  assert.deepEqual(r, { via: 'instagram', mediaId: '18000000000000001', creationId: '17900000000000009', url: 'https://www.instagram.com/p/abc/', status: 'published' });
  const posts = calls.filter((c) => c.method === 'POST');
  assert.deepEqual(posts.map((c) => c.path), ['/v25.0/17841400000000001/media', '/v25.0/17841400000000001/media', '/v25.0/17841400000000001/media', '/v25.0/17841400000000001/media', '/v25.0/17841400000000001/media_publish']);
  assert.deepEqual(posts.slice(0, 3).map((c) => c.params.image_url), urls, 'the slides in order');
  assert.ok(posts.slice(0, 3).every((c) => c.params.is_carousel_item === 'true'));
  assert.equal(posts[3].params.children, '17900000000000001,17900000000000002,17900000000000003');
  assert.ok(posts[3].params.caption.endsWith(AI_LINE), 'an AI image is disclosed in the caption (hard rule 4)');
  assert.ok(posts.every((c) => !c.url.includes('tok-123')), 'a write carries the token in its body, never in its URL');
});

test('a publish Meta reports as failed but that went up is not published twice', async () => {
  const db = new Db(':memory:');
  process.env.IG_TOKEN_DEMO = 'tok';
  let calls = stubGraph(carouselApi({ publishFails: { code: 4, subcode: 2207051 } }));
  const r = await publishInstagram(db, pack(), { caption: 'c', imageUrls: urls });
  assert.equal(r.status, 'published', 'the container says it is a post: so it is one');
  // A retry that carries the last attempt's container asks it first and creates nothing.
  calls = stubGraph(carouselApi());
  globalThis.fetch = ((inner) => async (url, init) => {
    const u = new URL(url);
    if (u.searchParams.get('fields') === 'status_code') return new Response(JSON.stringify({ status_code: 'PUBLISHED' }), { status: 200 });
    return inner(url, init);
  })(globalThis.fetch);
  const again = await publishInstagram(db, pack(), { caption: 'c', imageUrls: urls, priorCreationId: '17900000000000009' });
  assert.equal(again.note, 'already published by the last attempt');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'nothing created the second time');
});

test('the door refuses a Graph request for comments or another account, even from the publisher module', async () => {
  const db = new Db(':memory:');
  process.env.IG_TOKEN_DEMO = 'tok';
  stubGraph(() => ({}));
  await assert.rejects(insights(db, pack(), '123/comments'), /refused|never reads/);
});

test('insights: only what Meta returned, reach where views are missing, and the score divides by it', async () => {
  const db = new Db(':memory:');
  process.env.IG_TOKEN_DEMO = 'tok';
  stubGraph((m, u, p) => {
    if (p.metric?.includes('views')) throw Object.assign(new Error('metric views not supported for this media'), { code: 100 });
    return { data: [{ name: 'reach', values: [{ value: 800 }] }, { name: 'saved', values: [{ value: 24 }] }, { name: 'shares', values: [{ value: 5 }] }, { name: 'likes', values: [{ value: 60 }] }, { name: 'comments', values: [{ value: 3 }] }] };
  });
  const m = await insights(db, pack(), '17895695668004550');
  assert.deepEqual(m, { views: null, reach: 800, saves: 24, shares: 5, likes: 60, comments: 3 });
  assert.equal(postScore('instagram', m), 24 / 800);
});

test('an Instagram Login token is refreshed and kept; a new token in .env wins over the kept one', async () => {
  const db = new Db(':memory:');
  process.env.IG_TOKEN_DEMO = 'seed-1';
  const calls = stubGraph((m, u) => (u.pathname === '/refresh_access_token' ? { access_token: 'fresh-1', token_type: 'bearer', expires_in: 5_184_000 } : {}));
  const p = pack({ auth: 'instagram' });
  const r = await refreshToken(db, p, { t: Date.parse('2026-10-13T10:00:00Z') });
  assert.equal(r.refreshed, true, 'with no known expiry, a refresh establishes one');
  assert.equal(calls[0].url.split('?')[0], 'https://graph.instagram.com/refresh_access_token');
  assert.equal(currentToken(db, p), 'fresh-1');
  assert.equal((await refreshToken(db, p, { t: Date.parse('2026-10-14T10:00:00Z') })).reason, 'not due');
  assert.equal((await refreshToken(db, p, { t: Date.parse('2026-11-30T10:00:00Z') })).refreshed, true, 'refreshed when 20 days are left');
  process.env.IG_TOKEN_DEMO = 'seed-2';
  assert.equal(currentToken(db, p), 'seed-2', 'the owner put a new token in .env: it is the one used');
  assert.ok(getSetting(db, 'instagram:token:demo'));
});

test('a pack picks its publisher per platform: TikTok through Zernio, Instagram directly; a throttle waits and never re-sends what went out', async () => {
  const { home, cleanup } = tempHome({ packs: {} });
  try {
    copyPack(home, 'demo', (f) => {
      delete f.pack.publisher;
      f.pack.publishers = { tiktok: 'zernio', instagram: 'instagram' };
      f.pack.instagram = { userId: '17841400000000001', auth: 'facebook' };
    });
    const db = new Db(path.join(home, 'data.db'));
    opened.push(db);
    const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
    ctx.mediaDir = path.join(home, 'media');
    const p = ctx.pack('demo');
    assert.equal(publisherFor(p, 'instagram', { db }), 'dry', 'nothing live without PUBLISH_MODE=live');
    process.env.PUBLISH_MODE = 'live';
    process.env.IG_TOKEN_DEMO = 'tok';
    process.env.MEDIA_PUBLIC_BASE_URL = 'https://media.example.com';
    assert.equal(publisherFor(p, 'instagram', { db }), 'instagram');
    assert.equal(publisherFor(p, 'tiktok', { db }), 'dry', 'Zernio wanted, no ZERNIO_API_KEY: dry');

    const res = await buildPost(ctx, { pack: p, formatKey: 'care-guide' });
    db.run("UPDATE posts SET status = 'approved' WHERE id = ?", res.postId);
    const t = israelInstant('2026-10-13', '12:45').getTime();
    let calls = stubGraph(carouselApi({ publishFails: { code: 4 } }));
    // The container is not published when the throttle hits.
    globalThis.fetch = ((inner) => async (url, init) => {
      const u = new URL(url);
      if (u.searchParams.get('fields') === 'status_code') return new Response(JSON.stringify({ status_code: 'FINISHED' }), { status: 200 });
      return inner(url, init);
    })(globalThis.fetch);
    let r = await publishPost(ctx, res.postId, { t });
    assert.equal(r.retry, true, 'a throttle is "not now"');
    let post = loadPost(db, res.postId);
    assert.equal(post.status, 'approved', 'it waits for the next tick');
    assert.equal(post.publish.tiktok.via, 'dry');
    assert.equal(post.publish.instagram.creationId, '17900000000000009', 'the container is kept, to ask about next time');
    calls = stubGraph(carouselApi());
    r = await publishPost(ctx, res.postId, { t: t + 60_000 });
    assert.equal(r.ok, true);
    post = loadPost(db, res.postId);
    assert.equal(post.status, 'published');
    assert.equal(post.publish.instagram.mediaId, '18000000000000001');
    assert.equal(calls.filter((c) => c.method === 'POST' && c.params.media_type === 'CAROUSEL').length, 1);

    // And its numbers come from Meta's own insights.
    stubGraph(() => ({ data: [{ name: 'views', values: [{ value: 1000 }] }, { name: 'reach', values: [{ value: 700 }] }, { name: 'saved', values: [{ value: 30 }] }] }));
    const out = await collectMetrics(ctx, { t: t + 80 * 3_600_000 });
    assert.equal(out.got, 1);
    const m = db.get("SELECT * FROM metrics WHERE post_id = ? AND platform = 'instagram'", res.postId);
    assert.equal(m.views, 1000);
    assert.equal(m.reach, 700);
    assert.equal(m.saves, 30);
  } finally {
    cleanup();
  }
});
