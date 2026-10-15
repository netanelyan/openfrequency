import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyPack, DEMO, opened, tempHome } from './helpers.js';
import { coverVisualHtml, normVisual, numberOf, slideHasVisual, VISUAL_TYPES, visualHtml, visualProblems, visualsOf, visualText } from '../src/render/visuals.js';
import { SAMPLE_VISUALS } from '../src/render/samples.js';
import { gate, tokenOf } from '../src/verify/claims.js';
import { page } from '../src/render/html.js';
import { buildSlide } from '../src/render/templates/index.js';
import { closeBrowser, renderHtml, renderPost } from '../src/render/render.js';
import { loadPack } from '../src/packs/load.js';
import { visualsNeeded } from '../src/pipeline/prompts.js';
import { imageCredit, namesIn, namesOf } from '../src/images/index.js';
import { Db } from '../src/db/index.js';

// The engine's own graphics: what they accept, how the fact gate reads them, and
// that every one of them fits a TikTok and an Instagram slide, right to left.

const v = (type, items, extra = {}) => normVisual({ type, title: '', a: '', b: '', style: '', ...extra, items: items.map(([label, value = '', value2 = '', sub = '']) => ({ label, value, value2, sub })) });

test('a visual is checked for its type, its size and its fields', () => {
  const all = VISUAL_TYPES;
  assert.deepEqual(visualProblems(null, all, 's'), []);
  assert.equal(normVisual({ type: 'none', items: [] }), null);
  assert.match(visualProblems(normVisual({ type: 'hologram', items: [] }), all, 's')[0], /not one this account uses/);
  assert.match(visualProblems(v('timeline', [['1', 'x']]), all, 's')[0], /2 to 5 items/);
  assert.match(visualProblems(v('compare', [['גובה', '1', '2'], ['גיל', '3', '4']]), all, 's')[0], /needs a and b/);
  assert.match(visualProblems(v('kit', [['הקבוצה', 'אדום ולבן']]), all, 's')[0], /hex codes/);
  assert.match(visualProblems(v('pitch', [['A', 'GK'], ['B', 'XX'], ['C', 'ST']]), all, 's')[0], /position code/);
  assert.match(visualProblems(v('record', [['A', 'ניצחונות רבים']]), all, 's')[0], /wins-losses/);
  assert.match(visualProblems(v('bars', [['A', 'הרבה'], ['B', '3']]), all, 's')[0], /needs a number/);
  assert.match(visualProblems(v('mock', [['a', 'b'], ['c', 'd']], { style: 'video' }), all, 's')[0], /chat, terminal or browser/);
  // A pack draws only its own types.
  assert.match(visualProblems(v('pitch', [['A', 'GK'], ['B', 'CB'], ['C', 'ST']]), ['timeline', 'bars'], 's')[0], /timeline, bars/);
  for (const [type, s] of Object.entries(SAMPLE_VISUALS)) assert.deepEqual(visualProblems(normVisual(s.visual), all, type), [], type);
});

test('a pack draws the types its theme names, or the default four', () => {
  assert.deepEqual(visualsOf({ theme: {} }), ['timeline', 'bars', 'compare', 'stat']);
  assert.deepEqual(visualsOf({ theme: { visuals: ['pitch', 'nonsense', 'kit'] } }), ['pitch', 'kit']);
});

test('half the slides with the cover: how many content slides need a visual', () => {
  assert.equal(visualsNeeded(4), 2);
  assert.equal(visualsNeeded(5), 2);
  assert.equal(visualsNeeded(6), 3);
  assert.equal(visualsNeeded(7), 3);
  assert.ok(slideHasVisual({ role: 'stat' }));
  assert.ok(slideHasVisual({ visual: { type: 'bars' } }));
  assert.ok(!slideHasVisual({ role: 'beat' }));
  assert.ok(slideHasVisual({ role: 'beat', photo: 'data:' }));
});

test('every number a graphic draws is held to the quotes, like the slide text', () => {
  const facts = [{ key: 'f1', claim: 'c', quote: 'Liverpool came back from 3–0 down; the match ended 3–3 and went to penalties', verified: true }];
  const slide = (visual) => ({ kind: 'item', role: 'beat', title: 'הקאמבק', body: 'ליברפול חזרה', factKeys: ['f1'], visual });
  const ok = gate({ slides: [{ kind: 'cover', title: '', body: '', factKeys: [] }, slide(v('stat', [['השוויון', '3–3']]))], facts });
  assert.deepEqual(ok.problems, []);
  const bad = gate({ slides: [{ kind: 'cover', title: '', body: '', factKeys: [] }, slide(v('bars', [['ליברפול', '4'], ['מילאן', '3']]))], facts });
  assert.match(bad.problems.join(' '), /visual's number 4 is not in the quotes/);
  // A kit's colours and a pitch's positions are not numbers.
  assert.equal(visualText(v('kit', [['הקבוצה', '#C8102E #FFFFFF']])), 'הקבוצה');
  // The cover's graphic too.
  const cover = gate({ slides: [{ kind: 'cover', title: '', body: '', factKeys: [] }], facts, extra: { coverVisual: v('stat', [['קהל', '70,024']]) } });
  assert.match(cover.problems.join(' '), /70024|70,024/);
  // The graphic is part of the checked text: change it after the gate and the token no longer matches.
  const slides = [{ kind: 'cover', title: '', body: '', factKeys: [] }, slide(v('stat', [['השוויון', '3–3']]))];
  const before = tokenOf({ slides });
  slides[1].visual.items[0].value = '4–3';
  assert.notEqual(tokenOf({ slides }), before);
  // A slide without a graphic hashes as it always did.
  assert.equal(tokenOf({ slides: [{ kind: 'item', title: 'a', body: 'b', factKeys: [] }] }), tokenOf({ slides: [{ kind: 'item', title: 'a', body: 'b', factKeys: [], visual: null }] }));
});

test('a number is read from a value the way a reader writes it', () => {
  assert.equal(numberOf('12,400'), 12400);
  assert.equal(numberOf('$20 לחודש'), 20);
  assert.equal(numberOf('4.5%'), 4.5);
  assert.equal(numberOf('הרבה'), null);
});

test('a graphic is drawn with its text isolated, and the cover always has a picture', async () => {
  const html = visualHtml(v('timeline', [['2003–04', 'עונה של AC Milan'], ["54'", 'Steven Gerrard מצמק']]));
  assert.match(html, /class="vis fit/);
  assert.match(html, /<bdi>AC Milan<\/bdi>/);
  // A meme's cover is the meme itself, the hook on the account's meme card (coverInner).
  assert.match((await import('../src/render/roles.js')).coverInner({ postKind: 'meme', hook: 'כשהחשבון מגיע', subject: {} }).inner, /cover-meme/);
  for (const postKind of ['story', 'iceberg', 'ranking', 'guess-who', 'hot-take', 'head-to-head', 'myth-fact', 'what-happened', 'on-this-day']) {
    assert.match(coverVisualHtml({ postKind, subject: { a: 'א', b: 'ב', date: '25 במאי 2005' } }), /cover-vis/, postKind);
  }
  assert.match(coverVisualHtml({ postKind: 'on-this-day', subject: { date: '25 במאי 2005' } }), /v-date/);
  assert.match(coverVisualHtml({ postKind: 'story', coverVisual: v('stat', [['קהל', '70,024']]) }), /v-stat/);
});

test('a photograph must name its subject: in its title, its description or its categories', () => {
  assert.deepEqual(namesOf('Steven Gerrard Liverpool'), ['Steven', 'Gerrard', 'Liverpool']);
  assert.deepEqual(namesOf('UFC Holly Holm'), ['Holly', 'Holm']);
  const cats = 'File:IMG_2041.jpg · Steven Gerrard · Liverpool F.C. players';
  assert.ok(namesIn(cats, ['Steven', 'Gerrard']));
  assert.ok(!namesIn('File:Rudder Rock, Steep Holm.jpg', ['Holly', 'Holm']));
});

test("every photograph's credit is in the caption when its license asks for one", () => {
  const { cleanup } = tempHome();
  try {
    const db = new Db(path.join(os.tmpdir(), `of-credit-${process.pid}.db`));
    opened.push(db);
    const img = (author, license) => db.insert('images', { provider: 'commons', provider_id: 'File:x.jpg', license, author, file: 'x', sha256: author, created_at: 'now', ai_generated: 0, realistic: 0 });
    const a = img('Jane Roe', 'CC BY-SA 4.0');
    const b = img('Max Mustermann', 'CC BY 2.0');
    const c = img(null, 'Public domain');
    assert.equal(imageCredit(db, { slides: [{ image_id: a }, { image_id: null }, { image_id: b }, { image_id: c }] }), 'צילומים: Jane Roe · CC BY-SA 4.0 · Wikimedia Commons | Max Mustermann · CC BY 2.0 · Wikimedia Commons');
    assert.equal(imageCredit(db, { slides: [{ image_id: c }] }), '');
  } finally {
    cleanup();
  }
});

test('every graphic fits a TikTok and an Instagram slide, in every template, right to left', async () => {
  const pack = loadPack(DEMO);
  const dir = path.join(os.tmpdir(), `of-vis-${process.pid}`);
  try {
    for (const template of ['editorial', 'card', 'corner', 'scoreboard']) {
      const theme = { ...pack.theme, template };
      for (const [type, s] of Object.entries(SAMPLE_VISUALS)) {
        for (const size of ['tiktok', 'instagram']) {
          const slide = { kind: 'item', role: 'beat', title: s.slideTitle, body: s.slideBody, visual: normVisual(s.visual), hasVisual: true, handle: 'demo', postKind: 'story', subject: {}, keywords: [], pos: 2, total: 6, n: 2, of: 6, sources: ['ויקיפדיה: 2005 UEFA Champions League Final'] };
          const html = page({ theme, size, slide, parts: buildSlide(theme, slide) });
          // As renderPost does: the usual floor first, then 45% for a slide at its fullest. Nothing inside a graphic
          // may run past it at either (a price card's second row was cut while its last line still counted as in).
          const file = path.join(dir, `${template}-${type}-${size}.jpg`);
          const { fitted } = await renderHtml(html, { size, file }).catch((e) => (e.code === 'overflow' ? renderHtml(html, { size, file, floor: 0.45 }) : Promise.reject(e)));
          assert.ok(fitted.every((f) => f.fits), `${template} ${type} ${size}`);
        }
      }
    }
  } finally {
    await closeBrowser();
  }
});

test("the account's mark is drawn on the first and the last slide when the pack has one", async () => {
  const { home, cleanup } = tempHome();
  try {
    const brand = path.join(home, 'packs', 'demo', 'brand');
    mkdirSync(brand, { recursive: true });
    writeFileSync(path.join(brand, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="red"/></svg>');
    const pack = loadPack(path.join(home, 'packs', 'demo'));
    assert.ok(pack.brandLogo.endsWith('logo.svg'));
    const slide = { kind: 'cover', role: 'cover', hook: 'שלום', postKind: 'story', subject: {}, handle: 'demo', brand: 'data:image/svg+xml;base64,AAAA' };
    assert.match(page({ theme: pack.theme, size: 'tiktok', slide, parts: buildSlide(pack.theme, slide) }), /<img class="brand"/);
    const plain = { ...slide, brand: null };
    assert.doesNotMatch(page({ theme: pack.theme, size: 'tiktok', slide: plain, parts: buildSlide(pack.theme, plain) }), /class="brand"/);
  } finally {
    cleanup();
  }
});

test('a slide at its longest, a 60-character title and a 230-character text beside a five-row graphic, still fits', async () => {
  const pack = loadPack(DEMO);
  const dir = path.join(os.tmpdir(), `of-vis-long-${process.pid}`);
  const title = 'ב-Batch API כל השימוש מחויב ב-50% ממחיר הרגיל, וזה משנה';
  const body = 'אם אתם לא צריכים תשובה עכשיו, Message Batches API מחייב חצי מהמחיר על כל טוקן, ו-prompt caching חוסך עוד על מה שחוזר. אודיו בזמן אמת: $32 קלט מול $0.40 מה-cache, ככה כתוב במחירון.';
  const visual = normVisual({ type: 'stack', title: '', a: '', b: '', style: '', items: [['ממשק', 'Next.js', '', 'חינם'], ['מודל', 'Claude Sonnet 5.5', '', '$3 למיליון טוקנים של קלט'], ['מסד נתונים', 'Supabase', '', '$25 לחודש'], ['תשלומים', 'Stripe', '', '2.9% + 30¢ לעסקה'], ['אחסון', 'Vercel', '', '$20 לחודש למשתמש']].map(([label, value, value2, sub]) => ({ label, value, value2, sub })) });
  try {
    for (const template of ['card', 'corner', 'scoreboard', 'editorial']) {
      const theme = { ...pack.theme, template };
      for (const size of ['tiktok', 'instagram']) {
        const slide = { kind: 'item', role: 'beat', title, body, visual, hasVisual: true, handle: 'demo', postKind: 'story', subject: {}, keywords: [], pos: 2, total: 6, n: 2, of: 6, sources: ['Anthropic'] };
        // As renderPost does: the usual floor, then 45% for a slide at its fullest (TikTok's own buttons and caption
        // leave its slide a smaller safe area than Instagram's).
        const html = page({ theme, size, slide, parts: buildSlide(theme, slide) });
        const file = path.join(dir, `${template}-${size}.jpg`);
        const { fitted } = await renderHtml(html, { size, file }).catch((e) => (e.code === 'overflow' ? renderHtml(html, { size, file, floor: 0.45 }) : Promise.reject(e)));
        assert.ok(fitted.every((f) => f.fits), `${template} ${size}`);
      }
    }
  } finally {
    await closeBrowser();
  }
});

test('an account can keep its handle and its sources off the slides, stand every slide on a photograph and close with a follow slide', { timeout: 240_000 }, async () => {
  const { home, cleanup } = tempHome();
  try {
    const dir = copyPack(home, 'demo', (f) => {
      f.theme.options = { ...f.theme.options, handleTag: false, sourceLine: false, backgroundPhoto: true };
      f.theme.backgroundQueries = ['house plants'];
      f.pack.endSlide = { title: 'רוצים עוד?', body: 'עקבו אחרי {handle}' };
    });
    const pack = loadPack(dir);
    // The page: no handle, no source line, the background under its veil.
    const slide = { kind: 'item', role: 'beat', title: 'כותרת', body: 'גוף', postKind: 'story', subject: {}, handle: 'demo', noHandle: true, noSources: true, sources: ['ויקיפדיה'], n: 1, of: 3, pos: 1, total: 3 };
    const html = page({ theme: pack.theme, size: 'tiktok', slide, parts: buildSlide(pack.theme, slide), bg: 'data:image/jpeg;base64,AAAA' });
    assert.match(html, /class="[^"]*\bhas-bg\b[^"]*\bno-handle\b/);
    assert.match(html, /<img class="bgphoto"/);
    assert.doesNotMatch(html, /מקור:/);
    // The post: one more slide on each platform, the follow slide, and no call to action before it.
    const beat = (title) => ({ kind: 'item', role: 'beat', title, body: 'שורה אחת.', factKeys: [], sources: ['מקור'] });
    const slides = [{ kind: 'cover', role: 'cover', title: '', body: '', factKeys: [] }, beat('אחת'), beat('שתיים'), beat('שלוש'), { ...beat('סוף'), role: 'payoff' }];
    const extra = { captionIg: '', keywords: [], subject: {}, cta: 'שמרו את זה' };
    const post = { id: 'end-test', hook: 'שער לבדיקה', sub: '', caption: 'c', extra, ctaKind: 'save' };
    post.token = tokenOf({ slides, caption: post.caption, hook: post.hook, sub: post.sub, extra });
    const files = await renderPost({ pack, format: { id: 't', kind: 'story', name: 'x', hooks: ['x'] }, post, slides, outDir: path.join(home, 'media', 'end') });
    for (const p of pack.meta.platforms) assert.equal(files[p].length, slides.length + 1, `${p}: the follow slide is added`);
  } finally {
    await closeBrowser();
    cleanup();
  }
});
