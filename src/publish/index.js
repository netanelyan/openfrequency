import { copyFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { now, nowIso } from '../core/clock.js';
import { dataDir, ensureDir, outDir } from '../core/paths.js';
import { audit, settings, step } from '../core/store.js';
import { inShabbat } from '../schedule/shabbat.js';
import { israelDate } from '../schedule/israel.js';
import { gate, verifyFact } from '../verify/claims.js';
import { loadPost } from '../pipeline/build.js';
import { exportPost } from '../pipeline/export.js';
import { canRun, pauseAccount, publishErrorStreak } from '../autonomy/rails.js';
import { isStrike, postBody, publishZernio, zernioConfigured } from './zernio.js';

// Publishing one approved post, through the rails, to each of its pack's
// platforms.
//
// THE DRY PUBLISHER IS THE DEFAULT. A post leaves through Zernio only when all
// three say so: PUBLISH_MODE=live in the environment, a Zernio key, and the
// pack's own "publisher": "zernio". Anything less writes the post to disk
// (data/out/published/...) with the exact request Zernio would have received.
//
// Before anything goes anywhere, every time:
//   - not on Shabbat (HARD RULE 9: the scheduler never plans a Shabbat slot, and
//     this refuses one anyway)
//   - no kill switch, the account not paused
//   - the post approved
//   - every fact verified again against its stored document, with its source
//     still approved, and the text still hashing to the token the gate issued.
//     A failure here is a failed fact check: the post is blocked and the account
//     paused.

export function publisherFor(pack, env = process.env) {
  return env.PUBLISH_MODE === 'live' && zernioConfigured() && pack.meta.publisher === 'zernio' ? 'zernio' : 'dry';
}

export class PublishRefused extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PublishRefused';
    this.code = code;
  }
}

/** Re-run the fact gate on a stored post. Returns the problems, empty when it still holds. */
export function recheck(db, post, pack) {
  const problems = [];
  const facts = post.facts.map((f) => {
    const v = verifyFact(db, f, { accountId: pack.id, maxQuoteWords: pack.rules.maxQuoteWords || 40 });
    if (!v.ok && post.slides.some((s) => s.factKeys.includes(f.key))) problems.push(`${f.key}: ${v.error}`);
    return { ...f, verified: v.ok };
  });
  const g = gate({ slides: post.slides, facts, caption: post.caption, hook: post.hook, sub: post.sub || '' });
  problems.push(...g.problems);
  if (post.checks?.token && g.token !== post.checks.token) problems.push('the text changed after it was checked');
  return problems;
}

/** Copy a post's slides to the public media folder Caddy serves; returns their URLs. */
function publicUrls(post, platform) {
  const base = String(process.env.MEDIA_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new PublishRefused('MEDIA_PUBLIC_BASE_URL is not an https address: Zernio fetches slides by URL', 'no_media_url');
  const token = `${post.id}-${randomBytes(6).toString('hex')}`;
  const dir = ensureDir(path.join(dataDir(), 'public', token));
  return (post.media[platform] || []).map((f) => {
    copyFileSync(f, path.join(dir, path.basename(f)));
    return `${base}/${token}/${path.basename(f)}`;
  });
}

export async function publishPost(ctx, postId, { t = now() } = {}) {
  const { db } = ctx;
  const post = loadPost(db, postId);
  if (!post) throw new PublishRefused(`no post ${postId}`, 'missing');
  const pack = ctx.pack(post.account_id);
  if (!pack) throw new PublishRefused(`no pack for ${post.account_id}`, 'no_pack');

  if (inShabbat(t)) throw new PublishRefused('שבת: לא מפרסמים עכשיו', 'shabbat');
  const run = canRun(db, pack.id);
  if (!run.ok) throw new PublishRefused(run.why, 'paused');
  if (post.status !== 'approved') throw new PublishRefused(`the post is ${post.status}, not approved`, 'not_approved');

  const problems = recheck(db, post, pack);
  if (problems.length) {
    db.update('posts', postId, { status: 'blocked', reason: `בדיקת העובדות נכשלה לפני פרסום: ${problems[0]}`, updated_at: nowIso() });
    step(db, postId, 'publish', 'failed', { kind: 'fact_check', problems });
    pauseAccount(db, pack.id, 'fact_check', problems[0]);
    throw new PublishRefused(`fact check failed before publishing: ${problems[0]}`, 'fact_check');
  }

  db.update('posts', postId, { status: 'publishing', updated_at: nowIso() });
  const via = publisherFor(pack);
  const caption = [post.caption, (post.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
  const results = {};
  let failed = null;
  for (const platform of pack.meta.platforms) {
    try {
      if (via === 'zernio') {
        results[platform] = await publishZernio({
          platform,
          accountId: pack.meta.zernio?.accounts?.[platform],
          caption,
          imageUrls: publicUrls(post, platform),
          privacy: pack.meta.zernio?.tiktokPrivacy || 'SELF_ONLY',
          aiLabel: Boolean(post.ai_label),
          title: post.hook,
        });
      } else {
        const dir = path.join(outDir(), 'published', pack.id, israelDate(t), postId);
        exportPost(db, postId, dir);
        const body = postBody({ platform, accountId: pack.meta.zernio?.accounts?.[platform] || '<account id>', caption, imageUrls: (post.media[platform] || []).map((f) => `<public url>/${path.basename(f)}`), privacy: pack.meta.zernio?.tiktokPrivacy || 'SELF_ONLY', aiLabel: Boolean(post.ai_label), title: post.hook });
        writeFileSync(path.join(dir, `zernio-request.${platform}.json`), `${JSON.stringify(body, null, 2)}\n`);
        results[platform] = { via: 'dry', path: dir, status: 'written' };
      }
    } catch (e) {
      results[platform] = { via, error: String(e.message).slice(0, 300), code: e.code || null };
      failed = e;
      break; // never retry a platform that might have half-posted; stop here and report
    }
  }

  const ok = !failed;
  db.update('posts', postId, {
    status: ok ? 'published' : 'failed',
    reason: ok ? null : String(failed.message).slice(0, 300),
    publish_json: results,
    published_at: ok ? new Date(t).toISOString() : null,
    updated_at: nowIso(),
  });
  step(db, postId, 'publish', ok ? 'ok' : 'failed', { via, results });
  audit(db, { action: ok ? 'published' : 'publish_failed', accountId: pack.id, postId, detail: { via } });

  if (!ok) {
    if (isStrike(failed)) pauseAccount(db, pack.id, 'strike', failed.message);
    else if (publishErrorStreak(db, pack.id) >= Number(settings(db).publishErrorStreak || 3)) pauseAccount(db, pack.id, 'publish_errors', failed.message);
  }
  return { postId, ok, via, results };
}
