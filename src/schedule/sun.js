// Sunset, computed, for a date and a place.
//
// The Almanac for Computers (US Naval Observatory, 1990) algorithm, the one most
// zmanim calculators start from: accurate to about a minute at Israel's latitude,
// which is far inside the margins the Shabbat rule adds on both sides. No table,
// no dependency, nothing to keep up to date.

const RAD = Math.PI / 180;
const sin = (d) => Math.sin(d * RAD);
const cos = (d) => Math.cos(d * RAD);
const tan = (d) => Math.tan(d * RAD);
const norm = (x, m) => ((x % m) + m) % m;

/** Jerusalem, the reference most Israeli calendars print. */
export const JERUSALEM = { lat: 31.778, lon: 35.235 };

/**
 * Sunset on a calendar date (YYYY-MM-DD, the local date at that place), as a Date.
 * `zenith` 90.833 is the official sunset: the sun's upper limb on the horizon,
 * with refraction.
 */
export function sunset(date, { lat, lon } = JERUSALEM, zenith = 90.833) {
  const [y, m, d] = date.split('-').map(Number);
  const N = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  const lngHour = lon / 15;
  const t = N + (18 - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  const L = norm(M + 1.916 * sin(M) + 0.02 * sin(2 * M) + 282.634, 360);
  let RA = norm(Math.atan(0.91764 * tan(L)) / RAD, 360);
  RA = (RA + (Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90)) / 15;
  const sinDec = 0.39782 * sin(L);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (cos(zenith) - sinDec * sin(lat)) / (cosDec * cos(lat));
  if (cosH < -1 || cosH > 1) return null; // no sunset that day (not at Israel's latitude)
  const H = Math.acos(cosH) / RAD / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const UT = norm(T - lngHour, 24);
  // UT is an hour of the UTC day that holds the local evening, which for a place
  // east of Greenwich is the same calendar date.
  return new Date(Date.UTC(y, m - 1, d) + UT * 3_600_000);
}
