import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { breakBlock, breakLine, labelIn, lineDraft, OVERLAY, overlayOf, overlayProblems, wordsOf } from '../src/rules/overlay.js';
import { readPack } from '../src/packs/load.js';
import { validatePack } from '../src/packs/validate.js';
import { tellsIn } from '../src/voice/tells.js';
import { linesRule } from '../src/pipeline/prompts.js';
import { padFor, page, SIZES } from '../src/render/html.js';
import { buildSlide } from '../src/render/templates/index.js';
import { closeBrowser, renderHtml } from '../src/render/render.js';
import { DEMO } from './helpers.js';

after(() => closeBrowser());

const draftOf = (cover, slides) => ({ hook: cover[0], sub: cover[1], slides: [{ kind: 'cover' }, ...slides.map(([title, body, role = 'beat']) => ({ kind: 'item', role, title, body }))] });
const codes = (p) => p.map((x) => `${x.where}: ${x.msg}`);

test('the defaults are the playbook: 4 to 6 words a line, 3 to 4 lines a slide, clear of the top 10% and the bottom 20%', () => {
  assert.deepEqual(OVERLAY.wordsPerLine, [4, 6]);
  assert.deepEqual(OVERLAY.linesPerSlide, [3, 4]);
  assert.deepEqual(OVERLAY.safeZone, { top: 0.1, bottom: 0.2 });
  const pack = { meta: { overlay: { wordsPerLine: [3, 7], safeZone: { bottom: 0.25 }, labels: ['שאלה'] } } };
  const o = overlayOf(pack);
  assert.deepEqual(o.wordsPerLine, [3, 7], 'a pack sets its own');
  assert.deepEqual(o.linesPerSlide, [3, 4], 'and keeps the rest');
  assert.deepEqual(o.safeZone, { top: 0.1, bottom: 0.25 });
  assert.ok(o.labels.includes('שאלה'));
});

test('a long line is broken in code: within the range, after a comma when it can, never between a number and what it counts', () => {
  const lines = breakLine('במרץ 2025 נסגר משרד קטן לשיפוץ, ועל מדף ליד חלון צפוני נשאר פוטוס בעציץ שאף אחד לא השקה', [4, 6]);
  for (const [i, l] of lines.entries()) {
    const n = wordsOf(l).length;
    assert.ok(n <= 6, `line ${i + 1} "${l}" has ${n} words`);
    if (i < lines.length - 1) assert.ok(n >= 4, `line ${i + 1} "${l}" is too short`);
  }
  assert.equal(lines[0], 'במרץ 2025 נסגר משרד קטן לשיפוץ,', 'the comma is where the line ends');
  for (const l of breakLine('תוך 3 שבועות צמחו שורשים ל-10 מתוך 12 הייחורים של הגנן מהמכון', [4, 6])) assert.ok(!/\d$/.test(l), `"${l}" ends on a number`);
  assert.deepEqual(breakLine('קצר מספיק', [4, 6]), ['קצר מספיק'], 'a short line is left alone');
  // A dash on its own is not a word, and never starts a line.
  assert.ok(breakLine('אחת שתיים שלוש ארבע חמש שש - שבע שמונה', [4, 6]).every((l) => !l.startsWith('-')));
});

test('the lines the writer broke are kept; only an overlong one is broken again', () => {
  assert.equal(breakBlock('שורה אחת קצרה\nושורה שנייה', [4, 6]), 'שורה אחת קצרה\nושורה שנייה');
  const out = breakBlock('שורה ראשונה שהכותב שבר\nושורה שנייה שהיא ארוכה מדי בשביל שקופית אחת', [4, 6]).split('\n');
  assert.equal(out[0], 'שורה ראשונה שהכותב שבר');
  assert.ok(out.length >= 3 && out.every((l) => wordsOf(l).length <= 6));
});

test('lineDraft breaks the cover and the slides, and leaves a list body one item a line', () => {
  const d = draftOf(['זה הכיסוי של הפוסט והוא ארוך מדי בשביל שורה אחת', ''], [
    ['הכותרת', 'גוף ארוך שהכותב לא שבר בכלל ולכן הקוד שובר אותו במקום הנכון'],
    ['שכבה', 'עובדה ראשונה שהיא ארוכה מאוד ויש בה הרבה מילים\nעובדה שנייה', 'layer'],
  ]);
  const changed = lineDraft(d);
  assert.ok(d.hook.includes('\n') && d.slides[1].body.includes('\n'));
  assert.equal(d.slides[2].body, 'עובדה ראשונה שהיא ארוכה מאוד ויש בה הרבה מילים\nעובדה שנייה', 'a layer keeps its items');
  assert.ok(changed.some((c) => c.startsWith('cover')));
});

test('the checks: too many words, too few, too many lines, too few lines', () => {
  const ok = draftOf(['הפוטוס שנשכח במשרד סגור,\nואיך הוא חזר', 'משרד נסגר לשיפוץ'], [['81 יום בלי אף אחד', 'במרץ 2025 נסגר משרד קטן.\nליד חלון צפוני נשאר פוטוס,\nואף אחד לא השקה אותו.']]);
  assert.deepEqual(overlayProblems(ok), []);
  const bad = draftOf(['שער\nבלי מילים', ''], [
    ['כותרת אחת עם יותר מדי מילים בשורה אחת', 'שורה\nושורה\nושורה\nושורה'],
    ['רק כותרת אחת כאן', ''],
  ]);
  const p = codes(overlayProblems(bad));
  assert.ok(p.some((x) => /^cover: line 1 has 1 words: at least 4/.test(x)), p.join('\n'));
  assert.ok(p.some((x) => /^cover: 2 lines of text: at least 3/.test(x)));
  assert.ok(p.some((x) => /^slide 1 title: line 1 has 8 words: at most 6/.test(x)));
  assert.ok(p.some((x) => /^slide 1: 5 lines of text: at most 4/.test(x)));
  assert.ok(p.some((x) => /^slide 2: one line of text: at least 3/.test(x)));
  assert.ok(overlayProblems(bad).every((x) => x.code === 'overlay'));
});

test('a pack that asks for other numbers is checked by them', () => {
  const d = draftOf(['שער של שתי מילים', ''], [['כותרת', '']]);
  assert.ok(overlayProblems(d).length);
  assert.deepEqual(overlayProblems(d, { meta: { overlay: { wordsPerLine: [1, 6], linesPerSlide: [1, 4] } } }), []);
});

test('a list body (places 10 to 6, a layer) is neither counted nor broken', () => {
  const d = draftOf(['מה שאף אחד לא יודע\nעל הבזיליקום שלכם', 'וזה רק החלק העליון'], [['מה שכולם יודעים', 'צריך שמש\nאוהב מים\nלא אוהב קור\nפורח בקיץ', 'layer']]);
  assert.deepEqual(overlayProblems(d), []);
});

test('reactions, not labels: a title that names the part is refused', () => {
  for (const t of ['טיפ 3', 'טיפ מספר 3', 'שלב שני', 'עובדה', 'התפנית', 'השורה התחתונה', '3', '#2', 'Step 2']) assert.ok(labelIn(t), `"${t}" is a label`);
  assert.ok(labelIn('עובדה: נענע שורדת כפור'), 'a heading glued to the front');
  for (const t of ['81 יום בלי אף אחד', 'אחרי 81 יום, ואף טיפה', 'פרחים? מורידים מיד', 'זה לא צמח אחד', 'השעה: 10 בבוקר']) assert.equal(labelIn(t), null, `"${t}" is a reaction`);
  assert.ok(labelIn('שאלה', ['שאלה']), "the pack's own label words");
  const d = draftOf(['הפוטוס שנשכח במשרד סגור,\nואיך הוא חזר', 'משרד נסגר לשיפוץ'], [['טיפ 1', 'משקים רק כשהאדמה יבשה,\nלא לפי השעון']]);
  assert.ok(codes(overlayProblems(d)).some((x) => /^slide 1 title: a label, not a reaction/.test(x)));
});

test('a line break on a slide is not a new sentence; in a caption it still is', () => {
  const body = 'במרץ 2025 נסגר משרד קטן\nלשיפוץ, ועל מדף ליד חלון\nנשאר פוטוס בעציץ';
  assert.ok(!tellsIn(body, { kind: 'slideBody' }).some((x) => /sentences/.test(x.msg)), 'three lines of one sentence');
  assert.ok(tellsIn('שורה אחת\nשורה שתיים\nשורה שלוש\nשורה ארבע\nשורה חמש', { kind: 'captionShort' }).some((x) => /sentences/.test(x.msg)));
});

test('pack.json overlay is validated', () => {
  const pack = readPack(DEMO);
  assert.deepEqual(validatePack(pack), []);
  pack.meta.overlay = { wordsPerLine: [6, 4], linesPerSlide: [3], safeZone: { top: 0.5 }, outline: 2, labels: [''], extra: 1 };
  const p = validatePack(pack).join('\n');
  for (const k of ['wordsPerLine', 'linesPerSlide', 'safeZone', 'outline', 'labels', 'overlay.extra']) assert.match(p, new RegExp(k));
});

test("the writer is told the account's own numbers", () => {
  assert.match(linesRule(), /4 to 6 words a line/);
  assert.match(linesRule(), /3 to 4 lines on a slide/);
  assert.match(linesRule({ meta: { overlay: { wordsPerLine: [3, 8] } } }), /3 to 8 words a line/);
  assert.match(linesRule(), /"\\n"/, 'the break is named as the two characters the JSON answer carries');
});

test('the frame keeps out of the safe zone: Instagram is pushed in, TikTok already clears it', () => {
  assert.deepEqual(padFor('tiktok'), SIZES.tiktok.pad, "TikTok's own padding is wider than 10% and 20%");
  const ig = padFor('instagram');
  assert.equal(ig.top, Math.ceil(0.1 * 1350));
  assert.equal(ig.bottom, Math.ceil(0.2 * 1350));
  assert.equal(padFor('instagram', { safeZone: { top: 0, bottom: 0 } }).bottom, SIZES.instagram.pad.bottom, 'never less than the platform needs');
});

const pack = readPack(DEMO);
const out = mkdtempSync(path.join(os.tmpdir(), 'of-overlay-'));
const photo = `data:image/png;base64,${readFileSync(path.join(DEMO, '..', '..', '..', 'docs', 'screenshots', 'today-desktop.png')).toString('base64')}`;
const item = { kind: 'item', role: 'beat', title: '81 יום בלי אף אחד', body: 'במרץ 2025 נסגר משרד קטן.\nליד חלון צפוני נשאר פוטוס,\nואף אחד לא השקה אותו.', n: 1, of: 5, pos: 1, total: 5, handle: 'demo.atzitz' };

test('the renderer refuses a line of text inside the safe zone', async () => {
  const parts = buildSlide(pack.theme, item);
  parts.html += '<div style="position:absolute;top:20px;right:120px;font-size:40px">שורה בתוך האזור</div>';
  await assert.rejects(renderHtml(page({ theme: pack.theme, size: 'tiktok', slide: item, parts }), { size: 'tiktok', file: path.join(out, 'zone.jpg') }), (e) => e.code === 'safe_zone' && /שורה בתוך האזור/.test(e.message));
  // A wider zone on the account's own: the same slide is refused at the bottom too.
  const low = buildSlide(pack.theme, item);
  low.html += '<div style="position:absolute;bottom:400px;right:120px;font-size:40px">שורה למטה</div>';
  await renderHtml(page({ theme: pack.theme, size: 'tiktok', slide: item, parts: low }), { size: 'tiktok', file: path.join(out, 'low-ok.jpg') }).catch((e) => assert.fail(`400px from the bottom clears 20% (384px): ${e.message}`));
  await assert.rejects(renderHtml(page({ theme: pack.theme, overlay: { safeZone: { bottom: 0.3 } }, size: 'tiktok', slide: item, parts: low }), { size: 'tiktok', file: path.join(out, 'low.jpg') }), (e) => e.code === 'safe_zone');
});

test('text over a picture is outlined; text on the plain ground is not', async () => {
  const plain = await renderHtml(page({ theme: pack.theme, size: 'instagram', slide: item, parts: buildSlide(pack.theme, item) }), { size: 'instagram', file: path.join(out, 'plain.jpg') });
  assert.equal(plain.outlined, 0);
  const over = await renderHtml(page({ theme: pack.theme, size: 'instagram', slide: item, parts: buildSlide(pack.theme, item), bg: photo }), { size: 'instagram', file: path.join(out, 'bg.jpg') });
  assert.ok(over.outlined > 0, 'the backdrop: every line on it is outlined');
  const cover = { kind: 'cover', hook: 'הפוטוס שנשכח במשרד סגור,\nואיך הוא חזר', sub: 'משרד נסגר לשיפוץ', handle: 'demo.atzitz', hasPhoto: true };
  const onPhoto = await renderHtml(page({ theme: pack.theme, size: 'tiktok', slide: cover, parts: buildSlide(pack.theme, cover), photo }), { size: 'tiktok', file: path.join(out, 'photo.jpg') });
  assert.ok(onPhoto.outlined >= 2, 'the cover line and the line under it');
  const none = await renderHtml(page({ theme: pack.theme, overlay: { outline: 0 }, size: 'tiktok', slide: cover, parts: buildSlide(pack.theme, cover), photo }), { size: 'tiktok', file: path.join(out, 'none.jpg') });
  assert.equal(none.outlined, 0);
});
