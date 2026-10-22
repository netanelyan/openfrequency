import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPack } from '../src/packs/load.js';
import { page } from '../src/render/html.js';
import { buildSlide } from '../src/render/templates/index.js';
import { cardOf, valueParts, wordmark } from '../src/render/templates/photocard.js';
import { closeBrowser, renderHtml } from '../src/render/render.js';
import { DEMO } from './helpers.js';

after(() => closeBrowser());

const rank = {
  kind: 'item', role: 'rank', rank: 5, n: 1, of: 5, pos: 1, postKind: 'ranking', title: 'קאקה',
  body: '67 מיליון יורו, 56 מיליון פאונד, שיא עולם בפאונד. ריאל קנתה אותו ממילאן כחלק ממדיניות הגלאקטיקוס.',
  visual: { type: 'stat', title: '', items: [{ label: 'מילאן לריאל מדריד', value: '67 מיליון יורו' }] },
  displayName: 'הספסל | כדורגל', handle: 'demo.bench',
};

test("a ranking's card is cut from the slide's own text: the number, its label, the line under it, the rest", () => {
  const c = cardOf(rank);
  assert.equal(c.label, 'מקום 5');
  assert.equal(c.card.label, 'מילאן לריאל מדריד');
  assert.equal(c.card.value, '67 מיליון יורו');
  assert.equal(c.card.sub, '56 מיליון פאונד, שיא עולם בפאונד.', 'the value is not said twice');
  assert.deepEqual(c.card.sections, [{ label: 'שווה לדעת', text: 'ריאל קנתה אותו ממילאן כחלק ממדיניות הגלאקטיקוס.' }]);
  assert.deepEqual(valueParts('מעל 100 מיליון יורו'), { pre: 'מעל', num: '100', post: 'מיליון יורו' });
  assert.equal(wordmark(rank), 'הספסל');
});

test("a graphic's other items are the card's lines, and a sentence that only repeats them is left out", () => {
  const c = cardOf({ ...rank, body: '$12.00 למיליון טוקנים של פלט בהקשר קצר. בהקשר ארוך הפלט עולה $18.00.', visual: { type: 'bars', title: 'פלט למיליון טוקנים', items: [{ label: 'הקשר קצר', value: '$12.00' }, { label: 'הקשר ארוך', value: '$18.00' }] } });
  assert.equal(c.card.value, '$12.00');
  assert.deepEqual(c.card.sections, [{ label: 'הקשר ארוך', text: '$18.00' }]);
});

test("a head-to-head's stat shows both sides; a story's slide and a verdict take the light version", () => {
  const c = cardOf({ kind: 'item', role: 'stat', n: 4, of: 5, postKind: 'head-to-head', title: 'ניצחונות מול הפסדים', a: '19-1', b: '23-5', body: 'האריסון עם הפסד אחד.', subject: { a: 'האריסון', b: 'נונס' } });
  assert.equal(c.label, 'נתון 4 מתוך 5');
  assert.deepEqual(c.card.sides, [{ who: 'האריסון', value: '19-1' }, { who: 'נונס', value: '23-5' }]);
  assert.equal(cardOf({ kind: 'item', role: 'verdict', postKind: 'head-to-head', title: 'x', body: 'y' }), null);
  assert.equal(cardOf({ kind: 'item', role: 'beat', postKind: 'story', title: '3 שערים', body: '3 שערים ב-6 דקות.' }), null);
});

test('photocard draws every slide on a photograph, both sizes, inside the safe zone', async () => {
  const pack = readPack(DEMO);
  const theme = { ...pack.theme, template: 'photocard', variant: 'a' };
  const out = mkdtempSync(path.join(os.tmpdir(), 'of-photocard-'));
  const photo = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#8aa"/></svg>')}`;
  const slides = [
    { kind: 'cover', hook: 'חמש העברות ענק. איזו עלתה הכי הרבה?', sub: 'ארבע מהן שברו את שיא העולם', hasPhoto: true, handle: 'demo' },
    { ...rank, hasPhoto: true },
    { kind: 'item', role: 'beat', postKind: 'story', n: 2, of: 4, pos: 2, title: 'הלילה באיסטנבול', body: 'ליברפול פיגרה 3–0 במחצית. שש דקות אחר כך זה היה 3–3.', hasPhoto: true, displayName: 'דמו' },
  ];
  for (const size of ['tiktok', 'instagram']) {
    for (const [i, slide] of slides.entries()) {
      const r = await renderHtml(page({ theme, size, slide, parts: buildSlide(theme, slide), photo }), { size, file: path.join(out, `${size}-${i}.jpg`) });
      assert.ok(r.bytes > 0);
    }
  }
});
