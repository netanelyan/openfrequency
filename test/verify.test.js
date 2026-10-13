import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.js';
import { gate, numbersIn, verifyFact, tokenOf } from '../src/verify/claims.js';
import { renderPost } from '../src/render/render.js';
import { tempHome } from './helpers.js';
import { loadPack } from '../src/packs/load.js';
import path from 'node:path';

// HARD RULE 3: every fact on a slide traces to an approved source, checked in
// code before rendering. An unsourced fact must fail.

function setup() {
  const db = new Db(':memory:');
  const at = new Date().toISOString();
  db.insert('accounts', { id: 'demo', display_name: 'd', handle: 'd', created_at: at, updated_at: at });
  db.insert('accounts', { id: 'other', display_name: 'o', handle: 'o', created_at: at, updated_at: at });
  const src = db.insert('sources', { account_id: 'demo', key: 's', type: 'web', url: 'https://www.example.com/', name: 'Example', status: 'approved', origin: 'pack', created_at: at });
  const pending = db.insert('sources', { account_id: 'demo', key: 'p', type: 'web', url: 'https://www.example.com/p', name: 'Pending', status: 'pending', origin: 'discovered', created_at: at });
  const foreign = db.insert('sources', { account_id: 'other', key: 'f', type: 'web', url: 'https://www.example.net/', name: 'Foreign', status: 'approved', origin: 'pack', created_at: at });
  const text = 'Basil needs at least 6 hours of direct sunlight a day. With less light, the stems stretch.\nUse a pot at least 20 cm wide with drainage holes.';
  const doc = (source_id, sha) => db.insert('documents', { source_id, url: 'https://www.example.com/basil', text, sha256: sha, fetched_at: at });
  return { db, doc: doc(src, 'a'), pendingDoc: doc(pending, 'b'), foreignDoc: doc(foreign, 'c') };
}

test('a fact whose quote is in the stored document, from an approved source, passes', () => {
  const { db, doc } = setup();
  const r = verifyFact(db, { claim: 'בזיליקום צריך 6 שעות שמש', quote: 'Basil needs at least 6 hours of direct sunlight a day.', document_id: doc }, { accountId: 'demo' });
  assert.deepEqual(r, { ok: true, error: null });
});

test('an unsourced fact fails', () => {
  const { db } = setup();
  assert.equal(verifyFact(db, { claim: 'x', quote: 'Basil needs at least 6 hours', document_id: null }, { accountId: 'demo' }).ok, false);
  assert.match(verifyFact(db, { claim: 'x', quote: 'Basil needs at least 6 hours', document_id: 999 }, { accountId: 'demo' }).error, /not stored/);
});

test('a paraphrased quote fails: it must be in the document word for word', () => {
  const { db, doc } = setup();
  const r = verifyFact(db, { claim: 'x', quote: 'Basil wants six or more hours of direct sun every day', document_id: doc }, { accountId: 'demo' });
  assert.equal(r.ok, false);
  assert.match(r.error, /not in the source document/);
});

test('a source that is not approved, or belongs to another account, vouches for nothing', () => {
  const { db, pendingDoc, foreignDoc } = setup();
  const q = 'Basil needs at least 6 hours of direct sunlight a day.';
  assert.match(verifyFact(db, { claim: 'x', quote: q, document_id: pendingDoc }, { accountId: 'demo' }).error, /not approved/);
  assert.match(verifyFact(db, { claim: 'x', quote: q, document_id: foreignDoc }, { accountId: 'demo' }).error, /another account/);
});

test('an invented number fails: every number in the claim must be in the quote', () => {
  const { db, doc } = setup();
  const r = verifyFact(db, { claim: 'בזיליקום צריך 8 שעות שמש', quote: 'Basil needs at least 6 hours of direct sunlight a day.', document_id: doc }, { accountId: 'demo' });
  assert.match(r.error, /states 8/);
});

test('a quote too long to be a short fact fails (copyright: short facts only)', () => {
  const { db, doc } = setup();
  const q = 'Basil needs at least 6 hours of direct sunlight a day. With less light, the stems stretch.';
  assert.match(verifyFact(db, { claim: 'x', quote: q, document_id: doc }, { accountId: 'demo', maxQuoteWords: 8 }).error, /more than 8/);
});

test('numbers are compared as numbers: "1,000" is 1000', () => {
  assert.deepEqual([...numbersIn('עלה ל-1,000 ₪ ואז 2.5%')], ['1000', '2.5']);
});

test('the gate refuses a slide with no fact, an unverified fact, or a number its facts do not hold', () => {
  const facts = [
    { key: 'f1', quote: 'Basil needs at least 6 hours of direct sunlight a day.', verified: true },
    { key: 'f2', quote: 'something else entirely here', verified: false, error: 'not in the source' },
  ];
  const cover = { kind: 'cover', title: '', body: '', factKeys: [] };
  const ok = gate({ hook: '2 דברים', slides: [cover, { kind: 'item', title: '6 שעות שמש', body: '', factKeys: ['f1'] }, { kind: 'item', title: 'ועוד', body: '', factKeys: ['f1'] }], facts });
  assert.equal(ok.ok, true, ok.problems.join('; '));
  const none = gate({ slides: [cover, { kind: 'item', title: 'טענה', body: 'בלי מקור', factKeys: [] }], facts });
  assert.match(none.problems.join(), /states no sourced fact/);
  const bad = gate({ slides: [cover, { kind: 'item', title: 'טענה', body: '', factKeys: ['f2'] }], facts });
  assert.match(bad.problems.join(), /failed verification/);
  const num = gate({ slides: [cover, { kind: 'item', title: '8 שעות שמש', body: '', factKeys: ['f1'] }], facts });
  assert.match(num.problems.join(), /number 8/);
  const capt = gate({ slides: [cover, { kind: 'item', title: '6 שעות', body: '', factKeys: ['f1'] }], facts, caption: 'מעל 90% מצליחים' });
  assert.match(capt.problems.join(), /caption: the number 90/);
});

test('the renderer refuses text that did not pass the gate', async () => {
  const { home, cleanup } = tempHome();
  try {
    const pack = loadPack(path.join(home, 'packs', 'demo'));
    const slides = [{ kind: 'cover', title: '', body: '', factKeys: [] }];
    const post = { id: 'x', hook: 'שלום', sub: '', caption: '' };
    await assert.rejects(renderPost({ pack, post: { ...post, token: 'forged' }, slides, outDir: home }), /not checked by the fact gate/);
    await assert.rejects(renderPost({ pack, post: { ...post, token: tokenOf({ slides, caption: '', hook: 'אחר', sub: '' }) }, slides, outDir: home }), /not checked/);
  } finally {
    cleanup();
  }
});
