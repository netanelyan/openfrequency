import { copyFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { now, nowIso } from '../core/clock.js';
import { dataDir, ensureDir, outDir } from '../core/paths.js';
import { audit, settings, step } from '../core/store.js';
import { restAt } from '../schedule/shabbat.js';
import { israelDate } from '../schedule/israel.js';
import { verifyFact } from '../verify/claims.js';
import { formatOfPost, gateDraft, loadPost, postDraft } from '../pipeline/build.js';
import { exportPost } from '../pipeline/export.js';
import { imageCredit, waitingImages } from '../images/index.js';
import { canRun, pauseAccount, publishErrorStreak } from '../autonomy/rails.js';
import { isStrike, postBody, publishZernio, zernioConfigured } from './zernio.js';
import { instagramConfigured, isRefusal, isThrottle, isTokenProblem, publishInstagram } from './instagram.js';

// Publishing one approved post, through the rails, to each of its pack's
// platforms, each by the publisher the pack names for it:
//
//   "publishers": { "tiktok": "zernio", "instagram": "instagram" }
//
// zernio      through Zernio (TikTok; Instagram too if a pack wants it)
// instagram   directly through Meta's Graph API (src/publish/instagram.js)
// dry         to disk, with the exact request a publisher would have received
//
// THE DRY PUBLISHER IS THE DEFAULT. A platform's post leaves only when all three
// say so: PUBLISH_MODE=live in the environment, the publisher's credentials
// (ZERNIO_API_KEY; or the pack's Instagram token and account id), and the pack's
// own choice for that platform. Anything less writes it to disk.
//
// A post publishes platform by platform. A platform that is already out (or
// still being processed) is never sent again, so a post that went out on
// TikTok and was throttled on Instagram resumes on Instagram alone at the next
// tick. A throttle or a network error waits for the next tick, three times at
// most; anything else stops the post where it is.
//
// Before anything goes anywhere, every time:
//   - not on Shabbat or a yom tov (HARD RULE 9: the scheduler never plans such a
//     slot, and this refuses one anyway)
//   - no kill switch, the account not paused
//   - the post approved
//   - every fact verified again against its stored document, with its source
//     still approved, and the text still hashing to the token the gate issued.
//     A failure here is a failed fact check: the post is blocked and the account
//     paused.

/** What the pack asks for on a platform, whether or not it can be done now. */
export const wantedPublisher = (pack, platform) => pack.meta.publishers?.[platform] || pack.meta.publisher || 'dry';

/** The publisher a platform's post will really go through now: 'zernio', 'instagram' or 'dry'. */
export function publisherFor(pack, platform, { db = null, env = process.env } = {}) {
  const want = wantedPublisher(pack, platform);
  if (env.PUBLISH_MODE !== 'live') return 'dry';
  if (want === 'zernio' && zernioConfigured()) return 'zernio';
  if (want === 'instagram' && platform === 'instagram' && db && instagramConfigured(db, pack, env)) return 'instagram';
  return 'dry';
}

const MAX_ATTEMPTS = 3;

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
  const g = gateDraft(formatOfPost(db, pack, post), postDraft(post), facts);
  problems.push(...g.problems);
  if (post.checks?.token && g.token !== post.checks.token) problems.push('the text changed after it was checked');
  return problems;
}

/** Copy a post's slides to the public media folder Caddy serves; returns their URLs. */
function publicUrls(post, platform) {
  const base = String(process.env.MEDIA_PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(base)) throw new PublishRefused('MEDIA_PUBLIC_BASE_URL is not an https address: Zernio and Instagram fetch slides by URL', 'no_media_url');
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

  const rest = restAt(t);
  if (rest) throw new PublishRefused(`${rest}: לא מפרסמים עכשיו`, 'shabbat');
  const run = canRun(db, pack.id);
  if (!run.ok) throw new PublishRefused(run.why, 'paused');
  if (post.status !== 'approved') throw new PublishRefused(`the post is ${post.status}, not approved`, 'not_approved');
  // A photograph the screen could not clear waits for a person to look at it: every one on the post, not only the cover's.
  if (waitingImages(db, post).length) throw new PublishRefused('התמונה מחכה לבדיקה של אדם (דם, פציעה, סימן מים): אשרו אותה בדף הפוסט', 'image_review');

  const problems = recheck(db, post, pack);
  if (problems.length) {
    db.update('posts', postId, { status: 'blocked', reason: `בדיקת העובדות נכשלה לפני פרסום: ${problems[0]}`, updated_at: nowIso() });
    step(db, postId, 'publish', 'failed', { kind: 'fact_check', problems });
    pauseAccount(db, pack.id, 'fact_check', problems[0]);
    throw new PublishRefused(`fact check failed before publishing: ${problems[0]}`, 'fact_check');
  }

  db.update('posts', postId, { status: 'publishing', updated_at: nowIso() });
  // TikTok gets the long caption; Instagram the short one, which repeats the cover line.
  const captionFor = (platform) => [platform === 'instagram' && post.caption_ig ? post.caption_ig : post.caption, imageCredit(db, post), (post.hashtags || []).join(' ')].filter(Boolean).join('\n\n');
  const results = { ...(post.publish || {}) };
  const attempts = (Number(results._attempts) || 0) + 1;
  delete results._attempts;
  const done = (r) => r && !r.error && (r.status === 'published' || r.status === 'written' || r.pending || r.zernioId || r.mediaId);
  let failed = null;
  const vias = {};
  for (const platform of pack.meta.platforms) {
    if (done(results[platform])) continue; // out already: never twice
    const via = publisherFor(pack, platform, { db });
    vias[platform] = via;
    try {
      if (via === 'zernio') {
        results[platform] = await publishZernio({
          platform,
          accountId: pack.meta.zernio?.accounts?.[platform],
          caption: captionFor(platform),
          imageUrls: publicUrls(post, platform),
          privacy: pack.meta.zernio?.tiktokPrivacy || 'SELF_ONLY',
          aiLabel: Boolean(post.ai_label),
          title: post.hook,
        });
      } else if (via === 'instagram') {
        results[platform] = await publishInstagram(db, pack, { caption: captionFor(platform), imageUrls: publicUrls(post, platform), aiLabel: Boolean(post.ai_label), priorCreationId: results[platform]?.creationId || null });
      } else {
        const dir = path.join(outDir(), 'published', pack.id, israelDate(t), postId);
        exportPost(db, postId, dir);
        const urls = (post.media[platform] || []).map((f) => `<public url>/${path.basename(f)}`);
        const want = wantedPublisher(pack, platform);
        const body =
          want === 'instagram'
            ? { graph: 'POST /{ig-user-id}/media for each slide (is_carousel_item), then media_type=CAROUSEL with children and caption, then POST /{ig-user-id}/media_publish', userId: pack.meta.instagram?.userId || '<instagram user id>', slides: urls, caption: `${captionFor(platform)}${post.ai_label ? '\n\n<AI line>' : ''}`.slice(0, 2200) }
            : postBody({ platform, accountId: pack.meta.zernio?.accounts?.[platform] || '<account id>', caption: captionFor(platform), imageUrls: urls, privacy: pack.meta.zernio?.tiktokPrivacy || 'SELF_ONLY', aiLabel: Boolean(post.ai_label), title: post.hook });
        writeFileSync(path.join(dir, `${want === 'instagram' ? 'instagram' : 'zernio'}-request.${platform}.json`), `${JSON.stringify(body, null, 2)}\n`);
        results[platform] = { via: 'dry', path: dir, status: 'written', wanted: want };
      }
    } catch (e) {
      results[platform] = { ...(results[platform] || {}), via, error: String(e.message).slice(0, 300), code: e.code || null, creationId: e.creationId || results[platform]?.creationId || null };
      failed = e;
      break; // a platform that might have half-posted is never retried blind; stop here and report
    }
  }

  // An Instagram throttle, or a container still processing, clears by itself: try
  // again at a later tick, a few times. Instagram publishes only at media_publish
  // and every retry first asks whether the last container went out, so a retry
  // cannot post twice. A Zernio error is never retried blind: a lost answer to a
  // create can be a post that exists.
  const retry = Boolean(failed) && attempts < MAX_ATTEMPTS && (isThrottle(failed) || failed.retryable === true);
  const ok = !failed;
  const status = ok ? 'published' : retry ? 'approved' : 'failed';
  db.update('posts', postId, {
    status,
    reason: ok ? null : `${retry ? 'ינסה שוב: ' : ''}${String(failed.message).slice(0, 300)}`,
    publish_json: { ...results, ...(retry ? { _attempts: attempts } : {}) },
    published_at: ok ? new Date(t).toISOString() : null,
    updated_at: nowIso(),
  });
  step(db, postId, 'publish', ok ? 'ok' : 'failed', { via: vias, results, attempt: attempts, retry });
  audit(db, { action: ok ? 'published' : retry ? 'publish_retry' : 'publish_failed', accountId: pack.id, postId, detail: { via: vias } });

  if (failed && !retry) {
    if (isStrike(failed) || isRefusal(failed)) pauseAccount(db, pack.id, 'strike', failed.message);
    else if (isTokenProblem(failed)) pauseAccount(db, pack.id, 'publish_errors', `האסימון של אינסטגרם פג או נפסל: ${failed.message}`);
    else if (publishErrorStreak(db, pack.id) >= Number(settings(db).publishErrorStreak || 3)) pauseAccount(db, pack.id, 'publish_errors', failed.message);
  }
  const via = [...new Set(Object.values(vias))].join('+') || 'none';
  return { postId, ok, via, results, retry };
}
