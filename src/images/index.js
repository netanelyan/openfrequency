import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isSet } from '../core/env.js';
import { getBytes, getJson } from '../core/net.js';
import { nowIso } from '../core/clock.js';
import { ensureDir, mediaDir } from '../core/paths.js';
import { record } from '../budget/ledger.js';
import { blockedQuery } from '../rules/check.js';
import { screenImage } from './safety.js';

// HARD RULE 5: images only from licensed libraries, with the licence stored per
// image. Pexels and Unsplash (commercial use, their own licences) and Wikimedia
// Commons (only the licences on the allowlist below: public domain, CC0, CC BY,
// CC BY-SA; never NC, ND or "fair use"). Nothing is ever taken from a search
// engine's copy of a picture, a news site or a business's page.
//
// HARD RULE 4 lives here too: every image row carries ai_generated and realistic.
// No provider below generates images; a future one that does must set both, and
// the publisher reads them to set the platform's AI-content flag.
//
// Candidates whose description names a logo, a crest, a badge, a screenshot or
// anything the pack blocks (rules.json imageQueryBlock) are refused, and so is a
// query that asks for one.

const ALWAYS_BLOCK = ['logo', 'crest', 'emblem', 'badge', 'trademark', 'screenshot', 'jersey', 'kit', 'mascot', 'poster', 'banner', 'sign', 'text'];
const COMMONS_OK = /^(?:cc0|cc[- ]zero|public domain|pd(?:[- ].*)?|cc by(?:-sa)? \d(?:\.\d)?(?: .*)?|cc by(?:-sa)?|attribution(?:-sharealike)?)$/i;
const COMMONS_NO = /\bnc\b|non-?commercial|\bnd\b|no ?deriv|fair use|copyrighted|all rights reserved/i;

export const commonsLicenseOk = (name) => {
  const n = String(name || '').trim();
  return Boolean(n) && COMMONS_OK.test(n) && !COMMONS_NO.test(n);
};

const plain = (html) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** Commons' Artist field can hold the same name twice in its markup: "Unknown author Unknown author" becomes "Unknown author". */
export const once = (s) => {
  const w = String(s || '').split(' ');
  const half = w.length / 2;
  return w.length % 2 === 0 && half > 0 && w.slice(0, half).join(' ') === w.slice(half).join(' ') ? w.slice(0, half).join(' ') : String(s || '');
};
const describes = (text, words) => {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ')} `;
  return words.find((w) => t.includes(` ${String(w).toLowerCase()} `)) || null;
};

const commons = {
  id: 'commons',
  ready: () => true,
  async search(query, { n = 20 } = {}) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(n),
      prop: 'imageinfo|categories', iiprop: 'url|size|extmetadata|mime', iiurlwidth: '1440', clshow: '!hidden', cllimit: 'max',
    });
    const body = await getJson(`https://commons.wikimedia.org/w/api.php?${params}`);
    return (body?.query?.pages || [])
      .map((p) => {
        const ii = p.imageinfo?.[0];
        const md = ii?.extmetadata || {};
        return {
          provider: 'commons',
          providerId: p.title,
          url: ii?.thumburl || ii?.url,
          width: ii?.thumbwidth || ii?.width,
          original: [ii?.width || 0, ii?.height || 0],
          height: ii?.thumbheight || ii?.height,
          license: plain(md.LicenseShortName?.value),
          licenseUrl: md.LicenseUrl?.value || null,
          author: once(plain(md.Artist?.value)) || null,
          authorUrl: null,
          sourceUrl: ii?.descriptionurl || null,
          alt: `${p.title} ${plain(md.ImageDescription?.value)}`.slice(0, 400),
          // A file's categories name what it shows ("Steven Gerrard", "Liverpool F.C. players"), often when its title does not.
          categories: (p.categories || []).map((c) => String(c.title || '').replace(/^Category:/, '')).join(' · ').slice(0, 600),
          mime: ii?.mime,
        };
      })
      // The sharpest first: a blurry candid was picked over a portrait because it came first.
      .sort((a, b) => Math.min(...b.original) - Math.min(...a.original))
      // A license that requires attribution is usable only with a name to attribute. And a
      // photograph, not a still from a video or a screenshot: a JPEG at least 800 pixels a side.
      .filter((c) => c.url && c.mime === 'image/jpeg' && Math.min(...c.original) >= 800 && commonsLicenseOk(c.license) && (c.author || !needsCredit(c.license)));
  },
};

const pexels = {
  id: 'pexels',
  ready: () => isSet('PEXELS_API_KEY'),
  async search(query, { n = 15 } = {}) {
    const body = await getJson(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: String(n), orientation: 'portrait' })}`, {
      headers: { authorization: process.env.PEXELS_API_KEY },
    });
    return (body?.photos || []).map((p) => {
      const u = p.src?.original ? new URL(p.src.original) : null;
      if (u) for (const [k, v] of Object.entries({ auto: 'compress', cs: 'tinysrgb', fit: 'crop', crop: 'entropy', w: '1080', h: '1920' })) u.searchParams.set(k, v);
      return {
        provider: 'pexels', providerId: String(p.id), url: u?.href || p.src?.large2x, width: 1080, height: 1920,
        license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', author: p.photographer || null, authorUrl: p.photographer_url || null,
        sourceUrl: p.url || null, alt: p.alt || '',
      };
    });
  },
};

const unsplash = {
  id: 'unsplash',
  ready: () => isSet('UNSPLASH_ACCESS_KEY'),
  async search(query, { n = 15 } = {}) {
    const auth = { authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` };
    const body = await getJson(`https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: String(n), orientation: 'portrait', content_filter: 'high' })}`, { headers: auth });
    return (body?.results || []).map((p) => ({
      provider: 'unsplash', providerId: p.id, url: p.urls?.raw ? `${p.urls.raw}&w=1080&h=1920&fit=crop&crop=entropy&q=80&fm=jpg` : null, width: 1080, height: 1920,
      license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license', author: p.user?.name || null, authorUrl: p.user?.links?.html || null,
      sourceUrl: p.links?.html || null, alt: p.alt_description || p.description || '',
      // Their terms ask for a ping when a photo is used.
      track: p.links?.download_location || null,
    }));
  },
};

/**
 * Photographs the owner added by hand to the pack (<pack>/photos/photos.json):
 * an event photo the owner decided the account may use, with where it came from
 * and whom to credit. Matched to a query by the subject's words (a fighter's
 * name). Every one still passes the image screen, and its origin is stored.
 */
const packPhotos = {
  id: 'pack',
  ready: () => true,
  async search(query, { pack } = {}) {
    const dir = pack?.dir ? path.join(pack.dir, 'photos') : null;
    if (!dir || !existsSync(path.join(dir, 'photos.json'))) return [];
    const list = JSON.parse(readFileSync(path.join(dir, 'photos.json'), 'utf8')).photos || [];
    const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9֐-׿]+/).filter((w) => w.length >= 3);
    const want = new Set(words(query));
    return list
      .map((p) => ({ p, hits: words(p.subject).filter((w) => want.has(w)).length }))
      .filter((x) => x.hits >= Math.min(2, want.size))
      .sort((a, b) => b.hits - a.hits)
      .map(({ p }) => ({
        provider: 'pack', providerId: p.file, file: path.join(dir, p.file), url: null, license: p.license || 'used by the owner\'s decision', licenseUrl: null,
        author: p.credit || null, authorUrl: null, sourceUrl: p.origin || null, alt: `${p.subject} ${p.description || ''}`.trim(),
      }));
  },
};

export const PROVIDERS = { pexels, unsplash, commons, pack: packPhotos };

/**
 * Whether a picture's title names the person a query names: two of the query's name
 * words side by side, as a name is written ("Holly_Holm_at_UFC"). A word of the name
 * was not enough ("Holm" matched "Rudder Rock, Steep Holm Island", "Serra" a plant
 * called Senecio serra), and neither were both words apart ("Holly with berries, Holm
 * Hill"). A query with a single name word needs that word.
 */
export function namesIn(title, names) {
  const words = String(title).toLowerCase().replace(/[_%]/g, ' ').split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);
  const want = names.map((n) => n.toLowerCase());
  if (want.length < 2) return want.every((n) => words.includes(n));
  return want.slice(1).some((b, i) => words.some((w, j) => w === want[i] && words[j + 1] === b));
}

/** Does a file's title name a person or a place (two capitalised words in a row), rather than a camera's numbering? */
export function titleNamesSomeone(title) {
  const t = String(title || '').replace(/^File:/, '').replace(/\.[a-z]{3,4}$/i, '').replace(/[_()-]/g, ' ');
  return /\p{Lu}\p{Ll}+\s+\p{Lu}\p{Ll}+/u.test(t);
}

/** CC BY and CC BY-SA require the author and the license next to the picture. */
export const needsCredit = (license) => /\bby\b|attribution/i.test(String(license || ''));

/** The names a query asks a picture to show: its capitalised words, less the promotions' and the sport's own. */
export const namesOf = (query) => String(query).split(/\s+/).filter((w) => /^\p{Lu}\p{L}{2,}/u.test(w) && !/^(UFC|PFL|ONE|MMA|BJJ|FC|The|Stadium|Arena|Park)$/i.test(w));

const PROVIDER_NAME = { commons: 'Wikimedia Commons', pexels: 'Pexels', unsplash: 'Unsplash' };

/** Every photograph a post shows: its slides' and its lead one, once each. */
export function postImages(db, post) {
  const ids = [...new Set([...(post.slides || []).map((s) => s.image_id), post.checks?.image, post.checks?.bgImage, ...(post.checks?.coverImages || [])].filter(Boolean))];
  return ids.map((id) => db.get('SELECT * FROM images WHERE id = ?', id)).filter(Boolean);
}

/** The photographs of a post the screen could not clear and no person has looked at yet. */
export const waitingImages = (db, post) => postImages(db, post).filter((img) => img.safety && img.safety !== 'ok' && !img.reviewed_at);

/**
 * The credit line a post's caption carries for the photos whose license asks for
 * one, or ''. It is added when the caption is published, after the checks: a
 * license name ("CC BY-SA 4.0") is not a claim, and its numbers are not facts.
 */
export function imageCredit(db, post) {
  const ids = [...new Set((post.slides || []).map((s) => s.image_id).filter(Boolean))];
  const credits = ids
    .map((id) => db.get('SELECT provider, license, author FROM images WHERE id = ?', id))
    .filter((img) => img && needsCredit(img.license))
    .map((img) => `${img.author} · ${img.license} · ${PROVIDER_NAME[img.provider] || img.provider}`);
  return credits.length ? `${credits.length > 1 ? 'צילומים' : 'צילום'}: ${[...new Set(credits)].join(' | ')}` : '';
}

/**
 * One licensed photograph for a query, stored with its licence, or null.
 * `mode` 'recorded' never touches the network and returns null: offline runs
 * render the theme's own ground instead of a photograph. A run that wants real
 * photographs with recorded drafts (the launch set) sets ctx.imagesLive.
 */
export async function findImage(ctx, { pack, query, postId = null, claim = '' }) {
  if (!query || (ctx.mode === 'recorded' && !ctx.imagesLive)) return null;
  const blocked = blockedQuery(pack, query) || describes(query, ALWAYS_BLOCK);
  if (blocked) {
    ctx.log?.(`image query refused ("${blocked}"): ${query}`);
    return null;
  }
  const order = (pack.meta.imagery?.providers || ['pexels', 'unsplash', 'commons']).map((id) => PROVIDERS[id]).filter((p) => p?.ready());
  const block = [...ALWAYS_BLOCK, ...(pack.rules?.imageQueryBlock || [])];
  for (const prov of order) {
    let found = [];
    try {
      found = await prov.search(query, { pack });
      if (prov.id !== 'pack') record(ctx.db, { accountId: pack.id, postId, api: prov.id, usd: 0, tag: 'image-search' });
    } catch (e) {
      ctx.log?.(`${prov.id}: ${e.message}`);
      continue;
    }
    // A query that names someone ("Holly Holm UFC") takes only a picture whose own title
    // names them too: a search can return a photo of somebody else from the same event.
    const names = namesOf(query);
    for (const c of found) {
      if (describes(c.alt, block)) continue;
      // The name in the file's own title. A title that names nobody (a camera's "IMG_2041.jpg") may be named by its
      // description or categories; a title that names someone else may not: a photo titled for Mitsuyo Maeda, filed
      // under a category of Hélio Gracie, went on a Hélio Gracie cover.
      if (names.length && !namesIn(String(c.providerId || ''), names) && (titleNamesSomeone(c.providerId) || !namesIn(`${c.alt || ''} ${c.categories || ''}`, names))) continue;
      if (!c.license) continue;
      let bytes;
      try {
        bytes = c.file ? { buf: readFileSync(c.file), type: /\.png$/i.test(c.file) ? 'image/png' : 'image/jpeg' } : await getBytes(c.url);
      } catch {
        continue;
      }
      // The screen: a picture with blood, an injury, a fighter down, a watermark, a belt or a weapon is never used.
      const screen = await screenImage(ctx, { pack, buf: bytes.buf, type: bytes.type, meta: `${c.providerId || ''} ${c.alt || ''} ${c.categories || ''}`, postId, query, claim });
      if (screen.safety === 'refused') {
        ctx.log?.(`image refused (${screen.why}): ${c.providerId}`);
        continue;
      }
      const match = { title: Boolean(names.length), model: screen.model ? { consistent: screen.model.consistent, mainSubject: screen.model.mainSubject } : null, claim: claim ? claim.slice(0, 200) : null };
      if (c.track) getJson(c.track, { headers: { authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }).catch(() => {});
      const hash = createHash('sha256').update(bytes.buf).digest('hex');
      const dir = ensureDir(path.join(mediaDir(), 'images'));
      const file = path.join(dir, `${hash.slice(0, 24)}.${bytes.type === 'image/png' ? 'png' : 'jpg'}`);
      writeFileSync(file, bytes.buf);
      const id = ctx.db.insert('images', {
        provider: c.provider, provider_id: c.providerId, license: c.license, license_url: c.licenseUrl, author: c.author, author_url: c.authorUrl,
        source_url: c.sourceUrl, alt: c.alt, query, ai_generated: 0, realistic: 0, file, sha256: hash, created_at: nowIso(),
        safety: screen.safety, safety_json: screen, match_json: match, categories: c.categories || null,
      });
      return ctx.db.get('SELECT * FROM images WHERE id = ?', id);
    }
  }
  return null;
}
