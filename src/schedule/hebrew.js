// The Hebrew calendar, for the festival days on which nothing posts.
//
// Pure arithmetic: the molad of Tishrei, the four dechiyot, and the month
// lengths that follow from the year's length. The Hebrew calendar has been a
// fixed algorithm since Hillel II, so these dates are computed, the same way
// every printed calendar computes them, not looked up. Ported from the
// calendar of an earlier project of the owner (a TypeScript module), which is validated there
// against ICU's own Hebrew calendar for every month from 1900 to 2100.
//
// Intl's Hebrew calendar is not used at run time: whether it works depends on
// the ICU data the Node build shipped with, and a holiday that silently moves
// with a Node build is not acceptable. The tests use it as an independent check.
//
// Only Israel's yom tov days are listed: one day each, two for Rosh Hashana.
// The second days kept abroad are not festival days here.

export const isLeap = (year) => (7 * year + 1) % 19 < 7;

/** Days from the calendar's epoch to 1 Tishrei of `year` (molad plus dechiyot). */
function elapsedDays(year) {
  const months = 235 * Math.floor((year - 1) / 19) + 12 * ((year - 1) % 19) + Math.floor((7 * ((year - 1) % 19) + 1) / 19);
  const parts = 204 + 793 * (months % 1080);
  const hours = 5 + 12 * months + 793 * Math.floor(months / 1080) + Math.floor(parts / 1080);
  const day = 1 + 29 * months + Math.floor(hours / 24);
  const p = 1080 * (hours % 24) + (parts % 1080);
  let alt = day;
  if (p >= 19440) alt = day + 1; // molad zaken
  else if (day % 7 === 2 && p >= 9924 && !isLeap(year)) alt = day + 1; // GaTaRaD
  else if (day % 7 === 1 && p >= 16789 && isLeap(year - 1)) alt = day + 1; // BeTUTaKPaT
  // lo ADU rosh: Rosh Hashana never falls on Sunday, Wednesday or Friday.
  return alt % 7 === 0 || alt % 7 === 3 || alt % 7 === 5 ? alt + 1 : alt;
}

// Calibrated on 1 Tishrei 5786 = 2025-09-23 (validated where it was ported from, and here by the tests).
const EPOCH_OFFSET = -2_092_591;
const dayNumber = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
const isoOf = (n) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const roshHashana = (year) => elapsedDays(year) + EPOCH_OFFSET;
const yearLength = (year) => roshHashana(year + 1) - roshHashana(year);

/** Month names and lengths from Tishrei. Cheshvan and Kislev flex with the year's length. */
function months(year) {
  const len = yearLength(year);
  return [
    ['tishrei', 30],
    ['cheshvan', len % 10 === 5 ? 30 : 29],
    ['kislev', len % 10 === 3 ? 29 : 30],
    ['tevet', 29],
    ['shevat', 30],
    ...(isLeap(year) ? [['adar1', 30], ['adar2', 29]] : [['adar', 29]]),
    ['nisan', 30],
    ['iyar', 29],
    ['sivan', 30],
    ['tamuz', 29],
    ['av', 30],
    ['elul', 29],
  ];
}

function hebrewDayNumber(year, month, day) {
  let n = roshHashana(year);
  for (const [name, days] of months(year)) {
    if (name === month) return n + day - 1;
    n += days;
  }
  return null;
}

/** The Hebrew year a Gregorian date falls in. */
export function hebrewYearOf(iso) {
  const dn = dayNumber(iso);
  let y = Number(iso.slice(0, 4)) + 3761;
  while (roshHashana(y) > dn) y--;
  while (roshHashana(y + 1) <= dn) y++;
  return y;
}

/** { year, month, day } for a Gregorian date. */
export function hebrewDate(iso) {
  const year = hebrewYearOf(iso);
  const dn = dayNumber(iso);
  let n = roshHashana(year);
  for (const [month, days] of months(year)) {
    if (dn < n + days) return { year, month, day: dn - n + 1 };
    n += days;
  }
  return null;
}

/** Israel's yom tov days: work stops as on Shabbat. */
export const YOM_TOV = [
  { month: 'tishrei', day: 1, name: 'ראש השנה' },
  { month: 'tishrei', day: 2, name: 'ראש השנה' },
  { month: 'tishrei', day: 10, name: 'יום כיפור' },
  { month: 'tishrei', day: 15, name: 'סוכות' },
  { month: 'tishrei', day: 22, name: 'שמיני עצרת' },
  { month: 'nisan', day: 15, name: 'פסח' },
  { month: 'nisan', day: 21, name: 'שביעי של פסח' },
  { month: 'sivan', day: 6, name: 'שבועות' },
];

/** The yom tov on an Israel date (YYYY-MM-DD), or null. */
export function yomTovOn(iso) {
  const h = hebrewDate(iso);
  if (!h) return null;
  return YOM_TOV.find((x) => x.month === h.month && x.day === h.day)?.name || null;
}

/** Every yom tov between two dates, inclusive: [{ date, name }]. */
export function yomTovBetween(fromIso, toIso) {
  const from = dayNumber(fromIso);
  const to = dayNumber(toIso);
  const out = [];
  for (let y = hebrewYearOf(fromIso); y <= hebrewYearOf(toIso); y++) {
    for (const x of YOM_TOV) {
      const dn = hebrewDayNumber(y, x.month, x.day);
      if (dn != null && dn >= from && dn <= to) out.push({ date: isoOf(dn), name: x.name });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
