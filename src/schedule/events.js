import { nowIso } from '../core/clock.js';
import { addDays, israelDate, israelInstant } from './israel.js';

// Events an account follows, a fight card above all, and the rhythm of a fight
// week built on them:
//
//   mid-week     a tale of the tape (a head-to-head of the main event)
//   the day before   a prediction (the account's pick, labelled as opinion)
//   the morning after   the results, drafted only once they exist
//
// The calendar is a public listing read like any other approved source (for the
// UFC, Wikipedia's "List of UFC events", its "Scheduled events" table, one row a
// line: "UFC 333: Volkanovski vs. Evloev | Oct 24, 2026 | Etihad Arena | Abu
// Dhabi, United Arab Emirates"). The rows become the `events` table; the
// scheduler gives the fight week's slots their formats and their subject, and a
// post on the event is drafted only from documents that name both fighters.
//
// A pack turns this on in pack.json:
//   "events": { "source": "<source id>", "pageSource": "<wikipedia source id>" }
//   "schedule": { "fightWeek": { "tale": "<format>", "predict": "<format>", "recap": "<format>",
//                                "taleDaysBefore": 3, "predictDaysBefore": 1, "recapAfter": "07:30" } }

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})$/i;

/** "Oct 24, 2026" -> "2026-10-24", or null. */
export function parseDate(s) {
  const m = DATE.exec(String(s || '').trim());
  if (!m) return null;
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

/** The two sides of a main event from an event's name: "UFC 333: Volkanovski vs. Evloev" -> ["Volkanovski", "Evloev"]. */
export function mainEventOf(name) {
  const m = /:\s*(.+?)\s+vs\.?\s+(.+?)(?:\s+\d+)?$/i.exec(String(name || ''));
  return m ? [m[1].trim(), m[2].trim()] : null;
}

/**
 * A listing's rows as events: a row ("name | date | venue | location") whose
 * first cell names an event and whose second is a date. The event's page title
 * on Wikipedia: "UFC 333" for a numbered event, the full name otherwise.
 */
export function parseEvents(text, { prefix = /^(UFC|PFL|ONE)\b/ } = {}) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const cells = line.split('|').map((c) => c.replace(/\[\d+\]/g, '').trim());
    const i = cells.findIndex((c) => prefix.test(c));
    if (i < 0) continue;
    const day = parseDate(cells[i + 1]);
    if (!day) continue;
    const name = cells[i];
    const main = mainEventOf(name);
    const numbered = /^UFC (\d+)\b/.exec(name);
    out.push({ key: name, name, day, venue: cells[i + 2] || null, location: cells[i + 3] || null, main: main ? `${main[0]} vs. ${main[1]}` : null, page: numbered ? `UFC ${numbered[1]}` : name });
  }
  return out;
}

/** Store the events of a listing for an account. Returns how many. */
export function saveEvents(db, accountId, events, { sourceId = null, url = null } = {}) {
  const at = nowIso();
  for (const e of events) {
    const have = db.get('SELECT id FROM events WHERE account_id = ? AND key = ?', accountId, e.key);
    const row = { name: e.name, day: e.day, main_event: e.main, venue: [e.venue, e.location].filter(Boolean).join(', ') || null, url: e.page ? `https://en.wikipedia.org/wiki/${encodeURIComponent(e.page.replace(/ /g, '_'))}` : url, source_id: sourceId, updated_at: at };
    if (have) db.update('events', have.id, row);
    else db.insert('events', { account_id: accountId, key: e.key, ...row });
  }
  return events.length;
}

/** Events from today on, soonest first. */
export const upcoming = (db, accountId, day, days = 21) => db.all('SELECT * FROM events WHERE account_id = ? AND day >= ? AND day <= ? ORDER BY day', accountId, addDays(day, -2), addDays(day, days));

const surnames = (main) => (main || '').split(/\s+vs\.?\s+/i).map((s) => s.trim().split(/\s+/).pop()).filter(Boolean);

/**
 * What a fight week asks of one Israel date: [{ role, formatKey, event, subject }].
 * The event's date is its local date (a Saturday card in the US ends on Sunday
 * morning in Israel, so its recap is the day after).
 */
export function fightWeekOn(db, pack, day) {
  const fw = pack.meta.schedule?.fightWeek;
  if (!fw) return [];
  const out = [];
  for (const e of upcoming(db, pack.id, day)) {
    if (!e.main_event) continue; // no headliner announced yet: nothing to tell
    const subject = { text: `${e.name} (${e.day})`, terms: surnames(e.main_event), event: e.key };
    const at = (n) => addDays(e.day, n);
    if (fw.tale && day === at(-(fw.taleDaysBefore ?? 3))) out.push({ role: 'tale', formatKey: fw.tale, event: e, subject });
    if (fw.predict && day === at(-(fw.predictDaysBefore ?? 1))) out.push({ role: 'predict', formatKey: fw.predict, event: e, subject });
    if (fw.recap && day === at(1)) out.push({ role: 'recap', formatKey: fw.recap, event: e, subject, notBefore: israelInstant(day, fw.recapAfter || '07:30').getTime() });
  }
  return out;
}

/**
 * The fight week laid over a day's slots: the first free slot of the day takes
 * the tale or the prediction; the recap takes the first slot after the card has
 * ended (recapAfter), and is drafted only then, never the day before.
 * slots: ISO strings of the day's slots. Returns { assign: Map(slot -> plan), reserved: Set(slot) }.
 */
export function fightWeekSlots(db, pack, day, slots) {
  const assign = new Map();
  const reserved = new Set();
  const free = slots.filter((s) => israelDate(Date.parse(s)) === day).sort();
  for (const w of fightWeekOn(db, pack, day)) {
    const slot = w.role === 'recap' ? free.find((s) => Date.parse(s) >= w.notBefore + 0.5 * 3_600_000 && !assign.has(s)) : free.find((s) => !assign.has(s));
    if (!slot) continue;
    assign.set(slot, w);
    if (w.role === 'recap') reserved.add(slot);
  }
  return { assign, reserved };
}

/** A recap is due now: its card is over and its slot has no post yet. */
export function recapsDue(db, pack, t) {
  const day = israelDate(t);
  const out = [];
  for (const w of fightWeekOn(db, pack, day).filter((x) => x.role === 'recap')) {
    if (t < w.notBefore) continue;
    out.push(w);
  }
  return out;
}

