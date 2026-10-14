import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getJson } from '../core/net.js';
import { nowIso } from '../core/clock.js';
import { j } from '../db/index.js';
import { htmlToText } from './text.js';
import { wikipediaDocs } from './index.js';

// Research: more documents about one topic, read before a post is drafted.
//
// A post drafted from one document tells what everyone knows. The details a fan
// keeps (who said what, the minute, the moment, what came before, what people said
// after) are in the article about the match, the fight or the launch itself, not
// in the list the topic came from. The outline names those articles (its
// `research` terms); this module finds and stores them, so every detail drafted
// from them is checked against its stored text like any other fact.
//
// It reads only through the pack's own approved sources: a term is searched in
// the Wikipedia of an approved Wikipedia source (in that source's language), and
// in Hacker News when the pack has an approved Hacker News source. Each document
// found is stored under that source, so the slide's source line and the fact's
// trace lead back to an approved source like everything else.
//
// Offline, research reads <pack>/recordings/research/<document key>.json
// ({ docs: [{ url, title, text }] }) or finds nothing.

const MAX_DOC = 9000;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const HEBREW = /[֐-׿]/;

/** The approved sources research may read through, by kind. */
export function researchSources(db, pack) {
  const rows = db.all("SELECT * FROM sources WHERE account_id = ? AND status = 'approved' ORDER BY id", pack.id);
  const wiki = {};
  let hn = null;
  for (const r of rows) {
    const api = j(r.config_json, {})?.api || {};
    if (api.kind === 'wikipedia') wiki[api.lang || r.lang || 'en'] ??= r;
    if (api.kind === 'hn') hn ??= r;
  }
  return { wiki, hn };
}

/**
 * The part of a long text about the subject: its paragraphs that name the
 * subject or hold a number or a quotation, best first, put back in the text's own
 * order, up to maxChars.
 */
export function aboutSubject(text, names = [], maxChars = MAX_DOC) {
  const paras = String(text || '').split(/\n{1,}/).map((p) => p.trim()).filter((p) => p.length > 30);
  const words = names.map((n) => String(n).toLowerCase()).filter((n) => n.length >= 3);
  const score = (p) => {
    const t = p.toLowerCase();
    return words.filter((w) => t.includes(w)).length * 3 + (/\d/.test(p) ? 1 : 0) + (/["“”«»]/.test(p) ? 2 : 0) + (/^==/.test(p) ? -5 : 0);
  };
  const ranked = paras.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const keep = new Set();
  let size = 0;
  for (const r of ranked) {
    if (size + r.p.length + 1 > maxChars) continue;
    keep.add(r.i);
    size += r.p.length + 1;
  }
  return paras.filter((_, i) => keep.has(i)).join('\n');
}

/** Store a research document under its source, as refreshSource stores any document. */
function store(db, src, d, recorded = false) {
  const text = String(d.text || '').trim();
  if (text.length < 200) return null;
  const hash = sha(text);
  const have = db.get('SELECT * FROM documents WHERE source_id = ? AND sha256 = ?', src.id, hash);
  if (have) return have;
  const id = db.insert('documents', { source_id: src.id, key: d.key || null, url: d.url, title: d.title || null, text, sha256: hash, published_at: d.publishedAt || null, fetched_at: nowIso(), recorded: recorded ? 1 : 0 });
  return db.get('SELECT * FROM documents WHERE id = ?', id);
}

/** A Wikipedia title for a search term, through the search API of that language. */
async function wikiTitle(lang, term) {
  const q = new URLSearchParams({ action: 'query', list: 'search', srsearch: term, srlimit: '1', srnamespace: '0', format: 'json', formatversion: '2' });
  const body = await getJson(`https://${lang}.wikipedia.org/w/api.php?${q}`);
  return body?.query?.search?.[0]?.title || null;
}

/** Show HN posts for a term, through the Algolia HN Search API: the founder's own text, with its points and date. */
export async function hnDocs(term, { max = 2 } = {}) {
  const q = new URLSearchParams({ query: term, tags: 'show_hn', hitsPerPage: String(max) });
  const body = await getJson(`https://hn.algolia.com/api/v1/search?${q}`);
  return (body?.hits || [])
    .filter((h) => h.story_text || h.title)
    .map((h) => ({
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: `${h.title} (Hacker News)`,
      text: [h.title, htmlToText(h.story_text || ''), `points: ${h.points ?? ''} | comments: ${h.num_comments ?? ''} | posted: ${String(h.created_at || '').slice(0, 10)}`].filter(Boolean).join('\n'),
      publishedAt: h.created_at || null,
    }));
}

/**
 * The research documents for one topic: up to `max` new documents, stored, each
 * narrowed to the part about the subject. `have` holds the urls of the documents
 * the post already has. Returns [{ ...document row, text narrowed }].
 */
export async function research(ctx, { pack, terms = [], names = [], have = [], max = 3, docKey = null }) {
  const { db } = ctx;
  const srcs = researchSources(db, pack);
  const seen = new Set(have.map((u) => String(u).toLowerCase()));
  const out = [];
  const keep = (row) => {
    if (!row || seen.has(String(row.url).toLowerCase())) return;
    seen.add(String(row.url).toLowerCase());
    out.push({ ...row, text: aboutSubject(row.text, names) });
  };
  if (ctx.mode === 'recorded') {
    const file = docKey ? path.join(pack.recordingsDir, 'research', `${docKey}.json`) : null;
    const src = Object.values(srcs.wiki)[0] || srcs.hn;
    if (!file || !src || !existsSync(file)) return out;
    for (const d of JSON.parse(readFileSync(file, 'utf8')).docs || []) if (out.length < max) keep(store(db, src, d, true));
    return out;
  }
  for (const term of terms.slice(0, 4)) {
    if (out.length >= max) break;
    const lang = HEBREW.test(term) && srcs.wiki.he ? 'he' : srcs.wiki.en ? 'en' : Object.keys(srcs.wiki)[0];
    try {
      if (lang) {
        const title = await wikiTitle(lang, term);
        if (title) {
          const src = srcs.wiki[lang];
          const [doc] = await wikipediaDocs(src, { kind: 'wikipedia', lang, titles: [title] });
          if (doc) keep(store(db, src, doc));
        }
      }
      if (srcs.hn && out.length < max) for (const d of await hnDocs(term)) keep(store(db, srcs.hn, d));
    } catch (e) {
      ctx.log?.(`research "${term}": ${e.message}`);
    }
  }
  return out;
}
