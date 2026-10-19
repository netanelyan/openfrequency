import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll, loadPack } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost, loadPost } from '../src/pipeline/build.js';
import { lockStyle, lockedStyle, styleByHash, styleHash } from '../src/render/style.js';
import { closeBrowser, renderPost } from '../src/render/render.js';
import { tokenOf } from '../src/verify/claims.js';
import { copyPack, keepOnly, opened, tempHome } from './helpers.js';

// An account's look is saved the first time it renders, and every post is drawn in the saved one: a change to
// theme.json waits for the owner, a post is drawn again in the look it went out in, and inside one post the slides
// share one ground and one type size.

after(() => closeBrowser());

const theme = (over = {}) => ({ template: 'editorial', variant: 'a', colors: { bg: '#EEF1E4', ink: '#1F2A1B' }, fonts: { display: 'Suez One', text: 'Varela Round' }, options: { radius: 30 }, ...over });

test('the look is saved on first use, a change to theme.json waits for the owner, and applying it saves the new one', () => {
  const db = new Db(':memory:');
  const pack = { id: 'a', theme: theme() };
  const first = lockedStyle(db, pack);
  assert.equal(first.hash, styleHash(pack.theme));
  assert.equal(first.pending, null);
  assert.equal(styleHash({ options: { radius: 30 }, variant: 'a', template: 'editorial', fonts: pack.theme.fonts, colors: pack.theme.colors }), first.hash, 'key order does not change a look');
  pack.theme = theme({ colors: { bg: '#000000', ink: '#FFFFFF' } });
  const after = lockedStyle(db, pack);
  assert.equal(after.hash, first.hash, 'the saved look is still the one drawn');
  assert.equal(after.theme.colors.bg, '#EEF1E4');
  assert.equal(after.pending, styleHash(pack.theme), 'and the change waits');
  lockStyle(db, pack);
  const applied = lockedStyle(db, pack);
  assert.equal(applied.theme.colors.bg, '#000000');
  assert.equal(applied.pending, null);
  assert.equal(styleByHash(db, pack, first.hash).theme.colors.bg, '#EEF1E4', 'a post drawn in the old look is drawn in it again');
  assert.equal(styleByHash(db, pack, 'nope'), null);
});

test('hard rule 2 comes first: a saved look another account now draws is given up for theme.json', () => {
  const db = new Db(':memory:');
  const a = { id: 'a', theme: theme() };
  lockedStyle(db, a);
  a.theme = theme({ template: 'poster' });
  const b = { id: 'b', theme: theme() };
  const lock = lockedStyle(db, a, [a, b]);
  assert.equal(lock.theme.template, 'poster', 'b uses editorial/a now, so a draws its own new look');
  assert.equal(lock.pending, null);
});

test('a post is drawn in the saved look and keeps its hash; a change to theme.json is not drawn until applied', async () => {
  const { home, cleanup } = tempHome();
  try {
    keepOnly(path.join(home, 'packs', 'demo'), ['basil-containers']);
    const db = new Db(path.join(home, 'data.db'));
    opened.push(db);
    const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
    ctx.mediaDir = path.join(home, 'media');
    const saved = lockedStyle(db, ctx.pack('demo'), ctx.packs);
    ctx.pack('demo').theme.colors.accent = '#123456';
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'queued', res.reason);
    assert.equal(loadPost(db, res.postId).checks.style, saved.hash, 'drawn in the saved look, not the edited file');
    assert.ok(lockedStyle(db, ctx.pack('demo'), ctx.packs).pending, 'the Accounts page has a change to apply');
  } finally {
    cleanup();
  }
});

test("a post's content slides come out at one type size, and its slides share one ground", { timeout: 240_000 }, async () => {
  const { home, cleanup } = tempHome();
  try {
    const dir = copyPack(home, 'demo', (f) => {
      f.theme.options = { ...f.theme.options, backgroundPhoto: true };
      f.theme.backgroundQueries = ['house plants'];
    });
    const pack = loadPack(dir);
    const beat = (title, body) => ({ kind: 'item', role: 'beat', title, body, factKeys: [], sources: ['מקור'] });
    const long = 'בזיליקום שגדל במרפסת פתוחה לדרום צריך השקיה כל בוקר בקיץ, ובימי שרב גם בערב, אחרת העלים נובלים עד הצהריים ולא חוזרים.';
    const slides = [
      { kind: 'cover', role: 'cover', title: '', body: '', factKeys: [] },
      beat('שמש', 'שש שעות ביום.'),
      beat('השקיה בימים חמים במיוחד של הקיץ הישראלי', `${long}\n${long}`),
      { ...beat('סוף', 'זהו.'), role: 'payoff' },
    ];
    const extra = { captionIg: '', keywords: [], subject: {}, cta: '' };
    const post = { id: 'even', hook: 'שער', sub: '', caption: 'c', extra };
    post.token = tokenOf({ slides, caption: post.caption, hook: post.hook, sub: post.sub, extra });
    const files = await renderPost({ pack, format: { id: 't', kind: 'story', name: 'x', hooks: ['x'] }, post, slides, outDir: path.join(home, 'media', 'even') });
    // The long slide is set smaller on Instagram's shorter frame, and the short ones are drawn again at its size.
    const content = (size) => files.scales[size].slice(1);
    assert.ok(Math.min(...content('instagram')) < 1, `the long slide had to shrink: ${content('instagram').join(', ')}`);
    for (const size of pack.meta.platforms) {
      const c = content(size);
      assert.ok(Math.max(...c) - Math.min(...c) <= 0.03, `${size}: one size for every content slide (${c.join(', ')})`);
    }
  } finally {
    cleanup();
  }
});
