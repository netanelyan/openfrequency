import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inShabbat, inRest, restAt, restWindow, assertNotShabbat, shabbatWindow, ShabbatError } from '../src/schedule/shabbat.js';
import { hebrewDate, yomTovBetween, yomTovOn } from '../src/schedule/hebrew.js';
import { sunset } from '../src/schedule/sun.js';
import { addDays, hhmm, israelInstant } from '../src/schedule/israel.js';
import { postsOn, slotsFor } from '../src/schedule/slots.js';

// HARD RULE 9: nothing posts from Friday sunset to Saturday night, Israel time.

const il = (date, time) => israelInstant(date, time).getTime();

test('sunset in Jerusalem matches published tables to within a few minutes', () => {
  // Published Jerusalem sunsets: about 18:06 mid-October (summer time), 16:38
  // mid-December, 19:47 at the June solstice.
  const near = (date, want) => {
    const [h, m] = hhmm(sunset(date)).split(':').map(Number);
    const [wh, wm] = want.split(':').map(Number);
    assert.ok(Math.abs(h * 60 + m - (wh * 60 + wm)) <= 4, `${date}: ${hhmm(sunset(date))} vs ${want}`);
  };
  near('2026-10-16', '18:06');
  near('2026-12-18', '16:38');
  near('2026-06-19', '19:47');
});

test('a Friday afternoon before candle lighting is open, after it is Shabbat', () => {
  assert.equal(inShabbat(il('2026-10-16', '12:00')), false);
  assert.equal(inShabbat(il('2026-10-16', '17:00')), false);
  assert.equal(inShabbat(il('2026-10-16', '17:30')), true, 'candle lighting is 40 minutes before an 18:06 sunset');
  assert.equal(inShabbat(il('2026-10-16', '21:00')), true);
});

test('all of Saturday until nightfall is Shabbat, and after it is open', () => {
  assert.equal(inShabbat(il('2026-10-17', '09:00')), true);
  assert.equal(inShabbat(il('2026-10-17', '18:30')), true);
  assert.equal(inShabbat(il('2026-10-17', '19:10')), false);
  assert.equal(inShabbat(il('2026-10-18', '12:00')), false);
});

test('the window moves with the season: a winter Friday at 16:30 is already Shabbat', () => {
  assert.equal(inShabbat(il('2026-12-18', '16:30')), true);
  assert.equal(inShabbat(il('2026-06-19', '18:30')), false, 'a summer Friday at 18:30 is not');
});

test('the margins cannot be configured below the minimum', () => {
  const w = shabbatWindow(il('2026-10-14', '10:00'), { candle: 0, havdalah: 0 });
  const set = sunset('2026-10-16').getTime();
  assert.ok(set - w.from.getTime() >= 18 * 60_000);
});

test('a post scheduled on Shabbat fails', () => {
  assert.throws(() => assertNotShabbat(il('2026-10-17', '12:00')), ShabbatError);
  assert.doesNotThrow(() => assertNotShabbat(il('2026-10-15', '12:00')));
});

test('slots inside Shabbat are dropped and named, never scheduled', () => {
  const schedule = { windows: [[12, 14], [19, 22]], slots: ['12:30', '19:30'] };
  const friday = slotsFor('2026-10-16', schedule);
  assert.deepEqual(friday.slots.map((d) => hhmm(d)), ['12:30']);
  assert.equal(friday.dropped[0].why, 'שבת');
  const saturday = slotsFor('2026-10-17', schedule);
  assert.equal(saturday.slots.length, 1, 'Saturday 19:30 is after nightfall');
  assert.equal(hhmm(saturday.slots[0]), '19:30');
  const winterSat = slotsFor('2026-12-19', { ...schedule, slots: ['12:30', '17:00', '19:30'] });
  assert.deepEqual(winterSat.slots.map((d) => hhmm(d)), ['19:30']);
});

test('a slot outside the posting windows is dropped', () => {
  const r = slotsFor('2026-10-14', { windows: [[12, 14]], slots: ['09:00', '12:30'] });
  assert.deepEqual(r.slots.map((d) => hhmm(d)), ['12:30']);
  assert.equal(r.dropped[0].why, 'מחוץ לשעות הפרסום');
});

// ---- the festivals (yom tov), from the evening before

// Israel's yom tov days from October 2026 to October 2028, as published by
// Hebcal (hebcal.com, Israel schedule), fetched 2026-10-13.
const HEBCAL_ISRAEL = [
  ['2027-04-22', 'פסח'], ['2027-04-28', 'שביעי של פסח'], ['2027-06-11', 'שבועות'],
  ['2027-10-02', 'ראש השנה'], ['2027-10-03', 'ראש השנה'], ['2027-10-11', 'יום כיפור'], ['2027-10-16', 'סוכות'], ['2027-10-23', 'שמיני עצרת'],
  ['2028-04-11', 'פסח'], ['2028-04-17', 'שביעי של פסח'], ['2028-05-31', 'שבועות'],
  ['2028-09-21', 'ראש השנה'], ['2028-09-22', 'ראש השנה'], ['2028-09-30', 'יום כיפור'], ['2028-10-05', 'סוכות'], ['2028-10-12', 'שמיני עצרת'],
];

test('the festival dates for the next two years match the published calendar', () => {
  assert.deepEqual(
    yomTovBetween('2026-10-13', '2028-10-31').map((x) => [x.date, x.name]),
    HEBCAL_ISRAEL
  );
  // And the ones already behind us this year, as a check on the arithmetic.
  assert.deepEqual(yomTovBetween('2026-01-01', '2026-10-12').map((x) => x.date), ['2026-04-02', '2026-04-08', '2026-05-22', '2026-09-12', '2026-09-13', '2026-09-21', '2026-09-26', '2026-10-03']);
  assert.equal(yomTovOn('2027-04-23'), null, 'the day after Pesach is chol hamoed, not a festival');
  assert.equal(yomTovOn('2027-10-04'), null, 'no second day of a festival in Israel, except Rosh Hashana');
});

test("every day of the next two years agrees with ICU's own Hebrew calendar", (t) => {
  const fmt = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long' });
  if (!/Tishri/.test(fmt.format(new Date('2026-09-12T12:00:00Z')))) return t.skip('this Node has no full ICU data');
  const MONTHS = { Tishri: 'tishrei', Heshvan: 'cheshvan', Kislev: 'kislev', Tevet: 'tevet', Shevat: 'shevat', 'Adar I': 'adar1', 'Adar II': 'adar2', Adar: 'adar', Nisan: 'nisan', Iyar: 'iyar', Sivan: 'sivan', Tamuz: 'tamuz', Av: 'av', Elul: 'elul' };
  for (let d = '2026-10-13'; d <= '2028-10-31'; d = addDays(d, 1)) {
    const parts = fmt.formatToParts(new Date(`${d}T12:00:00Z`));
    const month = parts.find((p) => p.type === 'month').value;
    const day = Number(parts.find((p) => p.type === 'day').value);
    const ours = hebrewDate(d);
    const want = MONTHS[month] === 'adar' && ours.month === 'adar2' ? 'adar2' : MONTHS[month];
    assert.deepEqual([ours.month, ours.day], [want, day], d);
  }
});

test('a festival is blocked from candle lighting the evening before to nightfall', () => {
  // Erev Yom Kippur 5788 is Sunday 2027-10-10: sunset 18:13 (summer time), candle lighting 17:33.
  assert.equal(inRest(il('2027-10-10', '12:00')), false);
  assert.equal(inRest(il('2027-10-10', '17:25')), false);
  assert.equal(restAt(il('2027-10-10', '17:40')), 'יום כיפור');
  assert.equal(restAt(il('2027-10-11', '12:00')), 'יום כיפור');
  assert.equal(restAt(il('2027-10-11', '18:50')), 'יום כיפור', 'until nightfall, 50 minutes after an 18:12 sunset');
  assert.equal(inRest(il('2027-10-11', '19:10')), false);
  assert.equal(inRest(il('2027-10-12', '12:00')), false);
  // Pesach 5787 is Thursday 2027-04-22; Friday is chol hamoed until Shabbat comes in.
  assert.equal(restAt(il('2027-04-22', '12:00')), 'פסח');
  assert.equal(inRest(il('2027-04-23', '11:00')), false);
  assert.equal(restAt(il('2027-04-24', '11:00')), 'שבת');
  assert.throws(() => assertNotShabbat(il('2027-06-11', '10:00')), /yom tov \(שבועות\)/);
});

test('a festival next to Shabbat is one window: Rosh Hashana 5788 runs Friday night to Sunday night', () => {
  const w = restWindow(il('2027-10-02', '20:00'));
  assert.deepEqual(w.days, ['ראש השנה']);
  assert.equal(inRest(il('2027-10-02', '20:00')), true, 'Saturday night is the second day, not the end of Shabbat');
  assert.equal(restAt(il('2027-10-03', '15:00')), 'ראש השנה');
  assert.equal(inRest(il('2027-10-04', '09:00')), false);
  assert.ok(w.from < new Date(il('2027-10-01', '18:00')), 'from Friday candle lighting');
  // Shavuot 5787 is a Friday: Thursday evening to Saturday night, without a gap.
  const s = restWindow(il('2027-06-11', '20:30'));
  assert.deepEqual(s.days, ['שבועות', 'שבת']);
  assert.ok(s.from < new Date(il('2027-06-10', '20:00')) && s.to > new Date(il('2027-06-12', '20:30')));
});

test('slots on a festival are dropped and named, never scheduled', () => {
  const schedule = { windows: [[7, 9], [19, 22]], slots: ['08:10', '20:30'] };
  const yk = slotsFor('2027-10-11', schedule);
  assert.deepEqual(yk.slots.map((d) => hhmm(d)), ['20:30'], 'after nightfall the fast is over');
  assert.deepEqual(yk.dropped.map((x) => x.why), ['יום כיפור']);
  const erev = slotsFor('2027-10-10', schedule);
  assert.deepEqual(erev.slots.map((d) => hhmm(d)), ['08:10'], 'the evening slot on erev Yom Kippur is dropped');
  assert.equal(erev.dropped[0].why, 'יום כיפור');
});

test('a cut rate of half a post spreads evenly: 1.5 a day is three posts in two days, 0.5 a post every other day', () => {
  const days = Array.from({ length: 10 }, (_, i) => addDays('2026-11-01', i));
  const sum = (p) => days.reduce((s, d) => s + postsOn(d, p), 0);
  assert.equal(sum(1.5), 15);
  assert.equal(sum(0.5), 5);
  assert.ok(days.every((d) => [1, 2].includes(postsOn(d, 1.5)) && [0, 1].includes(postsOn(d, 0.5))));
  assert.equal(postsOn('2026-11-01', 2), 2);
  assert.equal(postsOn('2026-11-01', undefined), null);
});
