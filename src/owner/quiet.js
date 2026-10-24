import { now, nowIso } from '../core/clock.js';
import { addDays, hhmm, israelDate, israelInstant } from '../schedule/israel.js';
import { restAt, restWindow } from '../schedule/shabbat.js';

// When Teder's news may reach a workspace's owner on WhatsApp (the owner line, docs/internal-assistant.md). Toran
// asks before it writes (GET /internal/assistant/status, `quiet`); Teder only says. Two settings per workspace, on
// the settings page:
//
//   quiet hours   no message from start to end on the Israel clock (default 22:00 to 08:00; the same time twice is
//                 none at all)
//   shabbat       no message over Shabbat and the festivals, by Teder's own calendar (restAt, the same window nothing
//                 is published in). On by default
//
// No row in owner_line is the default.

export const DEFAULT_LINE = { quietHours: { start: '22:00', end: '08:00' }, shabbat: true };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A workspace's settings for the owner line: { quietHours: { start, end }, shabbat }. */
export function lineSettings(db, workspaceId) {
  const row = db.get('SELECT * FROM owner_line WHERE workspace_id = ?', workspaceId);
  if (!row) return { quietHours: { ...DEFAULT_LINE.quietHours }, shabbat: DEFAULT_LINE.shabbat };
  return { quietHours: { start: row.quiet_start, end: row.quiet_end }, shabbat: Boolean(row.shabbat) };
}

/** Save them. Returns { problems } when a time is not HH:MM, else the settings as saved. */
export function saveLineSettings(db, workspaceId, { start, end, shabbat }, by = null) {
  const problems = [start, end].filter((x) => !HHMM.test(String(x || ''))).map((x) => `not a time: ${x}`);
  if (problems.length) return { problems };
  db.run(
    'INSERT INTO owner_line (workspace_id, quiet_start, quiet_end, shabbat, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, shabbat = excluded.shabbat, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    workspaceId, start, end, shabbat ? 1 : 0, nowIso(), by
  );
  return lineSettings(db, workspaceId);
}

/** Is this instant inside the quiet hours? */
export function inQuietHours({ start, end }, t) {
  if (start === end) return false;
  const h = hhmm(t);
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** Why no message may go out at `t`: 'shabbat', 'quiet_hours' or null. Shabbat speaks first. */
export function quietReason(line, t) {
  if (line.shabbat && restAt(t)) return 'shabbat';
  if (inQuietHours(line.quietHours, t)) return 'quiet_hours';
  return null;
}

/** The next time the quiet hours end, after `t`. */
function quietHoursEnd({ end }, t) {
  const today = israelInstant(israelDate(t), end).getTime();
  return today > t ? today : israelInstant(addDays(israelDate(t), 1), end).getTime();
}

/**
 * `quiet` for the status: { now, until, reason }. `until` is the first instant nothing holds a message back, so quiet
 * hours that run into Shabbat (or out of it) are one quiet time.
 */
export function quietAt(line, t = now()) {
  const reason = quietReason(line, t);
  if (!reason) return { now: false, until: null, reason: null };
  let at = t;
  for (let i = 0; i < 20; i++) {
    const r = quietReason(line, at);
    if (!r) break;
    at = r === 'shabbat' ? restWindow(at).to.getTime() : quietHoursEnd(line.quietHours, at);
  }
  return { now: true, until: new Date(at).toISOString(), reason };
}
