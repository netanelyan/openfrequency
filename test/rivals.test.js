import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost } from '../src/pipeline/build.js';
import { outlineUser, slidesUser } from '../src/pipeline/prompts.js';
import { recordedClient } from '../src/llm/recorded.js';
import { closeBrowser } from '../src/render/render.js';
import { DAY, setNow } from '../src/core/clock.js';
import { RIVALS, cleanHandle, nicheForOutline, nicheForSlides, parseTimes, readRival, removeRival, rivalsOf, saveRival, timesBeside } from '../src/pipeline/rivals.js';
import { keepOnly, opened, tempHome } from './helpers.js';

// The rivals an account's owner watches, typed in by hand (the engine never reads
// another account: hard rule 1), and said to the writer as planning input.

after(() => closeBrowser());

const T = Date.parse('2026-10-19T09:00:00Z');
const form = (over = {}) => ({
  handle: '@balcony.greens',
  platform: 'tiktok',
  hooks: 'הבזיליקום שלכם מת בגלל דבר אחד\n3 צמחים שאי אפשר להרוג',
  formats: 'דירוג 5 עד 1',
  times: '18:00, 21:30',
  gaps: 'אף אחד לא מסביר מה עושים בחורף במרפסת צפונית',
  ...over,
});

function memDb() {
  const db = new Db(':memory:');
  db.run("INSERT INTO accounts (id, display_name, handle, created_at, updated_at) VALUES ('demo', 'Demo', 'demo', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')");
  return db;
}

test('the form is read strictly: a handle as the platform shows it, hours as HH:MM, at most five cover lines', () => {
  assert.equal(cleanHandle(' @@balcony.greens '), 'balcony.greens');
  assert.equal(cleanHandle('https://www.tiktok.com/@balcony.greens?lang=he'), 'balcony.greens');
  assert.equal(cleanHandle('https://instagram.com/balcony_greens/'), 'balcony_greens');
  assert.deepEqual(parseTimes('21:30, 9:05 18.00 21:30'), { times: ['09:05', '18:00', '21:30'], bad: [] });
  assert.deepEqual(parseTimes('25:00 ערב').bad, ['25:00', 'ערב']);

  const ok = readRival(form());
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.rival.hooks, ['הבזיליקום שלכם מת בגלל דבר אחד', '3 צמחים שאי אפשר להרוג']);
  assert.deepEqual(ok.rival.times, ['18:00', '21:30']);

  const bad = readRival(form({ handle: 'שם בעברית', platform: 'youtube', hooks: '', times: 'בערב' }));
  assert.equal(bad.problems.length, 4, bad.problems.join(' | '));
  assert.ok(readRival(form({ hooks: Array.from({ length: 6 }, (_, i) => `שער ${i}`).join('\n') })).problems.some((p) => /עד 5 שורות/.test(p)));
  assert.ok(readRival(form({ gaps: 'א'.repeat(RIVALS.gapChars + 1) })).problems.length);
});

test('at most five rivals an account, never the same handle twice, and an update keeps the row', () => {
  const db = memDb();
  try {
    setNow(T);
    const first = saveRival(db, 'demo', form(), { by: 'owner' });
    assert.ok(first.id);
    assert.match(saveRival(db, 'demo', form({ handle: 'Balcony.Greens' })).problems.join(), /כבר ברשימה/);
    // The same handle on the other platform is another account.
    assert.ok(saveRival(db, 'demo', form({ platform: 'instagram' })).id);
    for (const h of ['a.one', 'b.two', 'c.three']) assert.ok(saveRival(db, 'demo', form({ handle: h })).id);
    assert.match(saveRival(db, 'demo', form({ handle: 'six.th' })).problems.join(), /עד 5 מתחרים/);
    const upd = saveRival(db, 'demo', form({ id: String(first.id), hooks: 'שער חדש לגמרי שעבד', times: '' }));
    assert.equal(upd.id, first.id);
    const r = rivalsOf(db, 'demo').find((x) => x.id === first.id);
    assert.deepEqual(r.hooks, ['שער חדש לגמרי שעבד']);
    assert.deepEqual(r.times, []);
    assert.equal(r.updatedBy, null, 'the last save is who updated it');
    assert.match(saveRival(db, 'demo', form({ id: '999' })).problems.join(), /אין מתחרה/);
    assert.equal(removeRival(db, 'demo', first.id).handle, 'balcony.greens');
    assert.equal(removeRival(db, 'demo', first.id), null);
    assert.equal(rivalsOf(db, 'demo').length, 4);
  } finally {
    setNow(null);
    db.close();
  }
});

test('a rival not looked at in 30 days is marked, and after 60 it no longer reaches the writer', () => {
  const db = memDb();
  try {
    setNow(T - 61 * DAY);
    saveRival(db, 'demo', form({ handle: 'old.one', hooks: 'שער מהעונה שעברה', gaps: 'פער ישן' }));
    setNow(T - 31 * DAY);
    saveRival(db, 'demo', form({ handle: 'mid.one', hooks: 'שער מלפני חודש' }));
    setNow(T);
    saveRival(db, 'demo', form());
    const rs = rivalsOf(db, 'demo');
    assert.deepEqual(rs.map((r) => [r.handle, r.state]), [['balcony.greens', 'fresh'], ['mid.one', 'stale'], ['old.one', 'dropped']]);
    const outline = nicheForOutline(rs);
    assert.match(outline, /THE NICHE \(2 accounts/);
    assert.match(outline, /What it leaves out: אף אחד לא מסביר מה עושים בחורף/);
    assert.match(outline, /pick the topic and angle in one of the gaps/);
    assert.ok(!outline.includes('פער ישן'), 'a dropped rival is not said');
    const slides = nicheForSlides(rs);
    assert.match(slides, /"הבזיליקום שלכם מת בגלל דבר אחד"/);
    assert.match(slides, /"שער מלפני חודש"/);
    assert.match(slides, /never their words/);
    assert.ok(!slides.includes('שער מהעונה שעברה'));
    assert.equal(nicheForOutline([]), '');
    assert.equal(nicheForSlides([]), '');
  } finally {
    setNow(null);
    db.close();
  }
});

test("their posting hours are counted beside the account's own slots, which they never change", () => {
  const rivals = [
    { state: 'fresh', times: ['18:00', '21:30', '22:00'] },
    { state: 'fresh', times: ['18:00'] },
    { state: 'dropped', times: ['12:00'] },
  ];
  const t = timesBeside(rivals, ['21:00', '12:30', '08:00', '19:00']);
  assert.deepEqual(t.theirs, [{ at: '18:00', n: 2 }, { at: '21:30', n: 1 }, { at: '22:00', n: 1 }]);
  // A rival is counted once for a slot, however many of its hours are near it; a dropped rival not at all.
  assert.deepEqual(t.own, [{ at: '08:00', near: 0 }, { at: '12:30', near: 0 }, { at: '19:00', near: 2 }, { at: '21:00', near: 1 }]);
});

test('the niche is said in the outline unless the post has a set subject, and in the slides', () => {
  const format = { id: 'care-guide', name: 'מדריך', kind: 'guide', slides: [4, 6] };
  const doc = [{ ref: 'D1', sourceName: 'x', url: 'https://example.org', title: 't', text: 'טקסט' }];
  assert.match(outlineUser(format, doc, { niche: 'THE NICHE (x)' }), /THE NICHE \(x\)/);
  assert.ok(!outlineUser(format, doc, { niche: 'THE NICHE (x)', subject: 'הקרב הראשי' }).includes('THE NICHE'), "a fight week's subject wins");
  const user = slidesUser({ format, n: 1, outline: { topic: 't', items: [{ role: 'step', point: 'p', facts: [] }] }, facts: [], niche: "THE NICHE'S COVERS (x)" });
  assert.match(user, /THE NICHE'S COVERS \(x\)/);
});

test('a post is planned with the rivals the owner typed in: the outline gets the gaps, the slides the covers', async () => {
  const { home, cleanup } = tempHome();
  try {
    keepOnly(path.join(home, 'packs', 'demo'), ['basil-containers']);
    const db = new Db(path.join(home, 'data.db'));
    opened.push(db);
    const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
    ctx.mediaDir = path.join(home, 'media');
    const seen = {};
    const recorded = recordedClient();
    ctx.llm = { ...recorded, json: async (req) => ((seen[req.task] = req.user), recorded.json(req)) };
    assert.ok(saveRival(db, 'demo', form()).id);
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'queued', res.reason);
    assert.match(seen.outline, /THE NICHE \(one account/);
    assert.match(seen.outline, /אף אחד לא מסביר מה עושים בחורף/);
    assert.match(seen.slides, /THE NICHE'S COVERS.*"3 צמחים שאי אפשר להרוג"/);
  } finally {
    cleanup();
  }
});
