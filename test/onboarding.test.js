import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { discover, heuristicScore } from '../src/onboarding/discover.js';
import { suggestApis } from '../src/onboarding/apis.js';
import { createPack, newTheme, paletteFor } from '../src/onboarding/pack.js';
import { contrast } from '../src/render/color.js';
import { listen } from '../src/web/server.js';
import { __onboarding } from '../src/web/onboarding.js';
import { closeBrowser } from '../src/render/render.js';
import { customer, fakeAccounts, opened, tempHome } from './helpers.js';

after(() => closeBrowser());

function contextFor(home) {
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home, 'media');
  return ctx;
}

test('a government source scores higher than an unknown one, and the reason says why', () => {
  const gov = heuristicScore({ type: 'web', url: 'https://www.btl.gov.il/benefits', origin: 'brave' });
  const blog = heuristicScore({ type: 'web', url: 'https://some-blog.example.com/', origin: 'brave' });
  assert.ok(gov.authority > blog.authority);
  assert.match(gov.reason, /ממשלתי/);
  assert.equal(gov.by, 'heuristic');
});

test('structured APIs are suggested when the niche matches, and Wikidata always', () => {
  const ids = (seed) => suggestApis(seed).map((a) => a.name);
  assert.ok(ids({ niche: 'בישול' }).includes('Wikidata'));
  assert.ok(ids({ niche: 'מחירים ויוקר המחיה' }).some((n) => /סטטיסטיקה/.test(n)));
});

test('discovery without keys says what it skipped and invents nothing', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const out = await discover(ctx, { niche: 'בישול לסטודנטים', audience: 'סטודנטים', examples: ['@someone'] }, { yt: null });
    assert.ok(out.notes.some((n) => /BRAVE_API_KEY/.test(n)));
    assert.ok(out.notes.some((n) => /YOUTUBE_API_KEY/.test(n)));
    assert.ok(out.notes.some((n) => /רשת חברתית/.test(n)), 'a social account is a style example, never read');
    assert.deepEqual(out.formats, []);
    assert.ok(out.candidates.every((c) => c.score && !c.approved));
  } finally {
    cleanup();
  }
});

test('a generated palette passes the contrast rules, and a new theme takes a look nobody uses', () => {
  for (const hue of [0, 90, 200, 300]) for (const dark of [false, true]) {
    const c = paletteFor(hue, { dark });
    assert.ok(c && contrast(c.ink, c.bg) >= 7 && contrast(c.onAccent, c.accent) >= 4.5, `hue ${hue} dark ${dark}`);
  }
  const existing = [{ theme: { template: 'editorial', variant: 'a', fonts: { display: 'Suez One' }, colors: { bg: '#EEF1E4', accent: '#B4512A' } } }];
  const t = newTheme(existing);
  assert.notEqual(`${t.template}/${t.variant}`, 'editorial/a');
  assert.notEqual(t.fonts.display, 'Suez One');
});

test('adding an account needs no code: the onboarding writes a valid, distinct pack next to the demo', async () => {
  const { home, cleanup } = tempHome();
  try {
    const ctx = contextFor(home);
    const made = await createPack(ctx, {
      seed: { niche: 'זכויות עובדים וחיסכון', audience: 'עובדים שכירים', topics: ['תלוש שכר'] },
      candidates: [{ id: 'c1', type: 'api', url: 'https://query.wikidata.org/sparql', name: 'Wikidata', why: 'Structured, sourced facts under CC0.', approved: true, api: { kind: 'wikidata-sparql', query: 'SELECT 1' } }],
      displayName: 'חשבון רביעי',
      handle: 'fourth.account',
    });
    assert.deepEqual(readdirSync(made.dir).sort(), ['formats.json', 'pack.json', 'rules.json', 'sources.json', 'theme.json', 'voice.md']);
    const all = loadAll({ dir: path.join(home, 'packs') });
    assert.equal(all.length, 2, 'both packs load, and together they are distinct brands');
    const p = all.find((x) => x.id === made.id);
    assert.deepEqual(p.meta.compliance, ['il-investment-advice'], 'a money niche gets the investment-advice check by itself');
    assert.equal(p.meta.autonomy.mode, 'approve', 'a new account starts in Approve mode');
  } finally {
    cleanup();
  }
});

test('the website flow: seed, discovery, approve sources, the pack is created, and it cannot go live without five samples', async () => {
  const { home, cleanup } = tempHome();
  let server;
  let fake;
  try {
    const ctx = contextFor(home);
    fake = await fakeAccounts();
    const s = await listen(ctx, { port: 0, env: { ...process.env, SESSION_SECRET: 'y'.repeat(40), ...fake.env } });
    server = s.server;
    const base = `http://127.0.0.1:${s.port}`;
    // The owner of workspace 7 starts the account: it is that workspace's.
    const { cookie } = fake.session(customer(7));
    const csrf = /name="_csrf" value="([^"]+)"/.exec(await (await fetch(`${base}/new`, { headers: { cookie } })).text())[1];
    const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...body }).toString() });

    const r1 = await post('/new', { niche: 'בישול טבעוני', audience: 'סטודנטים', topics: 'מתכונים, תקציב' });
    assert.equal(r1.status, 303);
    const id = r1.headers.get('location').split('/').pop();
    await Promise.all([...__onboarding.running.values()]);
    const review = await (await fetch(`${base}/new/${id}`, { headers: { cookie } })).text();
    assert.match(review, /Wikidata/);
    assert.match(review, /<html lang="he" dir="rtl"/);
    const cand = ctx.db.get('SELECT candidates_json FROM onboarding WHERE id = ?', id);
    const first = JSON.parse(cand.candidates_json).candidates[0].id;
    const r2 = await post(`/new/${id}/create`, { [`approve_${first}`]: 'on', displayName: 'מטבח ירוק בדוגמה', handle: 'demo.green.kitchen' });
    assert.equal(r2.status, 303);
    const row = ctx.db.get('SELECT status, pack_id FROM onboarding WHERE id = ?', id);
    assert.equal(row.status, 'samples');
    assert.equal(ctx.db.get('SELECT status FROM accounts WHERE id = ?', row.pack_id).status, 'onboarding');
    assert.equal(ctx.db.get('SELECT workspace_id FROM accounts WHERE id = ?', row.pack_id).workspace_id, 7, 'the new account is the workspace\'s that started it');
    assert.equal(ctx.db.get('SELECT workspace_id FROM onboarding WHERE id = ?', id).workspace_id, 7);
    assert.ok(ctx.pack(row.pack_id), 'the engine picked up the new pack without a restart');
    await post(`/new/${id}/samples`, {});
    await Promise.all([...__onboarding.running.values()]);
    const notes = JSON.parse(ctx.db.get('SELECT notes_json FROM onboarding WHERE id = ?', id).notes_json).join(' ');
    assert.match(notes, /ANTHROPIC_API_KEY/, 'offline, it says what it needs to write the samples');
    await post(`/new/${id}/live`, {});
    assert.equal(ctx.db.get('SELECT status FROM accounts WHERE id = ?', row.pack_id).status, 'onboarding', 'no going live without five reviewed samples');
  } finally {
    server?.close();
    await fake?.close();
    cleanup();
  }
});
