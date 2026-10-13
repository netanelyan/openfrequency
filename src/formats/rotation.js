import { DAY, now } from '../core/clock.js';
import { j } from '../db/index.js';

// Which format the next post gets, and what the account's own numbers say about
// each one.
//
//   - a post is scored 72 hours after it went out, per platform, against that
//     platform's own median: TikTok by (shares + likes) / views, Instagram by
//     saves / views. TikTok reports no saves, and none is ever made up.
//   - 70% of posts use proven formats, weighted by configured weight times
//     results; 30% are trials, which take turns.
//   - a format whose last 3 results all sit under 70% of the median drops out,
//     with the reason kept. "Under the median" would retire an average format
//     inside a month: an average format is under it half the time.
//   - a trial with 3 results averaging at or above the median becomes proven.
//   - at least 2 proven formats always stay, so there is always something to build.
//   - a dropped format of the pack's own rests 14 days and returns as a trial.

export const RULES = { provenShare: 0.7, dropAfter: 3, lossBelow: 0.7, minPosts: 3, keepProven: 2, restDays: 14, windowDays: 30 };

/**
 * One post's score on one platform, or null when there is nothing to divide by.
 * Instagram divides by views where Meta reports them, else by reach.
 */
export function postScore(platform, m) {
  const views = Number(m?.views) || (platform === 'instagram' ? Number(m?.reach) || 0 : 0);
  if (views <= 0) return null;
  if (platform === 'tiktok') return ((Number(m.shares) || 0) + (Number(m.likes) || 0)) / views;
  if (platform === 'instagram') return m.saves == null ? null : (Number(m.saves) || 0) / views;
  return null;
}

/** One row per format in formats.json; a format removed from the file stays in history. */
export function ensureFormats(db, pack) {
  for (const f of pack.formats.formats || []) {
    const have = db.get('SELECT id FROM formats WHERE account_id = ? AND format_key = ?', pack.id, f.id);
    if (!have) {
      db.insert('formats', { account_id: pack.id, format_key: f.id, kind: f.trial ? 'trial' : 'proven', status: 'active', weight: Number(f.weight) || 1, own: 1, results_json: [] });
    } else {
      db.run('UPDATE formats SET weight = ? WHERE id = ?', Number(f.weight) || 1, have.id);
    }
  }
}

const rowsOf = (db, accountId) => db.all('SELECT * FROM formats WHERE account_id = ?', accountId).map((r) => ({ ...r, results: j(r.results_json, []) }));

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Each format's results inside the window, as score over its platform's median (1 = typical). */
export function relative(rows, { t = now(), windowDays = RULES.windowDays } = {}) {
  const since = t - windowDays * DAY;
  const all = rows.flatMap((f) => f.results.filter((r) => Date.parse(r.at) >= since));
  const med = {};
  for (const p of ['tiktok', 'instagram']) med[p] = median(all.filter((r) => r.platform === p).map((r) => r.score));
  const out = {};
  for (const f of rows) out[f.format_key] = f.results.filter((r) => Date.parse(r.at) >= since && med[r.platform]).map((r) => ({ ...r, rel: r.score / med[r.platform] }));
  return out;
}

/**
 * Credit metrics at least 72 hours old to their post's format, once per post and
 * platform. Uses the newest reading taken at or after 72 hours.
 */
export function credit(db, accountId, { t = now(), minAgeHours = 72 } = {}) {
  const rows = rowsOf(db, accountId);
  const byKey = new Map(rows.map((r) => [r.format_key, r]));
  let n = 0;
  const posts = db.all("SELECT id, format_id, published_at FROM posts WHERE account_id = ? AND status = 'published' AND published_at IS NOT NULL", accountId);
  for (const p of posts) {
    if (t - Date.parse(p.published_at) < minAgeHours * 3_600_000) continue;
    const f = byKey.get(p.format_id);
    if (!f) continue;
    for (const platform of ['tiktok', 'instagram']) {
      if (f.results.some((r) => r.post === p.id && r.platform === platform)) continue;
      const m = db.get('SELECT * FROM metrics WHERE post_id = ? AND platform = ? AND age_hours >= ? ORDER BY collected_at DESC LIMIT 1', p.id, platform, minAgeHours);
      const score = postScore(platform, m);
      if (score == null) continue;
      f.results.push({ post: p.id, platform, score, at: new Date(t).toISOString() });
      n++;
    }
  }
  for (const f of rows) db.run('UPDATE formats SET results_json = ? WHERE id = ?', JSON.stringify(f.results), f.id);
  return n;
}

/** Drop, promote and bring back. Returns [{ format, change, why }]. */
export function judge(db, accountId, { t = now(), ...opts } = {}) {
  const R = { ...RULES, ...opts };
  const rows = rowsOf(db, accountId);
  const changes = [];
  const iso = new Date(t).toISOString();
  for (const f of rows) {
    if (f.own && f.status === 'dropped' && t - Date.parse(f.dropped_at || 0) >= R.restDays * DAY) {
      Object.assign(f, { status: 'active', kind: 'trial', results: [], returned_at: iso });
      changes.push({ format: f.format_key, change: 'returned', why: `חזר לניסיון אחרי ${R.restDays} ימי מנוחה` });
    }
  }
  const rel = relative(rows, { t, windowDays: R.windowDays });
  for (const f of rows) {
    if (f.status !== 'active') continue;
    const mine = (rel[f.format_key] || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const lastN = mine.slice(-R.dropAfter);
    if (lastN.length === R.dropAfter && lastN.every((r) => r.rel < R.lossBelow)) {
      const activeProven = rows.filter((x) => x.status === 'active' && x.kind === 'proven');
      if (f.kind === 'proven' && activeProven.length <= R.keepProven) continue;
      f.status = 'dropped';
      f.dropped_at = iso;
      f.dropped_why = `${R.dropAfter} פעמים ברצף מתחת ל-${Math.round(R.lossBelow * 100)}% מהחציון (${lastN.map((r) => r.rel.toFixed(2)).join(', ')})`;
      changes.push({ format: f.format_key, change: 'dropped', why: f.dropped_why });
      continue;
    }
    if (f.kind === 'trial' && mine.length >= R.minPosts) {
      const avg = mine.reduce((s, r) => s + r.rel, 0) / mine.length;
      if (avg >= 1) {
        f.kind = 'proven';
        f.promoted_at = iso;
        changes.push({ format: f.format_key, change: 'promoted', why: `ממוצע ${avg.toFixed(2)} מהחציון אחרי ${mine.length} פוסטים` });
      }
    }
  }
  for (const f of rows) {
    db.update('formats', f.id, {
      status: f.status,
      kind: f.kind,
      results_json: JSON.stringify(f.results),
      dropped_at: f.dropped_at || null,
      dropped_why: f.dropped_why || null,
      promoted_at: f.promoted_at || null,
      returned_at: f.returned_at || null,
    });
  }
  return changes;
}

/**
 * The next post's format key. `recent` is the account's last picks, newest last,
 * as [{ kind, format }]. Trials when they are under their 30% share; otherwise a
 * proven format weighted by weight x relative score (clamped 0.5 to 2). The
 * format of the previous post is avoided when anything else is available.
 */
export function pickFormat(db, accountId, { recent = null, rand = Math.random, exclude = [], t = now() } = {}) {
  const rows = rowsOf(db, accountId).filter((f) => f.status === 'active' && !exclude.includes(f.format_key));
  if (!rows.length) return null;
  const picks =
    recent ||
    db
      .all("SELECT p.format_id AS format, f.kind FROM posts p LEFT JOIN formats f ON f.account_id = p.account_id AND f.format_key = p.format_id WHERE p.account_id = ? AND p.status NOT IN ('blocked','sample') ORDER BY p.created_at DESC LIMIT 20", accountId)
      .reverse();
  const last = picks[picks.length - 1]?.format;
  const avoid = (list) => {
    const kept = list.filter((f) => f.format_key !== last);
    return kept.length ? kept : list;
  };
  const trials = rows.filter((f) => f.kind === 'trial');
  const trialShare = picks.length ? picks.filter((p) => p.kind === 'trial').length / picks.length : 0;
  if (trials.length && trialShare < 1 - RULES.provenShare) {
    const offered = (f) => picks.filter((p) => p.format === f.format_key).length;
    return avoid(trials).sort((a, b) => offered(a) - offered(b) || a.results.length - b.results.length)[0].format_key;
  }
  const rel = relative(rowsOf(db, accountId), { t });
  const proven = avoid(rows.filter((f) => f.kind === 'proven'));
  const pool = proven.length ? proven : avoid(rows);
  const w = (f) => {
    const r = rel[f.format_key] || [];
    const perf = r.length ? Math.min(2, Math.max(0.5, r.reduce((s, x) => s + x.rel, 0) / r.length)) : 1;
    return (f.weight || 1) * perf;
  };
  const total = pool.reduce((s, f) => s + w(f), 0);
  let x = rand() * total;
  for (const f of pool) {
    x -= w(f);
    if (x <= 0) return f.format_key;
  }
  return pool[pool.length - 1].format_key;
}
