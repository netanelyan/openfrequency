import { getJson, postJson } from '../core/net.js';
import { isSet } from '../core/env.js';

// Posting through Zernio, one Zernio account per platform per pack.
//
// What it can do to an account: create a post on it. Nothing here reads an
// inbox, comments, likes, follows or messages anyone; the network door refuses
// those Zernio paths by name (src/core/net.js), so this file could not if it
// tried.
//
// The request shape follows docs.zernio.com: images as mediaItems (Zernio
// fetches them by URL, so slides must be served from a public https address),
// TikTok's settings including its two consent flags, and publishNow. A post
// Zernio accepted and is still processing when the wait runs out is not a
// failure: it is recorded under Zernio's id and checked again later, because
// retrying it is how a post goes out twice.
//
// HARD RULE 4: when a post carries a realistic AI-generated image, TikTok's
// `video_made_with_ai` flag is the platform's disclosure. Zernio documents that
// direct photo posts reject it for some accounts, so a photo post with such an
// image is sent as a draft (`draft: true`) for the label to be set in the app,
// and the website says so. Instagram's API has no such flag: the caption gets a
// plain disclosure line instead.

const BASE = () => (process.env.ZERNIO_BASE || 'https://zernio.com/api/v1').replace(/\/$/, '');
const auth = () => ({ authorization: `Bearer ${String(process.env.ZERNIO_API_KEY || '').trim()}` });

export const zernioConfigured = () => isSet('ZERNIO_API_KEY');

export class ZernioError extends Error {
  constructor(message, { step, code = null, status = null, category = null } = {}) {
    super(message);
    this.name = 'ZernioError';
    this.step = step;
    this.code = code;
    this.status = status;
    this.category = category;
  }
}

export const AI_CAPTION_LINE = 'התמונה בפוסט נוצרה בעזרת AI.';

/** The request body for one platform. Pure, so the tests can read it. */
export function postBody({ platform, accountId, caption, imageUrls, privacy = 'SELF_ONLY', aiLabel = false, title = '' }) {
  if (platform === 'tiktok') {
    return {
      content: String(title).slice(0, 90),
      mediaItems: imageUrls.map((url) => ({ type: 'image', url })),
      platforms: [{ platform: 'tiktok', accountId }],
      tiktokSettings: {
        privacy_level: privacy,
        allow_comment: true,
        media_type: 'photo',
        photo_cover_index: 0,
        description: String(caption).slice(0, 4000),
        auto_add_music: true,
        content_preview_confirmed: true,
        express_consent_given: true,
        ...(aiLabel ? { video_made_with_ai: true, draft: true } : {}),
      },
      publishNow: true,
    };
  }
  return {
    content: `${String(caption)}${aiLabel ? `\n\n${AI_CAPTION_LINE}` : ''}`.slice(0, 2200),
    mediaItems: imageUrls.map((url) => ({ type: 'image', url })),
    platforms: [{ platform, accountId }],
    publishNow: true,
  };
}

function partOf(post, platform) {
  const p = (post?.platforms || []).find((x) => x.platform === platform) || {};
  return { status: p.status || post?.status || null, url: p.platformPostUrl || null, postId: p.platformPostId ? String(p.platformPostId) : null, error: p.errorMessage || null, category: p.errorCategory || null };
}

/** Create one post on one platform and wait for it, up to timeoutMs. */
export async function publishZernio({ platform, accountId, caption, imageUrls, privacy, aiLabel, title }, { pollMs = 5000, timeoutMs = 180_000 } = {}) {
  if (!zernioConfigured()) throw new ZernioError('ZERNIO_API_KEY is not set', { step: 'config', code: 'not_configured' });
  if (!accountId) throw new ZernioError(`no Zernio ${platform} account id in pack.json`, { step: 'config', code: 'no_account' });
  if (platform === 'tiktok' && (imageUrls.length < 2 || imageUrls.length > 35)) throw new ZernioError(`a TikTok photo post takes 2 to 35 images, this one has ${imageUrls.length}`, { step: 'config', code: 'card_images' });
  if (platform === 'instagram' && imageUrls.length > 10) throw new ZernioError(`an Instagram carousel takes at most 10 images, this one has ${imageUrls.length}`, { step: 'config', code: 'card_images' });
  let created;
  try {
    created = await postJson(`${BASE()}/posts`, postBody({ platform, accountId, caption, imageUrls, privacy, aiLabel, title }), { headers: auth(), timeoutMs: 30_000 });
  } catch (e) {
    throw new ZernioError(e.message, { step: 'create', code: e.code, status: e.status, category: e.body?.error?.errorCategory || null });
  }
  const id = created?.post?._id;
  if (!id) throw new ZernioError('Zernio accepted the post but returned no id', { step: 'create', code: 'no_id' });
  let part = partOf(created.post, platform);
  const deadline = Date.now() + timeoutMs;
  while (!['published', 'failed', 'cancelled'].includes(part.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const { post } = await getJson(`${BASE()}/posts/${encodeURIComponent(id)}`, { headers: auth() });
    part = partOf(post, platform);
  }
  if (part.status === 'failed' || part.status === 'cancelled') {
    throw new ZernioError(`${platform} refused the post: ${part.error || part.status}`, { step: 'status', code: part.category || part.status, category: part.category });
  }
  return { via: 'zernio', zernioId: id, postId: part.postId, url: part.url, status: part.status, pending: part.status !== 'published', draft: Boolean(aiLabel && platform === 'tiktok') };
}

/** A platform strike or a content-policy refusal: the account pauses, it does not retry. */
export const isStrike = (e) => e instanceof ZernioError && (e.category === 'user_content' || /strike|violation|banned|suspend|restricted|spam/i.test(`${e.code} ${e.message}`));

/** Broken until somebody fixes the connection. */
export const isConfigProblem = (e) => e instanceof ZernioError && (e.status === 401 || e.status === 403 || e.category === 'auth_expired' || ['not_configured', 'no_account'].includes(e.code));

/** Per-post numbers from Zernio's analytics. Returns { platform: stats } or null while it is still syncing. */
export async function zernioAnalytics(zernioId) {
  const body = await getJson(`${BASE()}/analytics?${new URLSearchParams({ postId: zernioId })}`, { headers: auth() });
  const posts = body?.posts || (body?.post ? [body.post] : []);
  const out = {};
  for (const p of posts) {
    const a = p.analytics || {};
    const num = (x) => (x == null ? null : Number(x));
    out[p.platform] = { views: num(a.views ?? a.impressions), likes: num(a.likes), comments: num(a.comments), shares: num(a.shares), saves: p.platform === 'tiktok' ? null : num(a.saves) };
  }
  return Object.keys(out).length ? out : null;
}
