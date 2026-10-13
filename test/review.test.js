import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { loadAll } from '../src/packs/load.js';
import { makeContext } from '../src/engine.js';
import { buildPost, loadPost } from '../src/pipeline/build.js';
import { recordedClient } from '../src/llm/recorded.js';
import { closeBrowser } from '../src/render/render.js';
import { keepOnly, opened, tempHome } from './helpers.js';

// The second model reads the post as a skeptical Israeli would, scores each text
// 0 (person) to 10 (bot), and rewrites anything at 4 or more. A rewrite replaces
// the original only if it passes every check the original had to pass.

after(() => closeBrowser());

function withReviewer(home, review) {
  const db = new Db(path.join(home, 'data.db'));
  opened.push(db);
  const ctx = makeContext({ db, packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
  ctx.mediaDir = path.join(home, 'media');
  const recorded = recordedClient();
  // Drafting answers from the recordings; the review answers as a live reviewer would.
  ctx.llm = { kind: 'claude', json: async (req) => (req.task === 'review' ? { data: review(req), usage: { input_tokens: 3000, output_tokens: 600 }, model: req.model } : recorded.json(req)) };
  return ctx;
}

test('a text scored 4 or more is rewritten, and the rewrite is kept when it passes every check', async () => {
  const { home, cleanup } = tempHome();
  try {
    keepOnly(path.join(home, 'packs', 'demo'), ['basil-containers']);
    const ctx = withReviewer(home, () => ({ reviews: [{ index: 0, botScore: 7, tells: ['too polished'], factProblem: '', rewrite: 'בזיליקום במרפסת: 5 דברים שהוא צריך מכם' }] }));
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'queued', res.reason);
    const post = loadPost(ctx.db, res.postId);
    assert.equal(post.hook, 'בזיליקום במרפסת: 5 דברים שהוא צריך מכם');
    assert.equal(post.checks.rewrites.length, 1);
    assert.equal(post.checks.reviewer, 'claude');
  } finally {
    cleanup();
  }
});

test('a rewrite that invents a number is thrown away, and a text still scored 6 blocks the post', async () => {
  const { home, cleanup } = tempHome();
  try {
    keepOnly(path.join(home, 'packs', 'demo'), ['basil-containers']);
    const ctx = withReviewer(home, () => ({ reviews: [{ index: 0, botScore: 7, tells: ['brochure tone'], factProblem: '', rewrite: 'בזיליקום במרפסת: 9 דברים שהוא צריך מכם' }] }));
    const res = await buildPost(ctx, { pack: ctx.pack('demo'), formatKey: 'care-guide' });
    assert.equal(res.status, 'blocked');
    assert.equal(res.kind, 'voice');
    assert.match(res.reason, /בוט/);
  } finally {
    cleanup();
  }
});
