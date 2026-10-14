import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tempHome } from './helpers.js';
import { bankDocs, liveSources, plainValue } from '../src/sources/index.js';
import { poolFor } from '../src/pipeline/build.js';
import { hnDocs } from '../src/sources/research.js';

// Where a post's documents come from: the format's own sources, the topic bank,
// one Hacker News post per document, through the network door (stubbed here).

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const cand = (key, sourceKey, id) => ({ key, docs: [{ id, sourceKey, text: 'x' }] });

test('a format that names its sources draws from them only, in the order it names them', () => {
  const all = [cand('a', 'tables', 1), cand('b', 'articles', 2), cand('c', 'articles-he', 3), cand('d', 'articles', 4)];
  assert.deepEqual(poolFor({ kind: 'story', sources: ['articles', 'articles-he'] }, all, '2026-10-14').map((c) => c.key), ['b', 'd', 'c']);
  assert.equal(poolFor({ kind: 'story' }, all, '2026-10-14').length, 4, 'a format that names none draws from all');
});

test('a topic from the bank goes only to a format of its kind', () => {
  const all = [cand('bank:story:aa', 'topic-bank', 1), cand('bank:meme:bb', 'topic-bank', 2), cand('x', 'articles', 3)];
  assert.deepEqual(poolFor({ kind: 'story' }, all, '2026-10-14').map((c) => c.key), ['bank:story:aa', 'x']);
  assert.deepEqual(poolFor({ kind: 'meme', sources: ['topic-bank'] }, all, '2026-10-14').map((c) => c.key), ['bank:meme:bb']);
});

test('HTML inside a JSON field is read as the words it shows', () => {
  assert.equal(plainValue('It&#x27;s <i>finally</i> here.<p>We got 100 users'), "It's finally here. We got 100 users");
  assert.equal(plainValue('plain text, 3 < 4'), 'plain text, 3 < 4');
  assert.equal(plainValue(null), '');
});

test('a JSON source can be one document per record, each with its own address', async () => {
  globalThis.fetch = async () => Response.json({ hits: [{ objectID: '42', title: 'Show HN: A tool', story_text: 'We got &quot;100&quot; users', points: 120, created_at: '2025-03-01T10:00:00Z' }, { objectID: '43', title: 'Show HN: Another', story_text: '', points: 60, created_at: '2025-04-01T10:00:00Z' }] });
  const docs = await liveSources().read({ type: 'api', url: 'https://hn.algolia.com/', name: 'HN', config_json: JSON.stringify({ api: { kind: 'json', url: 'https://hn.algolia.com/api/v1/search?tags=show_hn', path: 'hits', fields: ['title', 'story_text', 'points'], each: { url: 'https://news.ycombinator.com/item?id={objectID}', title: 'title', date: 'created_at' } } }) });
  assert.equal(docs.length, 2);
  assert.equal(docs[0].url, 'https://news.ycombinator.com/item?id=42');
  assert.equal(docs[0].title, 'Show HN: A tool');
  assert.match(docs[0].text, /story_text: We got "100" users/);
  assert.equal(docs[0].publishedAt, '2025-03-01T10:00:00Z');
});

test('the topic bank reads each topic as one group, Hacker News through its API and never as a page', async () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, 'packs', 'demo'), { recursive: true });
    writeFileSync(path.join(home, 'packs', 'demo', 'topics.json'), JSON.stringify([
      { topic: 'A tool from Show HN', kind: 'story', about: 'x', urls: ['https://news.ycombinator.com/item?id=42', 'https://hn.algolia.com/api/v1/search?tags=story,story_42', 'https://www.example.com/docs/pricing.md'] },
    ]));
    const seen = [];
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      const u = new URL(url);
      if (u.hostname === 'hn.algolia.com') return Response.json({ title: 'Show HN: A tool', text: 'We launched &amp; got 100 users', points: 120, created_at: '2025-03-01T10:00:00Z' });
      if (u.hostname === 'www.example.com') return new Response('# Pricing\n\nPro costs $20 per month.', { status: 200, headers: { 'content-type': 'text/markdown' } });
      return new Response('no', { status: 404 });
    };
    const docs = await bankDocs({ account_id: 'demo', key: 'topic-bank' }, { kind: 'bank' });
    assert.equal(docs.length, 2, 'the HN post once, though the bank names it twice');
    assert.ok(docs.every((d) => d.group === docs[0].group && d.group.startsWith('bank:story:')));
    assert.equal(docs[0].url, 'https://news.ycombinator.com/item?id=42');
    assert.match(docs[0].text, /We launched & got 100 users/);
    assert.match(docs[1].text, /Pro costs \$20 per month/);
    assert.ok(!seen.some((u) => u.includes('news.ycombinator.com')), 'never fetched as a page');
  } finally {
    cleanup();
  }
});

test('research finds Show HN posts through the API, in the founder\'s own words', async () => {
  globalThis.fetch = async () => Response.json({ hits: [{ objectID: '7', title: 'Show HN: X', story_text: '<p>First 100 users came from one post', points: 300, num_comments: 80, created_at: '2024-01-02T00:00:00Z' }] });
  const [d] = await hnDocs('X');
  assert.equal(d.url, 'https://news.ycombinator.com/item?id=7');
  assert.match(d.text, /First 100 users came from one post/);
  assert.match(d.text, /points: 300/);
});

test('a source read in the last six hours, for the same day, is not read again', async () => {
  const { Db } = await import('../src/db/index.js');
  const { loadAll } = await import('../src/packs/load.js');
  const { makeContext } = await import('../src/engine.js');
  const { candidateDocs } = await import('../src/pipeline/build.js');
  const { setNow } = await import('../src/core/clock.js');
  const { opened } = await import('./helpers.js');
  const { home, cleanup } = tempHome();
  try {
    let reads = 0;
    // Every source answers, so each is read once: a source whose read failed is tried again next time, as it should be.
    globalThis.fetch = async (url) => (reads++, String(url).includes('api.example.net') ? Response.json([{ month: 'January', rain: 120 }]) : String(url).endsWith('.xml') ? new Response(`<rss><channel><item><title>Balcony herbs</title><link>https://www.example.org/a</link><description>${'Herbs on a balcony need sun and water every few days in summer. '.repeat(20)}</description></item></channel></rss>`, { status: 200, headers: { 'content-type': 'application/rss+xml' } }) : new Response(`<html><head><title>Page</title></head><body><main><p>${'A paragraph about plants and their care, long enough to keep. '.repeat(4)}</p></main></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } }));
    const db = new Db(path.join(home, 'cache.db'));
    opened.push(db);
    const ctx = makeContext({ db, mode: 'live', packs: loadAll({ dir: path.join(home, 'packs') }), log: () => {} });
    const pack = ctx.pack('demo');
    const pctx = { ...ctx, pack, sources: ctx.sourcesFor(pack) };
    const t0 = Date.parse('2026-10-14T08:00:00Z');
    setNow(t0);
    const first = await candidateDocs(pctx, pack, { day: '2026-10-14' });
    const after = reads;
    assert.ok(after > 0 && first.length > 0);
    setNow(t0 + 3 * 3600_000);
    const again = await candidateDocs(pctx, pack, { day: '2026-10-14' });
    assert.equal(reads, after, 'nothing read again within six hours');
    assert.equal(again.length, first.length);
    setNow(t0 + 7 * 3600_000);
    await candidateDocs(pctx, pack, { day: '2026-10-14' });
    assert.ok(reads > after, 'read again after six hours');
  } finally {
    const { setNow } = await import('../src/core/clock.js');
    setNow(null);
    cleanup();
  }
});

test("a table's rows carry their header, so a row quoted alone says which value is which", async () => {
  const { labelTables } = await import('../src/sources/text.js');
  const { wikiHtmlToText } = await import('../src/sources/index.js');
  const md = 'Prices\n| Model | Batch input | Batch output |\n|---|---|---|\n| Opus | $2 / MTok | $10 / MTok |\n| Odd row |\nAfter.';
  assert.equal(labelTables(md), 'Prices\nModel | Batch input | Batch output\nModel: Opus | Batch input: $2 / MTok | Batch output: $10 / MTok\nOdd row\nAfter.');
  assert.equal(labelTables('no table | here'), 'no table | here');
  assert.match(wikiHtmlToText('<table><tr><th>Year</th><th>Winner</th></tr><tr><td>2005</td><td>Liverpool</td></tr></table>'), /Year: 2005 \| Winner: Liverpool/);
});

test('a pack whose news ages fast takes no topic with an old dated document; an undated page stays', () => {
  const c = (key, published_at) => ({ key, docs: [{ id: 1, sourceKey: 's', text: 'x', published_at }] });
  const all = [c('old', '2023-08-01T00:00:00Z'), c('new', '2026-09-01T00:00:00Z'), c('undated', null)];
  assert.deepEqual(poolFor({ kind: 'story' }, all, '2026-10-14', { maxAgeDays: 240 }).map((x) => x.key), ['new', 'undated']);
  assert.equal(poolFor({ kind: 'story' }, all, '2026-10-14').length, 3, 'without the setting, every topic');
});
