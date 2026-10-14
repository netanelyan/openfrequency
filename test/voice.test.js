import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPack } from '../src/packs/load.js';
import { tellsIn } from '../src/voice/tells.js';
import { experienceIn, fakeProofIn, badgeNextTo } from '../src/voice/honesty.js';
import { heuristicReview, REWRITE_AT } from '../src/voice/review.js';
import { checkRules } from '../src/rules/check.js';
import { commonsLicenseOk, imageCredit, namesIn, needsCredit, once } from '../src/images/index.js';
import { Db } from '../src/db/index.js';
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
  assert.ok(t('הכול ב-example.com/sale עכשיו').includes('url'));
  // A company named for its domain is a name, not a link.
  assert.ok(!t('monday.com שינתה את השם שלה ב-2017').includes('url'));
  // A list of four short things is a tell; one score written the way fans read it is one thing.
  assert.ok(t('פוטוס, זמיה, קקטוס, אלוורה וסנסיווריה.').includes('structure'));
  assert.ok(!t('ב-23 במרץ 1988, בוולינגטון, ישראל 9, טייוואן 0.').includes('structure'));
  assert.ok(t('מכבי 5, הפועל 4, בית"ר 0, בני 1.').includes('structure'), 'four scores in a row are still a list');
  assert.ok(!t('באותה שנה, ב-14 בנובמבר, AI21 הוציאה את Wordtune Read, שמסכם אתרים וסרטונים.').includes('structure'), 'clauses around a long one are a sentence');
});

test('lengths fit the text: a long TikTok caption, a short Instagram one, a body of lines, a name as a title', () => {
  const codes = (s, kind) => tellsIn(s, { kind }).map((x) => x.code);
  const long = 'גוגל קנתה את וייז ב-2013, אחרי שנים שבהן המפה נבנתה מהנהגים עצמם ומהדיווחים שלהם בכביש. '.repeat(5);
  assert.ok(codes(long, 'caption').includes('length'), 'a phase 1 caption stays short');
  assert.ok(!codes(long, 'captionLong').includes('length'), 'the TikTok caption has room');
  assert.ok(!codes('פוטוס\nזמיה\nסנסיווריה\nקקטוס\nאלוורה', 'slideLines').includes('length'), 'five places are five lines, not five sentences');
  assert.ok(!codes('Fiverr', 'slideTitle').includes('language'), 'the answer of a guess-who is a name');
  assert.ok(codes('This is an English sentence on a slide.', 'slideBody').includes('language'));
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

test('a photo whose licence asks for credit is credited in the caption, and others are not', () => {
  assert.ok(needsCredit('CC BY-SA 4.0') && needsCredit('CC BY 2.0'));
  assert.ok(!needsCredit('CC0') && !needsCredit('Public domain') && !needsCredit('Pexels License'));
  const db = new Db(':memory:');
  try {
    const at = new Date().toISOString();
    const by = db.insert('images', { provider: 'commons', license: 'CC BY-SA 4.0', author: 'A. Photographer', created_at: at });
    const free = db.insert('images', { provider: 'pexels', license: 'Pexels License', author: 'B', created_at: at });
    assert.equal(imageCredit(db, { slides: [{ image_id: by }] }), 'צילום: A. Photographer · CC BY-SA 4.0 · Wikimedia Commons');
    assert.equal(imageCredit(db, { slides: [{ image_id: free }] }), '');
    assert.equal(imageCredit(db, { slides: [{ image_id: null }] }), '');
  } finally {
    db.close();
  }
});

test("a photo found for a person names that person, not just a word of the name", () => {
  assert.ok(!namesIn('File:Rudder_Rock,_Steep_Holm_Island.jpg', ['Holly', 'Holm']), 'a rock on Steep Holm is not Holly Holm');
  assert.ok(!namesIn('File:Senecio_serra_-_tall_ragwort.jpg', ['Matt', 'Serra', 'Georges', 'St-Pierre']), 'a plant is not Matt Serra');
  assert.ok(!namesIn('File:Holly_with_very_unevenly_distributed_berries,_Holm_Hill.jpg', ['Holly', 'Holm']), 'both words, apart, are not the name');
  assert.ok(namesIn('File:Georges_St-Pierre_2014.jpg', ['Matt', 'Serra', 'Georges', 'St-Pierre']), 'either person in the query');
  assert.ok(namesIn('File:Holly_Holm_at_UFC_Fight_Night.jpg', ['Holly', 'Holm']));
  assert.ok(namesIn('File:Khabib_nurmagomedov_interview_2022.jpg', ['Khabib', 'Nurmagomedov', 'Gaethje']));
  assert.ok(namesIn('Pele.jpg', ['Pele']), 'a query with one name needs that one');
});

test("a photo's author is named once, even when the source's markup names them twice", () => {
  assert.equal(once('Unknown author Unknown author'), 'Unknown author');
  assert.equal(once('Airotcivss'), 'Airotcivss');
  assert.equal(once('Matt Lavin'), 'Matt Lavin');
});
