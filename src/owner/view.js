import { now } from '../core/clock.js';
import { linesOf, oneLine } from '../rules/overlay.js';
import { captionOf } from '../publish/index.js';
import { addDays, israelDate, israelInstant, wallClock } from '../schedule/israel.js';
import { lineSettings, quietAt } from './quiet.js';
import { mediaUrl } from './sign.js';

// What the owner line says about a workspace's posts, in the shapes docs/internal-assistant.md gives: a post as
// listed, a post with its slides, the Instagram set to post by hand, the workspace's status. Every picture is a
// signed link (src/owner/sign.js), so WhatsApp can fetch it without a session.

const inList = (ids) => ids.map(() => '?').join(', ') || 'NULL';

/** The set a post's pictures are shown from: Instagram's when it has one, else TikTok's. */
export const shownPlatform = (post) => (post.media?.instagram?.length ? 'instagram' : post.media?.tiktok?.length ? 'tiktok' : null);

const image = (post, platform, idx, env, t) => (platform && post.media?.[platform]?.[idx] ? { url: mediaUrl({ postId: post.id, platform, idx, env, t }) } : null);

/**
 * A slide's lines: its title line first, then its body's lines. The cover's are the post's cover line (as one line:
 * its breaks are the renderer's) and the line under it.
 */
export const slideLines = (post, slide) => (slide.kind === 'cover' ? [oneLine(post.hook), ...linesOf(post.sub)] : [oneLine(slide.title), ...linesOf(slide.body)]);

/** A post as listed. `number` is always null: Toran numbers the posts it shows. */
export function listed(ctx, post, { env = process.env, t = now() } = {}) {
  const pack = ctx.pack(post.account_id);
  return {
    id: post.id, number: null, account: { id: post.account_id, name: pack?.meta.displayName || post.account_id }, status: post.status,
    hook: oneLine(post.hook), slotAt: post.slot_at || null, slides: post.slides.length, cover: image(post, shownPlatform(post), 0, env, t),
  };
}

/** One slide as the API shows it: 1-based. */
export const slideOf = (post, i, { env = process.env, t = now() } = {}) => ({ idx: i + 1, kind: post.slides[i].kind, lines: slideLines(post, post.slides[i]), image: image(post, shownPlatform(post), i, env, t) });

/** A post with its caption, its hashtags and every slide. */
export function full(ctx, post, opts = {}) {
  return { ...listed(ctx, post, opts), caption: post.caption || '', hashtags: post.hashtags || [], slideList: post.slides.map((_, i) => slideOf(post, i, opts)) };
}

/**
 * What the owner needs to post it by hand: the Instagram slides and the caption as it would go out there (the short
 * one, the credits, the hashtags). A post with no Instagram set gives TikTok's, and says so in `platform`.
 */
export function bundle(ctx, post, { env = process.env, t = now() } = {}) {
  const platform = post.media?.instagram?.length ? 'instagram' : 'tiktok';
  return {
    post: { id: post.id, hook: oneLine(post.hook) },
    platform,
    images: (post.media?.[platform] || []).map((_, i) => ({ url: mediaUrl({ postId: post.id, platform, idx: i, env, t }) })),
    caption: captionOf(ctx.db, post, platform),
  };
}

/**
 * The workspace's month against its plan: { month, suggested: { used, limit }, redos: { used, limit } }. Teder has
 * no plan of suggestions and redos per workspace yet, so this is null, in the status, the weekly summary and the
 * quota check alike (src/owner/events.js quotaLow), until it does.
 */
export const quotaOf = () => null;

/** Sunday 00:00 of this week, Israel time. */
export const weekStart = (t = now()) => israelInstant(addDays(israelDate(t), -wallClock(t).day), '00:00').getTime();

/** GET /internal/assistant/status, for a workspace's context (src/web/workspace.js). */
export function status(ctx, { t = now() } = {}) {
  const { db } = ctx;
  const ids = ctx.packs.map((p) => p.id);
  const since = new Date(weekStart(t)).toISOString();
  const count = (where, ...params) => db.get(`SELECT COUNT(*) AS n FROM posts WHERE account_id IN (${inList(ids)}) AND ${where}`, ...ids, ...params).n;
  const line = lineSettings(db, ctx.workspaceId);
  return {
    workspace: ctx.workspaceId,
    accounts: ctx.packs.map((p) => {
      const row = db.get('SELECT mode, status FROM accounts WHERE id = ?', p.id);
      return { id: p.id, name: p.meta.displayName, mode: row?.mode || null, status: row?.status || null };
    }),
    pending: count("status = 'queued'"),
    approvedThisWeek: count('approved_at >= ?', since),
    publishedThisWeek: count('published_at >= ?', since),
    quota: quotaOf(ctx, t),
    quiet: quietAt(line, t),
    quietHours: line.quietHours,
    shabbat: line.shabbat,
  };
}

export { inList };
