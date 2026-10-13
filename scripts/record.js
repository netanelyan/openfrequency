#!/usr/bin/env node
// npm run record -- --pack <id> [--source <id>] [--url <page> --key <name>] [--max 3]
//
// Fetches a pack's approved sources through the engine's own source readers and
// saves what came back as recordings, so the pack runs offline afterwards:
// <pack>/recordings/documents/<key>.json. Only sources listed in the pack's
// sources.json can be recorded, and --url must be on one of their hosts: a
// recording is a snapshot of an approved source, never of anything else.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../src/core/env.js';
import { ensureDir } from '../src/core/paths.js';
import { getText } from '../src/core/net.js';
import { loadPack, resolvePackDir } from '../src/packs/load.js';
import { liveSources } from '../src/sources/index.js';
import { htmlToText, mainHtml, titleOf } from '../src/sources/text.js';

loadEnv();
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const pack = loadPack(resolvePackDir(opt('pack')) || process.exit(console.error('no such pack'), 1));
const dir = ensureDir(path.join(pack.recordingsDir, 'documents'));
const slug = (s) => String(s).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const save = (key, doc) => {
  writeFileSync(path.join(dir, `${key}.json`), `${JSON.stringify({ ...doc, fetchedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`saved ${key}: ${doc.title?.slice(0, 70)} (${doc.text.length} chars)`);
};

const sources = (pack.sources.sources || []).filter((s) => !opt('source') || s.id === opt('source'));
if (!sources.length) {
  console.error('no matching source in sources.json');
  process.exit(1);
}

if (opt('url')) {
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
      const docs = await live.read({ ...s, key: s.id, config_json: JSON.stringify({ api: s.api || null, hints: s.hints || null }) });
      // One document (an API, one page): the source's own id. Several (a feed): the id and a short slug of each URL.
      const kept = docs.slice(0, Number(opt('max', 3)));
      for (const d of kept) save(kept.length === 1 ? s.id : `${s.id}--${slug(d.url).slice(-24)}`, { source: s.id, url: d.url, title: d.title, text: d.text, publishedAt: d.publishedAt || null });
    } catch (e) {
      console.log(`${s.id}: ${e.message}`);
    }
  }
}
