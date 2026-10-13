import { israelInstant, israelHour, weekday } from './israel.js';
import { restAt } from './shabbat.js';

// The day's posting slots for one account.
//
// Slots are Israel wall-clock times from the pack (`schedule.slots`, with
// `schedule.slotsByDay` overriding a weekday, 0 Sunday ... 6 Saturday, so Friday
// can post early and Saturday after nightfall). A slot inside Shabbat, a yom tov or outside
// the pack's posting windows is dropped AND named, because a configured slot that
// can never post is a mistake in the file and the website should say so rather
// than quietly posting less.

export function inWindows(t, windows = []) {
  if (!windows.length) return true;
  const h = israelHour(t);
  return windows.some(([a, b]) => h >= a && h < b);
}

/** { slots: Date[], dropped: [{ at, why }] } for one account on one Israel date. */
export function slotsFor(date, schedule = {}, { notBefore = null } = {}) {
  const day = schedule.slotsByDay?.[String(weekday(date))] || schedule.slots || [];
  const dropped = [];
  const slots = [];
  for (const hhmm of day) {
    const at = israelInstant(date, hhmm);
    const rest = restAt(at);
    if (rest) dropped.push({ at: hhmm, why: rest });
    else if (!inWindows(at, schedule.windows)) dropped.push({ at: hhmm, why: 'מחוץ לשעות הפרסום' });
    else if (notBefore != null && at.getTime() < notBefore) dropped.push({ at: hhmm, why: 'השעה עברה' });
    else slots.push(at);
  }
  const cap = Number(schedule.postsPerDay) || slots.length;
  return { slots: slots.slice(0, cap), dropped };
}
