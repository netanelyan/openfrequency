import { DAY, HOUR, now, nowIso } from '../core/clock.js';
import { j } from '../db/index.js';
import { zernioAnalytics, zernioConfigured } from '../publish/zernio.js';
import { credit, judge } from '../formats/rotation.js';
import { audit } from '../core/store.js';

// What a published post did, read from the platforms through Zernio's
// analytics, and what that teaches the format rotation.
//
// RECORDS NOTHING IT DID NOT GET. A post whose numbers are not synced yet is
// left alone rather than written as zeros: a stored zero is indistinguishable
// from a post nobody saw, and the score divides by views. TikTok reports no
// saves, so TikTok's saves column stays null, never filled with something
// adjacent.
//
// Read once a day per post until 30 days, so the 72-hour reading exists and
// later ones replace nothing: each reading is its own row with its age.

export async function collectMetrics(ctx, { t = now(), source = null } = {}) {
  const { db } = ctx;
  const read = source || (zernioConfigured() ? zernioAnalytics : null);
  const out = { asked: 0, got: 0, why: read ? null : 'no Zernio key: metrics are read only from real published posts' };
  if (!read) return out;
  const posts = db.all("SELECT id, account_id, published_at, publish_json FROM posts WHERE status = 'published' AND published_at IS NOT NULL AND published_at >= ?", new Date(t - 30 * DAY).toISOString());
  for (const p of posts) {
    const pub = j(p.publish_json, {});
    const zid = Object.values(pub).find((r) => r?.zernioId)?.zernioId;
    if (!zid) continue; // a dry-published post has no numbers to read
    const last = db.get('SELECT MAX(collected_at) AS at, MAX(age_hours) AS age FROM metrics WHERE post_id = ?', p.id);
    const age = (t - Date.parse(p.published_at)) / HOUR;
    // Once a day, and always once the post crosses 72 hours, which is the reading that counts.
    const due72 = age >= 72 && !(last?.age >= 72);
    if (last?.at && t - Date.parse(last.at) < 20 * HOUR && !due72) continue;
    out.asked++;
    let stats;
    try {
      stats = await read(zid);
    } catch (e) {
      ctx.log?.(`metrics ${p.id}: ${e.message}`);
      continue;
    }
    if (!stats) continue;
    for (const [platform, s] of Object.entries(stats)) {
      if (s.views == null) continue;
      db.insert('metrics', { post_id: p.id, platform, collected_at: new Date(t).toISOString(), age_hours: age, views: s.views, likes: s.likes, comments: s.comments, shares: s.shares, saves: platform === 'tiktok' ? null : s.saves, raw_json: s });
      out.got++;
    }
  }
  return out;
}

/** Credit 72-hour scores to formats and judge them, per account. Returns the changes. */
export function learn(ctx, { t = now() } = {}) {
  const changes = [];
  for (const pack of ctx.packs) {
    credit(ctx.db, pack.id, { t });
    for (const c of judge(ctx.db, pack.id, { t })) {
      changes.push({ account: pack.id, ...c });
      audit(ctx.db, { action: `format_${c.change}`, accountId: pack.id, detail: c });
    }
  }
  return changes;
}

export const lastCollected = (db) => db.get('SELECT MAX(collected_at) AS at FROM metrics')?.at || null;
export { nowIso };
