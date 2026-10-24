// The other way to TikTok, kept for later: our own TikTok developer app, through TikTok's Content Posting API, without
// Zernio. NOT BUILT. A pack chooses it with "publishers": { "tiktok": "own-app" } in pack.json (the operator, on the
// Accounts page); until it is built the account's TikTok posts are written to disk by the dry publisher, as for any
// publisher whose credentials are missing (src/publish/index.js publisherFor), and the page says so.
//
// What building it takes, so the interface below is the one it fills:
//   - an app on developers.tiktok.com with the Content Posting API, its client key and secret in private/.env
//     (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET), and TikTok's audit before a post may be anything but private
//   - each customer's OAuth (video.upload for drafts, video.publish for direct posts) and the refresh of its token,
//     stored like Instagram's (src/publish/instagram.js)
//   - photo posts: POST /v2/post/publish/content/init/ with media_type PHOTO, post_mode MEDIA_UPLOAD (to the
//     creator's inbox, a draft) or DIRECT_POST, photo_images by URL from a verified domain; then the status
//     endpoint until it is out
//   - the network door (src/core/net.js) opens those two paths on open.tiktokapis.com, and nothing else
//   - analytics: /v2/video/query/ for our own posts' counts, read by src/metrics/collect.js like Zernio's

export const OWN_APP = 'own-app';

export class TikTokAppError extends Error {
  constructor(message, { code = null } = {}) {
    super(message);
    this.name = 'TikTokAppError';
    this.code = code;
  }
}

/** Whether our own TikTok app can publish. Not until it is built. */
export const tiktokAppConfigured = () => false;

/**
 * Publish one photo post to an account through our own app: { caption, imageUrls, privacy, asDraft } in, the same
 * result as publishZernio's out ({ via, postId, url, status, pending, draft }). Not built: it refuses.
 */
export async function publishTikTokApp() {
  throw new TikTokAppError('our own TikTok app is not built yet: the post goes through Zernio, or to disk', { code: 'not_built' });
}
