import { isSet } from '../core/env.js';
import { getBytes, getJson } from '../core/net.js';
import { now, nowIso, DAY } from '../core/clock.js';
import { audit, cachedLookup } from '../core/store.js';
import { j } from '../db/index.js';
import { record } from '../budget/ledger.js';
import { askJson } from '../llm/index.js';

// Formats that work right now, found on YouTube Shorts with their real numbers.
//
// COPY THE FORMAT, NEVER THE CONTENT. The vision model sees a winner's
// thumbnail and title and returns only a shape: a Hebrew hook pattern with
// placeholders, which of this pack's formats it is, and why it works. The image
// lives for one request and is never written anywhere. A card is refused when
// any field repeats three consecutive words of the source, or the hook carries a
// digit (a count is {n}, filled from our own facts) or a Latin word (a name).
// What is kept of the source is its link and its numbers, for the report.
//
// NUMBERS ARE YOUTUBE'S OWN. Views, likes and comments come from videos.list.
// Nothing is estimated, and a video whose numbers are hidden is not ranked.
//
// A kept card becomes a trial format in the pack's rotation: the base format it
// maps to, with the new hook pattern. It has to earn its place by the same
// 72-hour numbers as everything else.

const YT = 'https://www.googleapis.com/youtube/v3';
export const youtubeConfigured = () => isSet('YOUTUBE_API_KEY');

export function youtubeClient(key = process.env.YOUTUBE_API_KEY) {
  return {
    async search(q, { lang = 'he', days = 30, max = 15, t = now() } = {}) {
      const params = new URLSearchParams({ part: 'snippet', q, type: 'video', videoDuration: 'short', order: 'relevance', relevanceLanguage: lang, maxResults: String(max), publishedAfter: new Date(t - days * DAY).toISOString(), key });
      if (lang === 'he') params.set('regionCode', 'IL');
      const body = await getJson(`${YT}/search?${params}`);
      return (body?.items || []).filter((i) => i.id?.videoId).map((i) => ({ id: i.id.videoId, url: `https://www.youtube.com/shorts/${i.id.videoId}`, title: i.snippet?.title || '', description: i.snippet?.description || '', thumb: i.snippet?.thumbnails?.high?.url || null, publishedAt: i.snippet?.publishedAt || null }));
    },
    async stats(ids) {
      const out = new Map();
      for (let i = 0; i < ids.length; i += 50) {
        const body = await getJson(`${YT}/videos?${new URLSearchParams({ part: 'statistics', id: ids.slice(i, i + 50).join(','), key })}`);
        for (const v of body?.items || []) {
          const num = (x) => (x == null ? null : Number(x));
          out.set(v.id, { views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount) });
        }
      }
      return out;
    },
  };
}

const words = (s) => String(s || '').toLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(Boolean);
export function trigrams(text) {
  const w = words(text);
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
}

/** Why a card cannot be kept, or null: the check behind "never the content". */
export function sourceLeak(card, source) {
  const from = new Set([...trigrams(source?.title), ...trigrams(source?.description)]);
  for (const field of ['hookShape', 'structure', 'why']) for (const t of trigrams(card?.[field])) if (from.has(t)) return `${field} repeats the source: "${t}"`;
  const hook = String(card?.hookShape || '');
  if (/\d/.test(hook)) return `the hook carries a number from the source: "${hook}"`;
  if (/[A-Za-z]{2,}/.test(hook.replace(/\{[a-z]+\}/g, ''))) return `the hook carries a Latin word, likely a name: "${hook}"`;
  if (!/[א-ת]/.test(hook)) return 'the hook is not Hebrew';
  return null;
}

const SCHEMA = {
  type: 'object',
  properties: {
    reusable: { type: 'boolean' },
    format: { type: 'string' },
    hookShape: { type: 'string' },
    structure: { type: 'string' },
    why: { type: 'string' },
  },
  required: ['reusable', 'format', 'hookShape', 'structure', 'why'],
  additionalProperties: false,
};

function system(pack) {
  return `You study short videos and slideshows that are doing well, to learn their FORMAT for a Hebrew account, "${pack.meta.displayName}", about ${(pack.meta.topics || []).join(', ')}. You never copy their content.

The account can build only these formats: ${pack.formats.formats.map((f) => `"${f.id}" (${f.name}: ${f.about || ''})`).join('; ')}.

From the cover image and the title, return:
- reusable: true only if this is a format the account could fill with its own sourced facts, on another subject.
- format: the id of the account's format it matches, or "" if none.
- hookShape: the cover line as a reusable HEBREW pattern, natural spoken Hebrew, with {x} for the subject and {n} for any count. No names of people, places, products or brands; no numbers (use {n}); no words copied from the title.
- structure: in Hebrew, how the slides are likely ordered, abstractly.
- why: a short Hebrew phrase on what makes the format work.
Describe only the structure. Never repeat the title's wording.`;
}

/** Look for winners for one pack and turn the ones that fit into trial formats. */
export async function runTrends(ctx, pack, { yt = youtubeConfigured() ? youtubeClient() : null, bytes = getBytes, t = now(), keep = 6 } = {}) {
  const notes = [];
  if (!yt) return { found: 0, kept: 0, notes: ['אין YOUTUBE_API_KEY: יוטיוב לא נבדק, ושום מספר לא הומצא במקום'] };
  const cfg = pack.formats.trends || {};
  const raw = new Map();
  for (const lang of ['he', 'en']) {
    for (const q of cfg.queries?.[lang] || []) {
      try {
        // A week-old answer to the same search is reused: trends run weekly, and search.list has a daily quota of 100.
        const { value, cached } = await cachedLookup(ctx.db, `youtube:search:${lang}:${q}`, 7, () => yt.search(q, { lang, t }));
        for (const v of value || []) if (!raw.has(v.id)) raw.set(v.id, { ...v, lang, query: q });
        if (!cached) record(ctx.db, { accountId: pack.id, api: 'youtube', usd: 0, tag: 'trends' });
      } catch (e) {
        notes.push(`YouTube "${q}": ${e.message}`);
        if (e.status === 403) break;
      }
    }
  }
  const stats = raw.size ? await yt.stats([...raw.keys()]).catch((e) => (notes.push(`YouTube stats: ${e.message}`), new Map())) : new Map();
  const winners = [...raw.values()]
    .map((v) => ({ ...v, ...(stats.get(v.id) || {}) }))
    .filter((v) => v.views != null && v.views >= (cfg.minViews?.[v.lang] ?? 0))
    .filter((v) => !ctx.db.get('SELECT id FROM trend_formats WHERE account_id = ? AND url = ?', pack.id, v.url))
    .sort((a, b) => b.views - a.views)
    .slice(0, keep);

  let kept = 0;
  for (const v of winners) {
    let card = null;
    let why = null;
    try {
      const img = v.thumb ? await bytes(v.thumb, { maxBytes: 2_000_000 }) : null;
      const { data } = await askJson(ctx.withPack ? ctx.withPack(pack) : { ...ctx, pack }, {
        task: 'trend', role: 'judge', system: system(pack), user: `Title: ${String(v.title).slice(0, 300)}`, image: img, schema: SCHEMA, effort: 'low', maxTokens: 4000, expectOut: 600, tag: 'trend',
      });
      card = data;
      if (!card.reusable) why = `לא פורמט שאפשר למלא: ${card.why}`;
      else if (!pack.formats.formats.some((f) => f.id === card.format)) why = 'לא מתאים לאף פורמט שהחשבון יודע לבנות';
      else why = sourceLeak(card, v);
    } catch (e) {
      why = `לא נבדק: ${e.message}`;
    }
    const status = why ? 'rejected' : 'kept';
    const id = ctx.db.insert('trend_formats', {
      account_id: pack.id, platform: 'youtube', url: v.url, views: v.views, likes: v.likes ?? null, comments: v.comments ?? null, published_at: v.publishedAt,
      card_json: card ? { format: card.format, hookShape: card.hookShape, structure: card.structure, why: card.why } : null, status, why, found_at: nowIso(),
    });
    if (status === 'kept') {
      kept++;
      ctx.db.insert('formats', { account_id: pack.id, format_key: `trend:${id}`, kind: 'trial', status: 'active', weight: 1, own: 0, results_json: [] });
      audit(ctx.db, { action: 'trend_kept', accountId: pack.id, detail: { url: v.url, views: v.views, hook: card.hookShape } });
    }
  }
  return { found: winners.length, kept, notes };
}

/**
 * A format key to a format the pipeline can build: one of the pack's own, or a
 * trend trial, which is its base format with the new hook pattern.
 */
export function resolveFormat(db, pack, key) {
  const own = pack.formats.formats.find((f) => f.id === key);
  if (own) return own;
  const m = /^trend:(\d+)$/.exec(String(key || ''));
  if (!m) return null;
  const row = db.get("SELECT * FROM trend_formats WHERE id = ? AND account_id = ? AND status = 'kept'", Number(m[1]), pack.id);
  const card = j(row?.card_json, null);
  const base = card && pack.formats.formats.find((f) => f.id === card.format);
  if (!base) return null;
  return { ...base, id: key, base: base.id, name: `${base.name}: פורמט שנמצא ביוטיוב`, hooks: [card.hookShape], about: `${base.about || ''} The cover follows a pattern that works now: ${card.hookShape}.`, trend: { url: row.url, views: row.views } };
}
