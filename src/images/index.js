import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { isSet } from '../core/env.js';
import { getBytes, getJson } from '../core/net.js';
import { nowIso } from '../core/clock.js';
import { ensureDir, mediaDir } from '../core/paths.js';
import { record } from '../budget/ledger.js';
import { blockedQuery } from '../rules/check.js';

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
const describes = (text, words) => {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, ' ')} `;
  return words.find((w) => t.includes(` ${String(w).toLowerCase()} `)) || null;
};

const commons = {
  id: 'commons',
  ready: () => true,
  async search(query, { n = 12 } = {}) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(n),
      prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', iiurlwidth: '1440',
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
          height: ii?.thumbheight || ii?.height,
          license: plain(md.LicenseShortName?.value),
          licenseUrl: md.LicenseUrl?.value || null,
          author: plain(md.Artist?.value) || null,
          authorUrl: null,
          sourceUrl: ii?.descriptionurl || null,
          alt: `${p.title} ${plain(md.ImageDescription?.value)}`.slice(0, 400),
          mime: ii?.mime,
        };
      })
      // A license that requires attribution is usable only with a name to attribute.
      .filter((c) => c.url && /^image\/(jpeg|png|webp)$/.test(c.mime || '') && commonsLicenseOk(c.license) && (c.author || !needsCredit(c.license)));
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

export const PROVIDERS = { pexels, unsplash, commons };

/** CC BY and CC BY-SA require the author and the license next to the picture. */
export const needsCredit = (license) => /\bby\b|attribution/i.test(String(license || ''));

const PROVIDER_NAME = { commons: 'Wikimedia Commons', pexels: 'Pexels', unsplash: 'Unsplash' };

/**
 * The credit line a post's caption carries when its photo's license asks for one,
 * or ''. It is added when the caption is published, after the checks: a license
 * name ("CC BY-SA 4.0") is not a claim, and its numbers are not facts.
 */
export function imageCredit(db, post) {
  const id = (post.slides || []).find((s) => s.image_id)?.image_id;
  const img = id ? db.get('SELECT provider, license, author FROM images WHERE id = ?', id) : null;
  if (!img || !needsCredit(img.license)) return '';
  return `צילום: ${img.author} · ${img.license} · ${PROVIDER_NAME[img.provider] || img.provider}`;
}

/**
 * One licensed photograph for a query, stored with its licence, or null.
 * `mode` 'recorded' never touches the network and returns null: offline runs
 * render the theme's own ground instead of a photograph.
 */
export async function findImage(ctx, { pack, query, postId = null }) {
  if (!query || ctx.mode === 'recorded') return null;
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
      found = await prov.search(query);
      record(ctx.db, { accountId: pack.id, postId, api: prov.id, usd: 0, tag: 'image-search' });
    } catch (e) {
      ctx.log?.(`${prov.id}: ${e.message}`);
      continue;
    }
    for (const c of found) {
      if (describes(c.alt, block)) continue;
      if (!c.license) continue;
      let bytes;
      try {
        bytes = await getBytes(c.url);
      } catch {
        continue;
      }
      if (c.track) getJson(c.track, { headers: { authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` } }).catch(() => {});
      const hash = createHash('sha256').update(bytes.buf).digest('hex');
      const dir = ensureDir(path.join(mediaDir(), 'images'));
      const file = path.join(dir, `${hash.slice(0, 24)}.${bytes.type === 'image/png' ? 'png' : 'jpg'}`);
      writeFileSync(file, bytes.buf);
      const id = ctx.db.insert('images', {
        provider: c.provider, provider_id: c.providerId, license: c.license, license_url: c.licenseUrl, author: c.author, author_url: c.authorUrl,
        source_url: c.sourceUrl, alt: c.alt, query, ai_generated: 0, realistic: 0, file, sha256: hash, created_at: nowIso(),
      });
      return ctx.db.get('SELECT * FROM images WHERE id = ?', id);
    }
  }
  return null;
}
