import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPack } from '../src/packs/load.js';
import { tellsIn } from '../src/voice/tells.js';
import { experienceIn, fakeProofIn, badgeNextTo } from '../src/voice/honesty.js';
import { heuristicReview, REWRITE_AT } from '../src/voice/review.js';
import { checkRules } from '../src/rules/check.js';
import { commonsLicenseOk } from '../src/images/index.js';
import { DEMO } from './helpers.js';

const pack = readPack(DEMO);

test("the pack's own bad lines are caught and its good lines pass", () => {
  for (const line of pack.examples.bad) assert.ok(tellsIn(line, { kind: 'slideBody', extra: pack.rules.bannedPhrases }).length || experienceIn(line), `bad line passed: ${line}`);
  for (const line of pack.examples.good) assert.deepEqual(tellsIn(line, { kind: 'slideBody' }), [], `good line refused: ${line}`);
});

test('stock connectives, formal words, filler, exclamation marks and long dashes are tells', () => {
  const t = (s) => tellsIn(s, { kind: 'slideBody' }).map((x) => x.code);
  assert.ok(t('חשוב לציין שזה עובד').includes('phrase'));
  assert.ok(t('ניתן להשקות פעמיים').includes('phrase'));
  assert.ok(t('צמח מדהים לבית').includes('phrase'));
  assert.ok(t('תשקו עכשיו!').includes('register'));
  assert.ok(t('השקיה — פעם בשבוע').includes('structure'));
  assert.ok(t('ככה זה עובד...').includes('structure'));
  assert.ok(t('פרטים ב-www.example.com').includes('url'));
});

test('the audience is addressed in the plural: a singular "you" is a tell', () => {
  assert.ok(tellsIn('אם אתה רוצה עציץ גדול', { kind: 'slideBody' }).some((x) => x.code === 'phrase'));
  assert.deepEqual(tellsIn('אם אתם רוצים עציץ גדול', { kind: 'slideBody' }), []);
});

test('no fake personal experience: a memory is refused, a planner conditional is not', () => {
  for (const s of ['ניסיתי את זה במרפסת', 'כשהייתי בגינה ראיתי את זה', 'היינו שם בקיץ', 'קניתי שתיל בסופר', 'מהניסיון שלי זה עובד']) assert.ok(experienceIn(s), s);
  for (const s of ['ככה היינו בונים את הרשימה', 'היינו ממליצים לבדוק את האדמה', 'תנסו את זה במרפסת']) assert.equal(experienceIn(s), null, s);
});

test('no fake badges or metrics about the account', () => {
  for (const s of ['כבר 50K עוקבים', 'אלפי צפיות בכל פוסט', 'חשבון רשמי ומאומת', 'החשבון #1 בטיקטוק']) assert.ok(fakeProofIn(s), s);
  assert.equal(fakeProofIn('בזיליקום צריך 6 שעות שמש'), null);
  assert.ok(badgeNextTo('עציץ ושמש ✅', 'עציץ ושמש'));
  assert.ok(checkRules({ pack, texts: [{ where: 'caption', text: 'כבר 10,000 עוקבים סומכים עלינו' }] }).some((p) => p.code === 'honesty:proof'));
});

test('the offline reviewer scores a bot-sounding text at the rewrite threshold or above', () => {
  const [bot, human] = heuristicReview(
    [
      { where: 'a', kind: 'slideBody', text: 'חשוב לציין שבזיליקום הוא צמח מדהים! בנוסף, ניתן לגדל אותו בקלות.' },
      { where: 'b', kind: 'slideBody', text: 'בזיליקום צריך לפחות 6 שעות שמש ביום. פחות מזה, והעלים נהיים קטנים.' },
    ],
    pack
  );
  assert.ok(bot.botScore >= REWRITE_AT, `bot scored ${bot.botScore}`);
  assert.ok(human.botScore < REWRITE_AT, `human scored ${human.botScore}`);
});

test('image licences: only public domain, CC0, CC BY and CC BY-SA from Commons', () => {
  for (const ok of ['CC0', 'Public domain', 'CC BY 4.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0']) assert.ok(commonsLicenseOk(ok), ok);
  for (const no of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'CC BY-NC-SA 3.0', 'Fair use', '', 'All rights reserved']) assert.equal(commonsLicenseOk(no), false, no);
});
