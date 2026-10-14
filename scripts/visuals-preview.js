#!/usr/bin/env node
// npm run visuals -- [--pack <id>] [--out <dir>]
//
// Every graphic type the engine draws, rendered in a pack's theme for TikTok and
// Instagram, with Hebrew and Latin mixed, numbers, ranges and long labels: for
// the eye, after a change to src/render/visuals.js. Without --pack, the demo
// pack. The slides go to <out> (default: $OF_HOME/data/out/visuals/<pack>/).

import path from 'node:path';
const { loadPack, resolvePackDir } = await import('../src/packs/load.js');
const { outDir } = await import('../src/core/paths.js');
const { page } = await import('../src/render/html.js');
const { buildSlide } = await import('../src/render/templates/index.js');
const { renderHtml, closeBrowser } = await import('../src/render/render.js');
const { VISUAL_TYPES } = await import('../src/render/visuals.js');
const { SAMPLE_VISUALS } = await import('../src/render/samples.js');

const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const pack = loadPack(resolvePackDir(opt('pack', 'demo')));
const dir = opt('out', path.join(outDir(), 'visuals', pack.id));
const base = { kind: 'item', handle: pack.meta.handle, displayName: pack.meta.displayName, postKind: 'story', subject: {}, keywords: [], pos: 2, total: 6, n: 2, of: 6, sources: ['ויקיפדיה: 2005 UEFA Champions League Final'] };
let n = 0;
for (const type of VISUAL_TYPES) {
  const v = SAMPLE_VISUALS[type];
  for (const size of pack.meta.platforms) {
    const slide = { ...base, role: 'beat', title: v.slideTitle, body: v.slideBody, visual: v.visual, hasVisual: true };
    const html = page({ theme: pack.theme, size, slide, parts: buildSlide(pack.theme, slide) });
    const file = path.join(dir, `${type}-${size}.jpg`);
    await renderHtml(html, { size, file });
    n++;
  }
}
// The covers: a kind's own art, and a cover graphic.
for (const [postKind, extra] of Object.entries({ iceberg: {}, ranking: {}, 'guess-who': {}, 'hot-take': {}, 'head-to-head': { subject: { a: 'מסי', b: 'Cristiano Ronaldo' } }, 'myth-fact': {}, 'what-happened': {}, story: { coverVisual: SAMPLE_VISUALS.stat.visual }, 'on-this-day': { subject: { date: '25 במאי 2005' } }, meme: {} })) {
  for (const size of pack.meta.platforms) {
    const slide = { ...base, kind: 'cover', role: 'cover', postKind, hook: 'הלילה שבו ליברפול חזרה מ-3–0 באיסטנבול', sub: '', subject: {}, ...extra };
    const html = page({ theme: pack.theme, size, slide, parts: buildSlide(pack.theme, slide) });
    await renderHtml(html, { size, file: path.join(dir, `cover-${postKind}-${size}.jpg`) });
    n++;
  }
}
await closeBrowser();
console.log(`${n} slides in ${dir}`);
