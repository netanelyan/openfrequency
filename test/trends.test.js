import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/index.js';
import { readPack } from '../src/packs/load.js';
import { runTrends, sourceLeak, resolveFormat } from '../src/trends/index.js';
import { DEMO } from './helpers.js';

// Copy formats, never content; numbers only from YouTube itself.

const pack = readPack(DEMO);
pack.id = 'demo';

function db0() {
  const db = new Db(':memory:');
  const at = new Date().toISOString();
  db.insert('accounts', { id: 'demo', display_name: 'd', handle: 'd', created_at: at, updated_at: at });
  return db;
}

test('a format card that repeats the source, or carries a number or a name, is refused', () => {
  const src = { title: 'five houseplants you are killing without knowing', description: '' };
  assert.match(sourceLeak({ hookShape: '{n} צמחים שאתם הורגים', structure: 'houseplants you are killing', why: '' }, src), /repeats the source/);
  assert.match(sourceLeak({ hookShape: '5 צמחים שאתם הורגים', structure: '', why: '' }, src), /number/);
  assert.match(sourceLeak({ hookShape: '{n} צמחים של IKEA', structure: '', why: '' }, src), /Latin word/);
  assert.equal(sourceLeak({ hookShape: '{n} טעויות שהורגות את {x}', structure: 'שער, טעות בכל שקף', why: 'מבטיח לחסוך טעות' }, src), null);
});

test('without a YouTube key nothing is searched and no number is made up', async () => {
  const r = await runTrends({ db: db0(), pack, llm: null }, pack, { yt: null });
  assert.equal(r.found, 0);
  assert.match(r.notes[0], /YOUTUBE_API_KEY/);
});

test('a winner becomes a trial format with YouTube\'s own numbers, mapped to a format the pack can build', async () => {
  const db = db0();
  const yt = {
    search: async () => [
      { id: 'a1', url: 'https://www.youtube.com/shorts/a1', title: 'houseplant mistakes', description: '', thumb: 'https://i.ytimg.com/vi/a1/hq.jpg', publishedAt: '2026-10-01T00:00:00Z' },
      { id: 'a2', url: 'https://www.youtube.com/shorts/a2', title: 'tiny views', description: '', thumb: null },
    ],
    stats: async () => new Map([['a1', { views: 250000, likes: 9000, comments: 120 }], ['a2', { views: 40, likes: 1, comments: 0 }]]),
  };
  const llm = { kind: 'claude', json: async () => ({ data: { reusable: true, format: 'mistakes', hookShape: '{n} טעויות שגורמות ל{x} לנבול', structure: 'שער, טעות בכל שקף, סיכום', why: 'מבטיח לחסוך טעות יקרה' }, usage: { input_tokens: 1500, output_tokens: 200 }, model: 'claude-opus-5-5' }) };
  const r = await runTrends({ db, pack, llm }, pack, { yt, bytes: async () => ({ buf: Buffer.from('x'), type: 'image/jpeg' }) });
  assert.equal(r.found, 1, 'the one under the view floor is not a winner');
  assert.equal(r.kept, 1);
  const row = db.get('SELECT * FROM trend_formats');
  assert.equal(row.views, 250000);
  const f = resolveFormat(db, pack, db.get("SELECT format_key FROM formats WHERE format_key LIKE 'trend:%'").format_key);
  assert.equal(f.base, 'mistakes');
  assert.deepEqual(f.hooks, ['{n} טעויות שגורמות ל{x} לנבול']);
  assert.equal(db.get("SELECT kind FROM formats WHERE format_key LIKE 'trend:%'").kind, 'trial');
});
