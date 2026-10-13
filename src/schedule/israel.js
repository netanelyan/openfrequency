// Israel's wall clock, whatever the machine's clock says.
//
// The VPS is not necessarily in Israel and its time zone is not necessarily UTC.
// Reading local hours would make the schedule mean something different on every
// box, so Intl is asked what the wall clock says in Asia/Jerusalem, which also
// gets daylight saving right without this file knowing when it changes.

export const TZ = 'Asia/Jerusalem';

const PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** { y, m, d, H, M, day } on the Israel wall clock. `day` is 0 Sunday ... 6 Saturday. */
export function wallClock(t) {
  const parts = PARTS.formatToParts(new Date(t));
  const get = (k) => parts.find((p) => p.type === k)?.value;
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    // Some ICU builds still emit "24" for midnight.
    H: Number(get('hour')) % 24,
    M: Number(get('minute')),
    day: DAYS.indexOf(get('weekday')),
  };
}

/** The Israel date of an instant, YYYY-MM-DD. */
export function israelDate(t) {
  const w = wallClock(t);
  return `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`;
}

/** Fractional hours on the Israel clock: 19.5 is half past seven. */
export function israelHour(t) {
  const w = wallClock(t);
  return w.H + w.M / 60;
}

/** 0 Sunday ... 6 Saturday, for an Israel date string. */
export const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The instant at which the Israel wall clock reads `hhmm` on `date`. DST-safe. */
export function israelInstant(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [H, M] = String(hhmm).split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, H, M || 0);
  let t = want - 2 * 3_600_000;
  for (let i = 0; i < 4; i++) {
    const w = wallClock(t);
    const diff = want - Date.UTC(w.y, w.m - 1, w.d, w.H, w.M);
    if (!diff) break;
    t += diff;
  }
  return new Date(t);
}

/** The date `n` days after an Israel date string. */
export function addDays(date, n) {
  const t = Date.parse(`${date}T12:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "19:05" on the Israel clock. */
export function hhmm(t) {
  const w = wallClock(t);
  return `${String(w.H).padStart(2, '0')}:${String(w.M).padStart(2, '0')}`;
}
