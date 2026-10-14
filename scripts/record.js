#!/usr/bin/env node
// npm run record -- --pack <id> [--source <id>] [--max 3]
// npm run record -- --pack <id> --source <id> --url <page> --key <name>
// npm run record -- --pack <id> --source <id> --title "<article>" [--title "<another>"] [--section "<heading>"] [--mode parse] --key <name>
//
// Fetches a pack's approved sources through the engine's own source readers and
// saves what came back as recordings, so the pack runs offline afterwards:
// <pack>/recordings/documents/<key>.json. Only sources listed in the pack's
// sources.json can be recorded, and --url must be on one of their hosts: a
// recording is a snapshot of an approved source, never of anything else.
//
// --title records named articles of a Wikipedia source (api.kind "wikipedia"),
// through the MediaWiki API ("Title#Section" or "Title#intro;Section" for parts of
// it); two or more titles are recorded as one group (<key>-1, <key>-2...), which a
// post reads together, as a head-to-head reads two players' articles.
//
// --group <key> files whatever this call records under a group too, so documents
// from different sources (an article and a registrar's line) are read together.
// --filter '<json>' narrows a data.gov.il (CKAN) source to the records asked for.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/core/env.js';
import { ensureDir } from '../src/core/paths.js';
import { getText } from '../src/core/net.js';
import { loadPack, resolvePackDir } from '../src/packs/load.js';
import { liveSources, wikipediaDocs } from '../src/sources/index.js';
import { htmlToText, mainHtml, titleOf } from '../src/sources/text.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));
const pack = loadPack(resolvePackDir(opt('pack')) || process.exit(console.error('no such pack'), 1));
const dir = ensureDir(path.join(pack.recordingsDir, 'documents'));
// Short keys: a recording's key is also a file name, and Windows paths have a limit.
const slug = (s) => String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const save = (key, doc) => {
  if (opt('group')) doc = { ...doc, group: opt('group') };
  writeFileSync(path.join(dir, `${key}.json`), `${JSON.stringify({ ...doc, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`saved ${key}: ${doc.title?.slice(0, 70)} (${doc.text.length} chars)${doc.group ? ` [group ${doc.group}]` : ''}`);
};

const sources = (pack.sources.sources || []).filter((s) => !opt('source') || s.id === opt('source'));
if (!sources.length) {
  console.error('no matching source in sources.json');
  process.exit(1);
}

if (all('title').length) {
  const src = sources[0];
  if (src.api?.kind !== 'wikipedia') {
    console.error(`${src.id} is not a Wikipedia source (api.kind "wikipedia")`);
    process.exit(1);
  }
  const titles = all('title');
  const key = opt('key') || slug(titles.join(' '));
  const docs = await wikipediaDocs({ ...src, key: src.id }, { ...src.api, titles, sections: all('section').length ? all('section') : src.api.sections, mode: opt('mode', src.api.mode), group: titles.length > 1 });
  if (docs.length !== titles.length) console.log(`(${titles.length - docs.length} article(s) came back empty)`);
  docs.forEach((d, i) => save(docs.length > 1 ? `${key}-${i + 1}` : key, { source: src.id, url: d.url, title: d.title, text: d.text, ...(docs.length > 1 ? { group: key } : {}) }));
} else if (opt('url')) {
  const src = sources[0];
  const url = opt('url');
  if (new URL(url).hostname !== new URL(src.url).hostname) {
    console.error(`${url} is not on ${src.id}'s host (${new URL(src.url).hostname})`);
    process.exit(1);
  }
  const page = await getText(url);
  save(opt('key') || slug(url), { source: src.id, url: page.finalUrl, title: titleOf(page.body), text: htmlToText(mainHtml(page.body, src.hints?.selector)).slice(0, 16000) });
} else {
  const live = liveSources();
  for (const s of sources) {
    try {
      const api = s.api && opt('filter') ? { ...s.api, filters: JSON.parse(opt('filter')) } : s.api || null;
      const docs = await live.read({ ...s, key: s.id, config_json: JSON.stringify({ api, hints: s.hints || null }) }, { day: opt('day') });
      // One document (an API, one page): the source's own id, or --key. Several (a feed): the id and a short slug of each URL.
      const kept = docs.slice(0, Number(opt('max', 3)));
      for (const d of kept) save(kept.length === 1 ? opt('key') || s.id : `${opt('key') || s.id}--${slug(new URL(d.url).pathname.split('/').filter(Boolean).pop() || d.url).slice(0, 24)}`, { source: s.id, url: d.url, title: d.title, text: d.text, publishedAt: d.publishedAt || null, ...(d.group ? { group: d.group } : {}) });
    } catch (e) {
      console.log(`${s.id}: ${e.message}`);
    }
  }
}
