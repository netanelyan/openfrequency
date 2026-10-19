import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.js';
import { findImage } from '../src/images/index.js';

// A search that found no photograph says why, so an account whose posts come out bare can be told (npm run
// images:check): a blocked word in the query, no library ready, or what each candidate was passed over for.

test('a search that finds nothing records why', async () => {
  const db = new Db(':memory:');
  const ctx = { db, mode: 'live', log: () => {} };
  const why = {};
  assert.equal(await findImage(ctx, { pack: { id: 'a', meta: { imagery: { providers: ['pexels'] } }, rules: { imageQueryBlock: ['belt'] } }, query: 'UFC belt ceremony', why }), null);
  assert.deepEqual(why, { 'the query has a blocked word ("belt")': 1 });
  const why2 = {};
  const keyless = { ...process.env };
  delete process.env.PEXELS_API_KEY;
  try {
    assert.equal(await findImage(ctx, { pack: { id: 'a', meta: { imagery: { providers: ['pexels'] } }, rules: {} }, query: 'Islam Makhachev', why: why2 }), null);
  } finally {
    process.env.PEXELS_API_KEY = keyless.PEXELS_API_KEY ?? '';
    if (keyless.PEXELS_API_KEY === undefined) delete process.env.PEXELS_API_KEY;
  }
  assert.deepEqual(why2, { 'no photo library is ready (its key is missing)': 1 });
});
