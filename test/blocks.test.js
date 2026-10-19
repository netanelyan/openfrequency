import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.js';
import { checkOf } from '../src/pipeline/build.js';
import { blockRates } from '../src/web/data.js';
import { blocksPanel } from '../src/web/pages.js';

// Results says which checks stop posts: each block counted under the checks that stopped it, and each first draft
// under the checks it failed, so the rule that fails most is plain to see.

test('a problem is counted under its check, whatever its wording', () => {
  assert.equal(checkOf({ where: 'facts', code: 'verify', msg: 'slide 2: the number 7 is not in a quote' }), 'facts');
  assert.equal(checkOf({ where: 'visual', code: 'shape', msg: 'only 1 of 4' }), 'visuals');
  assert.equal(checkOf({ where: 'details', code: 'shape', msg: 'the slides use 1 of the details' }), 'details');
  assert.equal(checkOf({ where: 'shape', code: 'shape', msg: 'roles in order' }), 'shape');
  assert.equal(checkOf({ where: 'caption', code: 'caption', msg: 'too short' }), 'caption');
  assert.equal(checkOf({ where: 'cover', code: 'voice:phrase', msg: 'stock phrase' }), 'voice:phrase');
  assert.equal(checkOf({ where: 'cover', code: 'compliance:gambling', msg: 'x' }), 'compliance:gambling');
});

test('the block rate per check: blocked posts by their checks, first drafts by theirs, older blocks by their kind', () => {
  const db = new Db(':memory:');
  const t = Date.parse('2026-10-19T12:00:00Z');
  const at = '2026-10-18T10:00:00Z';
  db.insert('accounts', { id: 'a', display_name: 'a', handle: 'a', created_at: at, updated_at: at });
  const post = (id, status, steps, created = at) => {
    db.insert('posts', { id, account_id: 'a', status, created_at: created, updated_at: created });
    for (const [step, detail] of steps) db.insert('steps', { post_id: id, step, status: step === 'blocked' ? 'failed' : 'ok', detail_json: JSON.stringify(detail), at: created });
  };
  post('p1', 'blocked', [['slides', { checks: ['facts', 'caption'] }], ['blocked', { kind: 'fact_check', checks: ['facts'] }]]);
  post('p2', 'blocked', [['slides', { checks: ['facts'] }], ['blocked', { kind: 'fact_check', checks: ['facts', 'shape'] }]]);
  post('p3', 'queued', [['slides', { checks: ['caption'] }]]);
  post('p4', 'blocked', [['blocked', { kind: 'no_source' }]], at);
  post('p5', 'queued', [['slides', { checks: [] }]]);
  post('old', 'blocked', [['blocked', { kind: 'voice' }]], '2026-08-01T10:00:00Z');
  post('s', 'sample', [['blocked', { kind: 'voice' }]]);
  db.run("UPDATE posts SET sample = 1 WHERE id = 's'");
  const b = blockRates({ db }, t);
  assert.equal(b.total, 5, 'the last 30 days, samples left out');
  assert.equal(b.blocked, 3);
  const by = Object.fromEntries(b.rows.map((r) => [r.check, r]));
  assert.deepEqual(by.facts, { check: 'facts', blocked: 2, firstFail: 2 });
  assert.deepEqual(by.caption, { check: 'caption', blocked: 0, firstFail: 2 }, 'a caption the repair fixed failed the first draft and blocked nothing');
  assert.equal(by.shape.blocked, 1);
  assert.equal(by['kind:no_source'].blocked, 1);
  assert.equal(b.rows[0].check, 'facts', 'the check that blocks most comes first');
  const html = blocksPanel(b);
  assert.match(html, /3 מתוך 5 פוסטים נחסמו \(60%\)/);
  assert.match(html, /שער העובדות: מספר שלא בציטוט<\/td><td class="n" data-k="חסמה">2<\/td><td class="n" data-k="מהפוסטים">40%/);
  assert.match(html, /אין מסמך שמחזיק פוסט/);
  assert.equal(blocksPanel({ total: 0, blocked: 0, rows: [] }), '');
});
