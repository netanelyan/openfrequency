import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inShabbat, assertNotShabbat, shabbatWindow, ShabbatError } from '../src/schedule/shabbat.js';
import { sunset } from '../src/schedule/sun.js';
import { hhmm, israelInstant } from '../src/schedule/israel.js';
import { slotsFor } from '../src/schedule/slots.js';

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
