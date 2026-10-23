import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPack } from '../src/packs/load.js';
import { validateAll, validatePack } from '../src/packs/validate.js';
import { closeBrowser, getBrowser, renderHtml } from '../src/render/render.js';
import { stylePage, themeOf } from '../src/render/styles/index.js';
import { displayText, highlightIn, slideModel, textHtml } from '../src/render/styles/model.js';
import { fitText, highlightProblems, styleFitProblems, boxFor } from '../src/render/styles/fit.js';
import { resolveStyle, STYLE_NAMES, STYLES, styleConfigProblems } from '../src/render/styles/tokens.js';
import { SAFE_ZONES, zonesFor } from '../src/rules/overlay.js';
import { suggestStyle } from '../src/onboarding/style.js';
import { judgeStyles } from '../src/metrics/feedback.js';
import { previewHighlight } from '../src/render/styles/preview.js';
import { DEMO } from './helpers.js';

after(() => closeBrowser());

const out = mkdtempSync(path.join(os.tmpdir(), 'of-styles-'));
const photo = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#e8e4d8"/><rect y="900" width="1200" height="700" fill="#556"/></svg>')}`;
const pack = readPack(DEMO);
const themed = (name) => themeOf({ ...pack, meta: { ...pack.meta, style: { name } } });

const cover = { kind: 'cover', hook: 'הקרב שלא קרה:\nנגאנו מול קורמיה', sub: 'שיא עולמי מול המכה הכי חזקה', highlight: 'נגאנו', category: 'ראש בראש', photo };
const number = {
  kind: 'item', role: 'rank', rank: 5, n: 1, of: 5, pos: 1, postKind: 'ranking', title: 'קאקה עבר לריאל', highlight: 'ריאל',
  body: '67 מיליון יורו, שיא עולם בזמנו. ריאל קנתה אותו ממילאן.', visual: { type: 'stat', title: '', items: [{ label: 'מילאן לריאל', value: '67 מיליון יורו' }] }, photo,
};
const text = { kind: 'item', role: 'beat', postKind: 'story', n: 2, of: 4, pos: 2, title: 'הלילה באיסטנבול', body: 'ליברפול פיגרה 3–0 במחצית.\nשש דקות אחר כך זה היה 3–3.' };
const slides = { cover, number, text };

const draw = (name, slide, size = 'tiktok') => stylePage({ theme: themed(name), size, slide });

test('every style draws a cover, a number slide and a text slide, on TikTok and on Instagram 4:5, inside the safe zones', async () => {
  for (const name of STYLE_NAMES) {
    for (const size of ['tiktok', 'instagram']) {
      for (const [k, slide] of Object.entries(slides)) {
        // Not lenient: a line in a safe zone, or a text over its style's lines at its floor, throws.
        const r = await renderHtml(draw(name, slide, size), { size, file: path.join(out, `${name}-${size}-${k}.jpg`) });
        assert.ok(r.bytes > 0, `${name} ${size} ${k}`);
        assert.deepEqual(r.warnings, []);
      }
    }
  }
});

test('no outline and no shadow on any letter, and no progress bar, counter, dots or handle on a slide', async () => {
  const browser = await getBrowser();
  const tab = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  try {
    for (const name of STYLE_NAMES) {
      for (const slide of Object.values(slides)) {
        const html = draw(name, { ...slide, handle: 'demo.bench', displayName: 'דמו' });
        assert.doesNotMatch(html, /class="(track|count|dots|ghost|qmark|handle-tag|bgphoto|bgveil)"/);
        assert.doesNotMatch(html, /@demo\.bench/, 'the handle is not on a slide');
        await tab.setContent(html);
        const bad = await tab.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .map((el) => getComputedStyle(el))
            .filter((cs) => cs.textShadow !== 'none' || parseFloat(cs.webkitTextStrokeWidth) > 0 || /blur/.test(cs.filter)).length
        );
        assert.equal(bad, 0, `style ${name}`);
      }
    }
  } finally {
    await tab.close();
  }
});

test('the safe zones are px on all four sides, and a line in a side band is refused', async () => {
  assert.deepEqual(SAFE_ZONES.tiktok, { top: 140, bottom: 420, right: 152, left: 152 });
  assert.deepEqual(SAFE_ZONES.instagram, { top: 80, bottom: 120, right: 96, left: 96 });
  // An account's own wider band (pack.json overlay.safeZone) widens it.
  assert.equal(zonesFor('tiktok', { safeZone: { top: 0.12 } }).top, Math.ceil(0.12 * 1920));
  const html = draw('D', text).replace('</style>', '.blk{left:40px!important;right:40px!important}.bd{white-space:nowrap}</style>');
  await assert.rejects(renderHtml(html.replace('ליברפול פיגרה 3–0 במחצית.', 'ליברפול פיגרה 3–0 במחצית והאוהדים כבר עזבו את היציע'), { size: 'tiktok', file: path.join(out, 'side.jpg') }), (e) => e.code === 'safe_zone');
});

test('a highlight is drawn once a slide, only on words of its own headline', async () => {
  assert.equal((textHtml('גול ועוד גול', { highlight: 'גול' }).match(/<mark/g) || []).length, 1);
  assert.equal(textHtml('גול ועוד גול', { highlight: 'שער' }).includes('<mark'), false, 'words not in the headline are never added');
  const browser = await getBrowser();
  const tab = await browser.newPage();
  try {
    for (const name of STYLE_NAMES) {
      await tab.setContent(draw(name, { ...cover, sub: 'נגאנו נגאנו נגאנו' }));
      assert.equal(await tab.evaluate(() => document.querySelectorAll('mark.hi').length), 1, `style ${name}`);
    }
  } finally {
    await tab.close();
  }
  const d = { hook: 'שיא של 17 הגשות', slides: [{ kind: 'cover', highlight: '17 הגשות' }, { kind: 'item', title: 'אוליביירה בשיא', highlight: 'מקגרגור' }, { kind: 'item', title: 'ארבע מילים בלי הדגשה', highlight: 'ארבע מילים בלי הדגשה' }] };
  const ps = highlightProblems(d);
  assert.deepEqual(ps.map((p) => p.where), ['slide 1 title', 'slide 2 title']);
  assert.match(ps[0].msg, /not words of the title/);
});

test('fonts are bundled and inlined: the page names no address, and the renderer (with no network) checks every face', async () => {
  for (const name of STYLE_NAMES) {
    const html = draw(name, cover);
    assert.doesNotMatch(html.replace(/data:[^)"']+/g, ''), /https?:\/\//, 'nothing is fetched');
    const families = [...new Set([...html.matchAll(/font-family:'([^']+)'/g)].map((m) => m[1]))];
    for (const f of families) assert.ok(['Heebo', 'Assistant', 'Rubik', 'Karantina', 'Karantina Headline'].includes(f), f);
  }
  // renderHtml aborts every request and refuses a page whose faces did not load: a render that passes loaded them.
  const r = await renderHtml(draw('B', cover), { size: 'tiktok', file: path.join(out, 'fonts.jpg') });
  assert.ok(r.bytes > 0);
});

test('a headline is set smaller in steps down to its floor before it takes a line; past the floor it is the writer\'s', async () => {
  const S = STYLES.A.text.hook;
  const box = boxFor(S);
  const short = fitText('שיא של 17', S, { box });
  assert.equal(short.ok, true);
  assert.equal(short.px, S.px, 'a short headline keeps its size');
  const two = fitText('17 הגשות בקריירה\nשיא של כל הזמנים', S, { box });
  assert.ok(two.ok && two.px < S.px && two.px >= S.floor, `shrunk to ${two.px}`);
  const long = fitText('מי שווה הכי הרבה בעולם ה-AI? חמש חברות, מדד אחד ושווי אחד שמשנה את כל התמונה של השוק', S, { box });
  assert.equal(long.ok, false);
  assert.equal(long.px, S.floor);
  // The renderer agrees: drawn at its floor and refused.
  const html = draw('A', { ...cover, hook: 'מי שווה הכי הרבה בעולם ה-AI? חמש חברות, מדד אחד ושווי אחד שמשנה את כל התמונה של השוק' });
  await assert.rejects(renderHtml(html, { size: 'tiktok', file: path.join(out, 'long.jpg') }), (e) => e.code === 'fit');
  const lenient = await renderHtml(html, { size: 'tiktok', file: path.join(out, 'long2.jpg'), lenient: true });
  assert.ok(lenient.warnings.some((w) => w.code === 'fit'));
  // And the check sends it back to the writer, on the cover, through the repair loop.
  const draft = { hook: 'מי שווה הכי הרבה בעולם ה-AI? חמש חברות, מדד אחד ושווי אחד שמשנה את כל התמונה של השוק', sub: '', slides: [{ kind: 'cover' }] };
  const ps = styleFitProblems(draft, { style: 'A' });
  assert.equal(ps[0].where, 'cover');
  assert.equal(ps[0].code, 'fit');
  assert.match(ps[0].msg, /Shorten it to about \d+ characters/);
  // A headline the browser fits at a smaller size is drawn no smaller than its floor.
  const r = await renderHtml(draw('D', { ...cover, hook: '17 הגשות בקריירה\nשיא של כל הזמנים' }), { size: 'tiktok', file: path.join(out, 'shrunk.jpg') });
  const hook = r.fitted.find((f) => /הגשות/.test(f.text));
  assert.ok(hook.to >= STYLES.D.text.hook.floor && hook.to <= STYLES.D.text.hook.px);
});

test('no line ends on one word alone, punctuation stays on its word, two Latin words stay one run', () => {
  assert.equal(displayText('הקרב שלא קרה\nנגאנו'), 'הקרב שלא קרה נגאנו', 'a one-word last line joins the line before');
  assert.equal(displayText('מה קרה לרונאלדיניו אחרי בארסה?'), 'מה קרה לרונאלדיניו אחרי בארסה?');
  assert.equal(displayText('הניצחון של Better Place'), 'הניצחון של Better Place', 'never glued inside a Latin run');
  assert.equal(displayText('שתי דקות – ושער'), 'שתי דקות – ושער', 'a dash on its own stays with the word before it');
  assert.ok(highlightIn('בעולם ה-AI?', 'AI'));
});

test("a slide is a number slide when its point is a number, else a title and its text", () => {
  assert.equal(slideModel(number).kind, 'number');
  assert.equal(slideModel(number).value.num, '67');
  assert.equal(slideModel(text).kind, 'text');
  assert.equal(slideModel({ kind: 'item', role: 'beat', postKind: 'story', title: 'x', body: 'y', visual: { type: 'stat', title: 'שערים', items: [{ label: 'בעונה', value: '34' }] } }).kind, 'number');
});

test('pack.json style: the tokens, the brand colour over the accent unless it does not read, and the spread', () => {
  assert.deepEqual(styleConfigProblems({ name: 'B', accent: '#FFD23F' }), []);
  assert.match(styleConfigProblems({ name: 'E' })[0], /style.name/);
  assert.match(styleConfigProblems({ name: 'C', panel: '#333333' }).join(' '), /needs 7:1/);
  assert.equal(resolveStyle({ name: 'B' }, '#FFD23F').colors.accent, '#FFD23F', 'the brand colour');
  assert.equal(resolveStyle({ name: 'C' }, '#FFD23F').colors.accent, STYLES.C.tokens.accent, 'yellow does not read on the light panel');
  assert.equal(resolveStyle({ name: 'A', accent: '#FF5A5F' }, '#4C8DFF').colors.accent, '#FF5A5F', "the pack's own token first");
  const a = { ...pack, dirName: 'demo', meta: { ...pack.meta, style: { name: 'B', accent: '#FFD23F' } } };
  assert.deepEqual(validatePack(a).filter((p) => /style/.test(p)), []);
  const b = { ...pack, meta: { ...pack.meta, id: 'other', handle: 'other.x', displayName: 'אחר', zernio: {}, style: { name: 'B', accent: '#FFCF40' } }, theme: { ...pack.theme, template: 'poster', fonts: { ...pack.theme.fonts, display: 'Suez One' }, colors: { ...pack.theme.colors, bg: '#FFFFFF', accent: '#A00000' } } };
  assert.ok(validateAll([a, b]).some((p) => /share style B/.test(p)));
});

test('onboarding suggests a style from the niche and the brand, away from a look-alike', () => {
  assert.equal(suggestStyle({ niche: 'כדורגל' }).name, 'B');
  assert.equal(suggestStyle({ niche: 'סטארטאפים ומחירי מוצרים', topics: ['AI', 'founders'] }).name, 'A');
  assert.equal(suggestStyle({ niche: 'מתכונים לילדים' }, { bg: '#FFF8F0' }).name, 'C');
  assert.equal(suggestStyle({ niche: 'היסטוריה' }).name, 'D');
  assert.equal(suggestStyle({ niche: 'תחביבים' }).name, 'D', 'the default');
  assert.notEqual(suggestStyle({ niche: 'אופנה' }, { bg: '#050505' }).name, 'C', 'a strongly dark brand never gets C');
  const other = { meta: { topics: ['כדורגל'], style: { name: 'B' } }, theme: { colors: { accent: '#FFC24D' } } };
  const s = suggestStyle({ niche: 'כדורגל' }, { accent: '#FFC850' }, [other]);
  assert.notEqual(s.name, 'B', 'the second football account in a close colour gets the next best');
  assert.equal(suggestStyle({ niche: 'כדורגל' }, { accent: '#2F6BFF' }, [other]).name, 'B', 'another colour may share the style');
});

test('a style test is judged on views and engagement together, and not at all on too few posts', () => {
  const row = (style, views, engagement) => ({ style, views, engagement });
  const rows = [row('A', 1000, 50), row('A', 1200, 60), row('A', 900, 40), row('B', 3000, 200), row('B', 2500, 150), row('B', 2800, 160)];
  assert.equal(judgeStyles(rows, ['A', 'B']).winner, 'B');
  assert.equal(judgeStyles(rows.slice(0, 4), ['A', 'B']).winner, null);
});

test("a preview's highlight is chosen in code only where a post has none: a number or a name, never the whole headline", () => {
  assert.equal(previewHighlight('ב-2003 הוא חתם בבארסה'), '2003');
  assert.equal(previewHighlight('מי שווה הכי הרבה בעולם ה-AI?'), 'AI');
  assert.equal(previewHighlight('Thinking Machines Lab'), '');
  assert.equal(previewHighlight('הקרב שלא קרה'), '');
});
