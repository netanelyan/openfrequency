import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { parseCsv, parseRows } from '../src/sources/csv.js';
import { changesOf, linesOf, liveSources, refreshSource, wikiSections } from '../src/sources/index.js';
import { factDocuments, factProblems, factState, removeFact, saveFact } from '../src/sources/facts.js';
import { focusText } from '../src/sources/text.js';
import { verifyFact } from '../src/verify/claims.js';
import { setNow } from '../src/core/clock.js';

// The money pack's official sources: CSV from the Bank of Israel, CKAN from
// data.gov.il, and the facts the owner checked by hand, which expire.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setNow(null);
});

test('CSV: quotes, a quoted comma and line break, "" inside quotes, a BOM, CRLF, and the delimiter sniffed', () => {
  const text = '﻿name,value,note\r\n"מחיר, כולל מע""מ",5.87,"שורה\nשנייה"\r\nחלב,7.35,\r\n';
  assert.deepEqual(parseRows(text), [['name', 'value', 'note'], ['מחיר, כולל מע"מ', '5.87', 'שורה\nשנייה'], ['חלב', '7.35', '']]);
  assert.deepEqual(parseCsv('a;b\n1;2\n'), [{ a: '1', b: '2' }]);
  assert.deepEqual(parseCsv('a\tb\n1\t2\n'), [{ a: '1', b: '2' }]);
});

test('a rate published daily is read as the days it changed, and the current value is always there', () => {
  const rows = ['4.5', '4.5', '4.25', '4.25', '4.25', '4', '4'].map((v, i) => ({ TIME_PERIOD: `2026-0${i + 1}-01`, OBS_VALUE: v }));
  assert.deepEqual(changesOf(rows, 'OBS_VALUE').map((r) => r.TIME_PERIOD), ['2026-01-01', '2026-03-01', '2026-06-01', '2026-07-01']);
  const two = [{ s: 'USD', v: '3' }, { s: 'EUR', v: '4' }, { s: 'USD', v: '3' }, { s: 'EUR', v: '4.1' }];
  assert.deepEqual(changesOf(two, 'v', 's'), [two[0], two[1], two[2], two[3]], 'per series');
  assert.deepEqual(linesOf([{ OBS_VALUE: '3.25', TIME_PERIOD: '2026-09-03' }], { fields: ['TIME_PERIOD', 'OBS_VALUE'], labels: { OBS_VALUE: 'ריבית בנק ישראל באחוזים' } }), ['TIME_PERIOD: 2026-09-03 | ריבית בנק ישראל באחוזים: 3.25']);
});

test('the Bank of Israel series and a data.gov.il datastore are read through the door, as lines that can be quoted', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    const u = new URL(url);
    if (u.hostname === 'edge.boi.gov.il') return new Response('SERIES_CODE,TIME_PERIOD,OBS_VALUE\nMNT_RIB_BOI_D,2026-09-02,3.5\nMNT_RIB_BOI_D,2026-09-03,3.25\nMNT_RIB_BOI_D,2026-10-13,3.25\n', { status: 200, headers: { 'content-type': 'text/csv' } });
    if (u.hostname === 'data.gov.il') return Response.json({ success: true, result: { records: [{ _id: 1, product: 'גבינה לבנה 5%', price: '5.87' }] } });
    return new Response('no', { status: 404 });
  };
  const live = liveSources();
  const [boi] = await live.read({ type: 'api', url: 'https://www.boi.org.il/', name: 'בנק ישראל', config_json: JSON.stringify({ api: { kind: 'csv', url: 'https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BR/1.0/MNT_RIB_BOI_D?format=csv', changesOnly: 'OBS_VALUE', fields: ['TIME_PERIOD', 'OBS_VALUE'], labels: { TIME_PERIOD: 'בתוקף מתאריך', OBS_VALUE: 'ריבית בנק ישראל באחוזים' } } }) });
  assert.equal(boi.text, 'בתוקף מתאריך: 2026-09-02 | ריבית בנק ישראל באחוזים: 3.5\nבתוקף מתאריך: 2026-09-03 | ריבית בנק ישראל באחוזים: 3.25\nבתוקף מתאריך: 2026-10-13 | ריבית בנק ישראל באחוזים: 3.25');
  const [gov] = await live.read({ type: 'api', url: 'https://data.gov.il/dataset/x', name: 'x', config_json: JSON.stringify({ api: { kind: 'ckan', resource: 'abc', limit: 5, fields: ['product', 'price'] } }) });
  assert.equal(gov.text, 'product: גבינה לבנה 5% | price: 5.87');
  assert.match(seen[1], /^https:\/\/data\.gov\.il\/api\/3\/action\/datastore_search\?resource_id=abc&limit=5/);
});

test('a page\'s menus are not sent to the model, and every line that is sent is a line of the stored page', () => {
  const page = ['ראשי', 'אודות', 'צור קשר', 'שירותים', 'סכום הקצבה', 'סכום דמי האבטלה לחודש מחושב כך: הסכום ליום כפול מספר הימים.', 'הדפס', 'שתף', 'סכום דמי האבטלה לחודש מחושב כך: הסכום ליום כפול מספר הימים.'].join('\n');
  const sent = focusText(page);
  // A short heading right under a menu reads as part of it and goes too; the content stays, once.
  assert.equal(sent, 'סכום דמי האבטלה לחודש מחושב כך: הסכום ליום כפול מספר הימים.');
  for (const line of sent.split('\n')) assert.ok(page.includes(line));
});

test('hand-checked facts: checked before they are kept, one document per topic, and an expired fact is evidence for nothing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'of-facts-'));
  try {
    const good = { quote: 'סכום המענק - 1,204 ש"ח (החל ב- 01.01.2026) לכל ילד.', source: 'ביטוח לאומי', url: 'https://www.btl.gov.il/x', checkedAt: '2026-10-13', expires: '2026-12-31' };
    assert.deepEqual(factProblems(good), []);
    assert.ok(factProblems({ ...good, quote: 'קצר מדי' }).length);
    assert.ok(factProblems({ ...good, quote: 'סכום המענק הוא ... לכל ילד בכל שנה' }).some((p) => /שלוש נקודות/.test(p)));
    assert.ok(factProblems({ ...good, url: 'http://x' }).length);
    assert.ok(factProblems({ ...good, expires: '2029-01-01' }).some((p) => /שנתיים/.test(p)), 'a fact is checked again at least every two years');
    saveFact(dir, 'מענק לימודים', { ...good, id: 'a' });
    saveFact(dir, 'מענק לימודים', { ...good, id: 'b', quote: 'המענק משולם לזכאים במהלך חודש אוגוסט בכל שנה.', expires: '2026-10-20' });
    setNow('2026-10-14T09:00:00Z');
    let [doc] = factDocuments(dir);
    assert.equal(doc.expiresAt, '2026-10-20', 'the document expires with its earliest fact');
    assert.match(doc.text, /1,204/);
    assert.equal(factState({ expires: '2026-10-20' }), 'soon');

    // Stored, a fact quoted from it verifies; after its expiry the same fact does not.
    const db = new Db(':memory:');
    db.insert('accounts', { id: 'acct', display_name: 'm', handle: 'm', created_at: 'x', updated_at: 'x' });
    const sid = db.insert('sources', { account_id: 'acct', key: 'facts', type: 'api', url: 'https://www.btl.gov.il/', name: 'עובדות שנבדקו ביד', status: 'approved', origin: 'pack', created_at: 'x' });
    const did = db.insert('documents', { source_id: sid, url: doc.url, text: doc.text, sha256: 'h', fetched_at: 'x', expires_at: doc.expiresAt });
    const fact = { claim: 'מענק לימודים הוא 1,204 ש"ח לכל ילד', quote: good.quote, document_id: did };
    assert.equal(verifyFact(db, fact, { accountId: 'acct' }).ok, true);
    setNow('2026-10-21T09:00:00Z');
    assert.match(verifyFact(db, fact, { accountId: 'acct' }).error, /expired on 2026-10-20/);
    // And the folder now yields a document without the expired fact.
    [doc] = factDocuments(dir);
    assert.ok(!/אוגוסט/.test(doc.text) && doc.expiresAt === '2026-12-31');
    removeFact(dir, 'מענק לימודים', 'a');
    assert.deepEqual(factDocuments(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stored document keeps its expiry, so the gate can refuse it later', async () => {
  const db = new Db(':memory:');
  db.insert('accounts', { id: 'acct', display_name: 'm', handle: 'm', created_at: 'x', updated_at: 'x' });
  const id = db.insert('sources', { account_id: 'acct', key: 'facts', type: 'api', url: 'https://www.btl.gov.il/', name: 'f', status: 'approved', origin: 'pack', created_at: 'x' });
  const src = db.get('SELECT * FROM sources WHERE id = ?', id);
  const impl = { kind: 'live', read: async () => [{ url: 'https://www.btl.gov.il/x', title: 't', text: 'x'.repeat(100), expiresAt: '2026-12-31' }] };
  const [row] = await refreshSource(db, impl, src);
  assert.equal(row.expires_at, '2026-12-31');
});

test("a long article can keep its lead and a section far below it, as a fighter's record past the cut", () => {
  const text = ['Lead line one.', 'Lead line two.', '== Career ==', 'x'.repeat(50), '== Championships and accomplishments ==', '=== Mixed martial arts ===', 'Ten successful title defenses', '== References ==', 'r'].join('\n');
  const out = wikiSections(text, ['intro', 'Championships and accomplishments']);
  assert.ok(out.startsWith('Lead line one.\nLead line two.'));
  assert.ok(out.includes('Ten successful title defenses') && out.includes('Mixed martial arts'));
  assert.ok(!out.includes('xxxx') && !out.includes('References'));
});
