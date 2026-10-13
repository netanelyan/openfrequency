import { israelDate, wallClock, addDays } from './israel.js';
import { sunset, JERUSALEM } from './sun.js';

// HARD RULE 9: nothing posts from Friday sunset to Saturday night, Israel time.
//
// The window is computed from the real sunset for that week rather than fixed
// hours, with a margin on both sides:
//
//   from  Friday sunset minus CANDLE_MINUTES (candle lighting; Jerusalem's custom
//         is 40, most of the country lights 20 to 30 minutes before)
//   to    Saturday sunset plus HAVDALAH_MINUTES (nightfall is about 40 minutes
//         after sunset; a few more for anyone who waits longer)
//
// The margins are deliberately on the wide side. An hour of reach at the edges of
// a window the audience is not in costs nothing; posting into Shabbat is the one
// thing this rule exists to prevent. Both are clamped so a configuration cannot
// shrink the window below the halachic minimum.

export const CANDLE_MINUTES = 40;
export const HAVDALAH_MINUTES = 50;
const MIN_CANDLE = 18;
const MIN_HAVDALAH = 40;

/** The Shabbat window that contains or follows the week of `t`, as { from, to } Dates. */
export function shabbatWindow(t, { candle = CANDLE_MINUTES, havdalah = HAVDALAH_MINUTES, place = JERUSALEM } = {}) {
  const c = Math.max(MIN_CANDLE, Number(candle) || CANDLE_MINUTES);
  const h = Math.max(MIN_HAVDALAH, Number(havdalah) || HAVDALAH_MINUTES);
  const date = israelDate(t);
  const day = wallClock(t).day;
  // The Friday of this week (Saturday belongs to the window that began yesterday).
  const friday = addDays(date, day === 6 ? -1 : 5 - day);
  const saturday = addDays(friday, 1);
  return {
    from: new Date(sunset(friday, place).getTime() - c * 60_000),
    to: new Date(sunset(saturday, place).getTime() + h * 60_000),
  };
}

/** Is this instant inside Shabbat (with the margins)? */
export function inShabbat(t, opts = {}) {
  const at = new Date(t).getTime();
  const { from, to } = shabbatWindow(at, opts);
  return at >= from.getTime() && at < to.getTime();
}

export class ShabbatError extends Error {
  constructor(at) {
    super(`refused: ${new Date(at).toISOString()} is inside Shabbat (Israel time)`);
    this.name = 'ShabbatError';
    this.code = 'shabbat';
  }
}

/** Throw if a post would go out on Shabbat. Called by the scheduler and again by every publisher. */
export function assertNotShabbat(t, opts) {
  if (inShabbat(t, opts)) throw new ShabbatError(t);
}
