import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getJson, getText } from '../core/net.js';
import { nowIso } from '../core/clock.js';
import { j } from '../db/index.js';
import { parseFeed } from './rss.js';
import { htmlToText, mainHtml, titleOf } from './text.js';

// Sources, behind one interface: read(source) -> [{ url, title, text, publishedAt, key? }].
//
//   rss   a feed; short items are completed from their own page
//   web   one page, narrowed to its main content (hints.selector), optionally
//         following links from an index page (hints.follow)
//   api   structured data: Wikidata SPARQL, or any JSON endpoint turned into
//         lines of "field: value" (hints.fields)
//
// The recorded implementation reads <pack>/recordings/documents/*.json instead,
// so the pipeline runs offline on documents that were really fetched once.
//
// Every document is stored with its full text and a hash. That stored text is
// what every quote is checked against, then and later, so a post can be
// re-verified after the page has changed.

const MAX_TEXT = 16_000;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

export function liveSources() {
  return {
    kind: 'live',
    async read(src) {
      const cfg = j(src.config_json, {}) || {};
      const hints = cfg.hints || {};
      if (src.type === 'rss') {
        const { body } = await getText(src.url, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8' });
        const items = parseFeed(body).slice(0, hints.max || 6);
        const out = [];
        for (const it of items) {
          let text = it.text;
          if (text.length < (hints.minFeedChars || 800) && hints.fetchItems !== false) {
            try {
              const page = await getText(it.url);
              text = htmlToText(mainHtml(page.body, hints.selector));
            } catch {
              /* the feed's own text stands */
            }
          }
          out.push({ ...it, text: text.slice(0, MAX_TEXT) });
        }
        return out;
      }
      if (src.type === 'web') {
        const page = await getText(src.url);
        const docs = [{ url: page.finalUrl, title: titleOf(page.body), text: htmlToText(mainHtml(page.body, hints.selector)).slice(0, MAX_TEXT), publishedAt: null }];
        if (hints.follow?.pattern) {
          const re = new RegExp(hints.follow.pattern, 'i');
          const links = [...new Set([...page.body.matchAll(/href=["']([^"']+)["']/gi)].map((m) => new URL(m[1], page.finalUrl).href).filter((u) => re.test(u)))];
          for (const url of links.slice(0, hints.follow.max || 5)) {
            try {
              const p = await getText(url);
              docs.push({ url: p.finalUrl, title: titleOf(p.body), text: htmlToText(mainHtml(p.body, hints.selector)).slice(0, MAX_TEXT), publishedAt: null });
            } catch {
              /* one dead link is not a dead source */
            }
          }
        }
        return docs;
      }
      if (src.type === 'api') return fetchApi(src, cfg);
      throw new Error(`unknown source type ${src.type}`);
    },
  };
}

async function fetchApi(src, cfg) {
  const api = cfg.api || {};
  if (api.kind === 'wikidata-sparql') {
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(api.query)}`;
    const body = await getJson(url, { headers: { accept: 'application/sparql-results+json' } });
    const vars = body?.head?.vars || [];
    const lines = (body?.results?.bindings || []).map((b) => vars.map((v) => `${v}: ${b[v]?.value ?? ''}`).join(' | '));
    return [{ url: src.url, title: api.title || src.name, text: lines.join('\n').slice(0, MAX_TEXT), publishedAt: null }];
  }
  // A JSON endpoint: each record becomes one line of "field: value", which keeps
  // the numbers quotable verbatim.
  const body = await getJson(api.url || src.url);
  const records = api.path ? api.path.split('.').reduce((o, k) => o?.[k], body) : body;
  const list = Array.isArray(records) ? records : [records];
  const fields = api.fields || Object.keys(list[0] || {});
  const lines = list.slice(0, api.max || 200).map((r) => fields.map((f) => `${f}: ${f.split('.').reduce((o, k) => o?.[k], r) ?? ''}`).join(' | '));
  return [{ url: src.url, title: api.title || src.name, text: lines.join('\n').slice(0, MAX_TEXT), publishedAt: null }];
}

/** Documents recorded for a pack: <pack>/recordings/documents/<key>.json with { source, url, title, text, ... }. */
export function recordedSources(pack) {
  const dir = path.join(pack.recordingsDir, 'documents');
  let all = null;
  const load = () => {
    all ??= existsSync(dir)
      ? readdirSync(dir)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((f) => ({ key: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(path.join(dir, f), 'utf8')) }))
      : [];
    return all;
  };
  return {
    kind: 'recorded',
    async read(src) {
      return load()
        .filter((d) => d.source === src.key)
        .map((d) => ({ key: d.key, url: d.url, title: d.title, text: d.text, publishedAt: d.publishedAt || null, fetchedAt: d.fetchedAt || null }));
    },
  };
}

/**
 * Fetch one source and store what came back. Returns the stored rows. A source
 * that fails records its error and returns [] rather than failing the run: one
 * dead feed is not a dead account.
 */
export async function refreshSource(db, impl, src) {
  let docs;
  try {
    docs = await impl.read(src);
    db.update('sources', src.id, { last_ok_at: nowIso(), last_error: null });
  } catch (e) {
    db.update('sources', src.id, { last_error: String(e.message).slice(0, 300) });
    return [];
  }
  const out = [];
  for (const d of docs) {
    const text = String(d.text || '').trim();
    if (text.length < 80) continue;
    const hash = sha(text);
    let row = db.get('SELECT * FROM documents WHERE source_id = ? AND sha256 = ?', src.id, hash);
    if (!row) {
      const id = db.insert('documents', {
        source_id: src.id,
        key: d.key || null,
        url: d.url,
        title: d.title || null,
        text,
        sha256: hash,
        published_at: d.publishedAt || null,
        fetched_at: d.fetchedAt || nowIso(),
        recorded: impl.kind === 'recorded' ? 1 : 0,
      });
      row = db.get('SELECT * FROM documents WHERE id = ?', id);
    }
    out.push(row);
  }
  return out;
}
