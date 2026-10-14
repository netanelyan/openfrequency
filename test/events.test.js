import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.js';
import { fightWeekOn, mainEventOf, parseDate, parseEvents, recapsDue, saveEvents } from '../src/schedule/events.js';
import { fightWeekPlans } from '../src/autonomy/runner.js';
import { israelInstant } from '../src/schedule/israel.js';

// The fight week: a public event listing read into a calendar, and the slots of
// the week given their formats: the tale of the tape mid-week, the prediction the
// day before, the recap the morning after, drafted only once the card is over.
// (Fictional cards, in the shape the listing has.)

const LISTING = [
  'Scheduled events',
  'Event | Date | Venue | Location | Ref.',
  'XFC 12: Adler vs. Brandt | Nov 7, 2026 | Example Arena | Example City, Nevada, U.S. | [3]',
  'XFC Fight Night 40 | Nov 28, 2026 | TBA | Example Bay',
  'XFC Fight Night: Cohen vs. Dvir | Oct 31, 2026 | Example Hall | Example Town',
].join('\n');

const AT = '2026-10-01T10:00:00Z';
const pack = {
  id: 'f',
  meta: { events: { source: 'cal' }, schedule: { slots: ['10:30', '20:00'], fightWeek: { tale: 'tape', predict: 'pick', recap: 'recap', taleDaysBefore: 3, predictDaysBefore: 1, recapAfter: '07:30' } } },
};

function calendar() {
  const db = new Db(':memory:');
  db.insert('accounts', { id: 'f', display_name: 'f', handle: 'f', created_at: AT, updated_at: AT });
  saveEvents(db, 'f', parseEvents(LISTING, { prefix: /^XFC\b/ }));
  return db;
}

test('a listing becomes a calendar: dates, the main event, the page, and no headliner when none is announced', () => {
  assert.equal(parseDate('Oct 24, 2026'), '2026-10-24');
  assert.equal(parseDate('September 5, 2026'), '2026-09-05');
  assert.deepEqual(mainEventOf('XFC 12: Adler vs. Brandt'), ['Adler', 'Brandt']);
  const ev = parseEvents(LISTING, { prefix: /^XFC\b/ });
  assert.deepEqual(ev.map((e) => [e.day, e.main, e.page]), [
    ['2026-11-07', 'Adler vs. Brandt', 'XFC 12: Adler vs. Brandt'],
    ['2026-11-28', null, 'XFC Fight Night 40'],
    ['2026-10-31', 'Cohen vs. Dvir', 'XFC Fight Night: Cohen vs. Dvir'],
  ]);
  const db = calendar();
  assert.equal(db.get('SELECT COUNT(*) AS n FROM events').n, 3);
  saveEvents(db, 'f', parseEvents(LISTING, { prefix: /^XFC\b/ }));
  assert.equal(db.get('SELECT COUNT(*) AS n FROM events').n, 3, 'read again, updated in place');
});

test('the fight week: the tale three days before, the pick the day before, the recap the day after; a card with no headliner has none', () => {
  const db = calendar();
  const roles = (day) => fightWeekOn(db, pack, day).map((w) => `${w.role}:${w.formatKey}:${w.subject.terms.join('+')}`);
  assert.deepEqual(roles('2026-10-28'), ['tale:tape:Cohen+Dvir']);
  assert.deepEqual(roles('2026-10-30'), ['predict:pick:Cohen+Dvir']);
  assert.deepEqual(roles('2026-11-01'), ['recap:recap:Cohen+Dvir']);
  assert.deepEqual(roles('2026-10-29'), []);
  assert.deepEqual(roles('2026-11-25'), [], 'Fight Night 40 has no main event yet');
});

test("a fight week's slots: the tale takes the day's first slot, the recap's slot is held back from the day-ahead drafts", () => {
  const db = calendar();
  const slots = (day) => pack.meta.schedule.slots.map((h) => israelInstant(day, h).toISOString());
  const tale = fightWeekPlans(db, pack, slots('2026-10-28'));
  assert.equal(tale[0].formatKey, 'tape');
  assert.equal(tale[0].subject.event, 'XFC Fight Night: Cohen vs. Dvir');
  assert.equal(tale[1].formatKey, undefined, 'the other slot is an ordinary post');
  const after = fightWeekPlans(db, pack, slots('2026-11-01'));
  assert.equal(after.length, 1, 'the recap slot is not drafted the day before');
  assert.equal(after[0].slotAt, slots('2026-11-01')[1]);
  // The morning after: not before the card is over, then due.
  assert.equal(recapsDue(db, pack, Date.parse('2026-11-01T04:00:00Z')).length, 0);
  assert.equal(recapsDue(db, pack, Date.parse('2026-11-01T06:00:00Z')).length, 1);
  // A pack with no fight week gets its slots as they are.
  assert.deepEqual(fightWeekPlans(db, { id: 'x', meta: { schedule: {} } }, ['a', 'b']), [{ slotAt: 'a' }, { slotAt: 'b' }]);
});
