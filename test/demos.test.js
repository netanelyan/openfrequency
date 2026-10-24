import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { listen } from '../src/web/server.js';
import { running } from '../src/web/demos.js';
import { checkDraft, checkFact } from '../src/demos/write.js';
import { readArticles } from '../src/demos/build.js';
import { storeDocument } from '../src/demos/store.js';
import { INTERNAL_TOKEN, fakeAccounts, customer, operator, opened, tempHome } from './helpers.js';

// A store's demo, from the website's request to the store's page (src/web/demos.js, src/demos):
// the request is taken only from this machine with the token; the demo is built in the background, on a topic from
// the store's field, its facts from Wikipedia, drawn on the store's photographs; nobody but the operator sees it
// until the operator approves it; then its page is public at /s/<slug>, with the price once set.
// The store, the topic, Wikipedia, the writer, the photographs and the renderer are stand-ins (ctx.demoIo).

const product = (id, title, src, price = '289.00', at = '2026-10-01') => ({ id, title, handle: `p${id}`, published_at: at, images: [{ src }, { src: `${src}?2` }], variants: [{ price, available: true }], options: [] });
const KETTLE = product(11, 'קומקום חשמלי', 'https://cdn.example.test/kettle.jpg', '289.00', '2026-10-01');
const TEAPOT = product(12, 'קנקן תה מזכוכית', 'https://cdn.example.test/teapot.jpg', '149.90', '2026-09-01');
const SOLD = { ...product(13, 'קומקום שאזל', 'https://cdn.example.test/sold.jpg'), variants: [{ price: '99', available: false }] };
const STORE = { origin: 'https://kettles.example.co.il', domain: 'kettles.example.co.il', name: 'חנות הקומקומים', currency: 'ILS', accent: '#0A7D4F', products: [KETTLE, TEAPOT, SOLD], collections: ['קומקומים', 'תה'], logo: 'https://cdn.example.test/logo.png?v=1' };
const ARTICLE = { url: 'https://he.wikipedia.org/wiki/%D7%AA%D7%94', title: 'תה (Wikipedia בעברית)', text: 'התה הוא משקה שמכינים מעלים של צמח התה. לפי המסורת הסינית, התה התגלה לפני כ-5000 שנה כשעלים נפלו לתוך מים רותחים.' };
const QUOTE = 'לפי המסורת הסינית, התה התגלה לפני כ-5000 שנה כשעלים נפלו לתוך מים רותחים.';

let home;
let ctx;
let db;
let fake;
let server;
let base;
let op;
let cust;
let PHOTO;

const DRAFT = {
  facts: [{ id: 'f1', doc: 'w1', claim: 'לפי המסורת הסינית, התה התגלה לפני 5000 שנה', quote: QUOTE }],
  hook: 'התה התחיל בטעות',
  sub: 'הסיפור של המשקה שכולם שותים',
  coverImage: 'tea leaves in boiling water',
  items: [
    { title: 'עלים במים רותחים', body: 'לפי המסורת הסינית, עלים נפלו לתוך מים רותחים וכך התגלה התה.', facts: ['f1'], image: 'tea leaves falling into a cup' },
    { title: 'לפני 5000 שנה', body: 'כך מספרת המסורת הסינית על הרגע שבו הכול התחיל.', facts: ['f1'], image: 'ancient chinese tea garden' },
    { title: 'מסורת שנשארה', body: 'גם היום מכינים תה מעלים ומים רותחים, בדיוק כמו בסיפור.', facts: ['f1'], image: 'teapot pouring tea' },
  ],
  cta: { title: 'ומה מרתיחים אצלכם', body: 'קומקומים וקנקנים לתה מחכים לכם באתר', facts: [], image: 'kettle on a kitchen counter' },
  caption: 'לפי המסורת, התה התחיל בטעות. מה אתם שותים בבוקר?',
};

// What the image search was asked: each query, and the libraries it was allowed.
const searched = [];
const io = {
  read: async () => STORE,
  topic: async () => ({ niche: 'הסיפור של התה', angle: 'how tea was discovered', articles: [{ lang: 'he', title: 'תה' }] }),
  wiki: async (_src, api) => (api.title === 'תה' ? [ARTICLE] : []),
  fetchImage: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  write: async (_ctx, { store, docs }) => checkDraft(docs, DRAFT, { domain: store.domain }),
  photo: async (_ctx, { pack, query }) => {
    searched.push({ query, providers: pack.meta.imagery?.providers });
    return { file: PHOTO, author: 'A Photographer', license: 'Pexels License', source_url: `https://www.pexels.com/photo/${encodeURIComponent(query)}` };
  },
  render: async ({ outDir, photos }) => {
    assert.equal(photos.size, 5, 'a Pexels photograph for every slide');
    for (const p of photos.values()) assert.doesNotMatch(p.file, /shelf|cdn\.example/, 'never a product of the store');
    const out = { tiktok: [], instagram: [] };
    for (const p of ['tiktok', 'instagram']) {
      for (const n of [1, 2]) {
        const file = path.join(outDir, `${p}-0${n}.jpg`);
        writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        out[p].push(file);
      }
    }
    return out;
  },
};

before(async () => {
  home = tempHome();
  db = new Db(path.join(home.home, 'data.db'));
  opened.push(db);
  ctx = makeContext({ db, packs: loadAll({ dir: path.join(home.home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home.home, 'media');
  ctx.mediaRoot = home.home;
  mkdirSync(ctx.mediaDir, { recursive: true });
  ctx.demoIo = io;
  PHOTO = path.join(home.home, 'pexels.jpg');
  writeFileSync(PHOTO, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fake = await fakeAccounts();
  const s = await listen(ctx, { port: 0, env: { ...process.env, SESSION_SECRET: 'd'.repeat(40), ...fake.env } });
  server = s.server;
  base = `http://127.0.0.1:${s.port}`;
  op = fake.session(operator()).cookie;
  cust = fake.session(customer(1)).cookie;
});

after(async () => {
  await Promise.all([...running.values()]);
  server?.close();
  await fake?.close();
  home?.cleanup();
});

const lead = (body, headers = {}) =>
  fetch(`${base}/internal/lead`, { method: 'POST', headers: { authorization: `Bearer ${INTERNAL_TOKEN}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (p, cookie = '') => fetch(`${base}${p}`, { redirect: 'manual', headers: { cookie } });
const csrfOf = async (cookie) => /name="_csrf" value="([^"]+)"/.exec(await (await get('/settings', cookie)).text())[1];
const post = async (p, cookie, body = {}) =>
  fetch(`${base}${p}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-of-ajax': '1' }, body: new URLSearchParams({ _csrf: await csrfOf(cookie), ...body }).toString() });
const settle = () => Promise.all([...running.values()]);
const demo = () => db.get("SELECT * FROM demos WHERE domain = 'kettles.example.co.il'");

test("the store's document, its photographs, and the slideshow's checks: a topic from its field, facts from the articles", async () => {
  const doc = storeDocument(STORE);
  assert.match(doc.text, /הקטגוריות באתר: קומקומים, תה\./);
  assert.match(doc.text, /המחירים באתר: מ-149\.9 ₪ עד 289 ₪\./);
  assert.doesNotMatch(doc.text, /שאזל/, 'what is out of stock is not in it');
  const w1 = { key: 'w1', ...ARTICLE };
  assert.ok(checkFact(w1, { claim: 'התה התגלה לפני 5000 שנה', quote: QUOTE }).ok);
  assert.match(checkFact(w1, { claim: 'התה התגלה לפני 3000 שנה', quote: QUOTE }).error, /3000/, 'a number the quote does not say');
  assert.match(checkFact(w1, { claim: 'תה', quote: 'לפי המסורת הסינית, התה התגלה לפני כ-5000 שנה…' }).error, /ellipsis/);
  assert.match(checkFact(null, { doc: 'w9', claim: 'תה', quote: QUOTE }).error, /no document/);
  const docs = [w1, { ...doc }];
  const ok = checkDraft(docs, DRAFT, { domain: STORE.domain });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.post.slides.length, 5, 'a cover, three content slides, and the last one');
  assert.equal(ok.post.slides.at(-1).role, 'cta');
  assert.equal(ok.post.extra.cta, 'kettles.example.co.il', "the last slide's line is the store's address");
  assert.equal(ok.post.facts[0].url, ARTICLE.url, 'each fact keeps where it came from');
  const bare = checkDraft(docs, { ...DRAFT, items: DRAFT.items.map((s) => ({ ...s, facts: [] })) }, { domain: STORE.domain });
  assert.ok(bare.problems.some((p) => /states no sourced fact/.test(p)), 'a content slide stands on a fact');
  const sold = checkDraft(docs, { ...DRAFT, cta: { ...DRAFT.cta, body: 'קומקומים מ-99 ₪ מחכים לכם באתר' } }, { domain: STORE.domain });
  assert.ok(sold.problems.some((p) => /99/.test(p)), 'the last slide says no number the documents do not');
  assert.deepEqual((await readArticles([{ lang: 'he', title: 'אין כזה' }, { lang: 'he', title: 'תה' }], { wiki: io.wiki })).map((a) => a.key), ['w1'], 'an article not found is left out');
});

test('the website hands in a request only from this machine, with the token, and not through the proxy', async () => {
  const body = { url: 'kettles.example.co.il', whatsapp: '972501234567' };
  assert.equal((await lead(body, { authorization: 'Bearer wrong' })).status, 403);
  assert.equal((await lead(body, { authorization: '' })).status, 403);
  assert.equal((await lead(body, { 'x-forwarded-for': '203.0.113.9' })).status, 403, 'a request through Caddy is refused, token or not');
  assert.equal((await lead({ ...body, whatsapp: '12345' })).status, 400);
  assert.equal((await lead({ ...body, url: 'not a store' })).status, 400);
  assert.equal(db.get('SELECT COUNT(*) AS n FROM demos').n, 0, 'none of these left a demo');
});

test('a request builds the demo in the background; asking again for the same store gives the same demo', async () => {
  const res = await lead({ url: 'https://kettles.example.co.il/collections/all', whatsapp: '972501234567' });
  assert.equal(res.status, 200);
  const first = await res.json();
  assert.equal(first.existing, false);
  await settle();
  const d = demo();
  assert.equal(d.status, 'ready', d.error);
  assert.match(d.slug, /^kettles-[0-9a-f]{6}$/);
  assert.match(d.docs_json, /התה התגלה/);
  assert.doesNotMatch(d.media_json, /"bg"/, 'no picture behind the page');
  assert.match(d.store_json, /logo\.jpg/, "the store's logo, saved");
  assert.deepEqual(searched.map((s) => s.query), [DRAFT.coverImage, ...DRAFT.items.map((s) => s.image), DRAFT.cta.image], "each slide's own search, in order");
  assert.ok(searched.every((s) => JSON.stringify(s.providers) === '["pexels"]'), 'Pexels only');
  assert.equal(JSON.parse(d.post_json).photos.length, 5, 'each photograph credited');
  const again = await (await lead({ url: 'kettles.example.co.il', whatsapp: '972529876543' })).json();
  assert.deepEqual([again.id, again.existing], [first.id, true]);
  assert.equal(demo().whatsapp, '972529876543', 'the latest number that asked');
  assert.equal(db.get('SELECT COUNT(*) AS n FROM demos').n, 1);
});

test('until the operator approves it, the demo is nobody else\'s: not its page, not its slides, not the list', async () => {
  const d = demo();
  assert.equal((await get(`/s/${d.slug}`)).status, 404);
  assert.equal((await get(`/s/${d.slug}/tiktok-0.jpg`)).status, 404);
  for (const p of ['/demos', `/demos/${d.id}`, `/demos/${d.id}/img/tiktok/0`]) {
    const res = await get(p, cust);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(await res.text(), /kettles/, `${p} shows the store to a customer`);
  }
  for (const p of [`/demos/${d.id}/approve`, `/demos/${d.id}/remove`, `/demos/${d.id}/redo`, '/demos/offer']) {
    const res = await post(p, cust, { monthly: '1' });
    assert.ok(res.status >= 400 && res.status < 500, `${p}: ${res.status}`);
  }
  assert.equal(demo().status, 'ready');
  assert.equal(db.get("SELECT value_json FROM settings WHERE key = 'demo-offer'"), null);
});

test('the operator sees it, approves it, and the store\'s page is up: its name, its slides, where each number came from', async () => {
  const d = demo();
  const list = await (await get('/demos', op)).text();
  assert.match(list, /kettles\.example\.co\.il/);
  const one = await (await get(`/demos/${d.id}`, op)).text();
  assert.match(one, /לפי המסורת הסינית, התה התגלה לפני 5000 שנה/);
  assert.match(one, /הסיפור של התה/);
  assert.match(one, /לאשר ולהעלות את העמוד/);
  const img = await get(`/demos/${d.id}/img/instagram/1`, op);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');

  assert.equal((await post(`/demos/${d.id}/approve`, op)).status, 200);
  assert.equal(demo().status, 'approved');
  const res = await get(`/s/${d.slug}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-robots-tag'), /noindex/);
  const page = await res.text();
  assert.match(page, /<meta name="robots" content="noindex/);
  assert.match(page, /<span class="hl"><bdi>חנות הקומקומים<\/bdi><\/span>/);
  assert.match(page, new RegExp(`src="/s/${d.slug}/tiktok-0\\.jpg"`));
  assert.match(page, new RegExp(`src="/s/${d.slug}/instagram-1\\.jpg"`));
  assert.match(page, /מאיפה כל עובדה/);
  assert.match(page, /התמונות מ־<a href="https:\/\/www\.pexels\.com"/);
  assert.match(page, /מצגת על <bdi>הסיפור של התה<\/bdi>/);
  assert.ok(page.includes(`<span class="logo"><img src="/s/${d.slug}/logo" alt="חנות הקומקומים"></span>`), "the store's own logo, not its initial");
  assert.equal((await get(`/s/${d.slug}/logo`)).headers.get('content-type'), 'image/jpeg');
  assert.doesNotMatch(page, /band-bg|bg.jpg/, 'the page stands on the silver wallpaper, no photograph behind it');
  assert.match(await (await get(`/s/${d.slug}/theme.css`)).text(), /--store:#0A7D4F/, "the store's own colour, where white reads on it");
  assert.equal((await get(`/s/${d.slug}/p-0.jpg`)).status, 200, 'its products beside the title');
  assert.ok(page.includes('<dt>מוצרים</dt><dd>2</dd>'), 'what was read on its site');
  assert.match(page, /https:\/\/openfrequency\.co\.il\/join\?p=teder/);
  assert.doesNotMatch(page, /לחודש/, 'no price until one is set');
  assert.doesNotMatch(page, /972/, "the number that asked is not on the store's page");
  const slide = await get(`/s/${d.slug}/tiktok-1.jpg`);
  assert.equal(slide.status, 200);
  assert.equal((await get(`/s/${d.slug}/tiktok-9.jpg`)).status, 404);
  assert.equal((await get(`/s/${d.slug.slice(0, -1)}x`)).status, 404, 'a slug guessed wrong finds nothing');
});

test('the price the operator sets is on the store\'s page, VAT and the setup fee with it', async () => {
  const d = demo();
  assert.equal((await post('/demos/offer', op, { monthly: 'abc' })).status, 400);
  assert.equal((await post('/demos/offer', op, { monthly: '790', setup: '1,490', vat: 'excluded' })).status, 200);
  const page = await (await get(`/s/${d.slug}`)).text();
  assert.ok(page.includes('<span class="num">790</span><span class="cur">₪</span><span class="per">לחודש</span>'), 'the figure');
  assert.ok(page.includes('לא כולל מע״מ. בחודש הראשון יש גם 1,490 ₪ דמי הקמה, פעם אחת.'), 'VAT and the setup fee under it');
  assert.ok(page.includes('מה כלול במחיר'));
});

test('taken down, the page is gone; a demo taken down is not written again', async () => {
  const d = demo();
  assert.equal((await post(`/demos/${d.id}/remove`, op)).status, 200);
  assert.equal((await get(`/s/${d.slug}`)).status, 404);
  assert.equal((await post(`/demos/${d.id}/redo`, op)).status, 400);
  const res = await lead({ url: 'kettles.example.co.il', whatsapp: '972501234567' });
  assert.equal((await res.json()).existing, false, 'asking after a takedown starts a new demo');
  await settle();
});
