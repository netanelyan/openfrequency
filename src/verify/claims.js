import { createHash } from 'node:crypto';
import { now } from '../core/clock.js';
import { israelDate } from '../schedule/israel.js';

// HARD RULE 3: every fact on a slide traces to an approved source, stored with
// the post and checked in code before rendering.
//
// A fact is { claim, quote, document }. It is verified when:
//   1. its document exists, was stored from a source of THIS account, and that
//      source is approved right now (a source removed on the website stops
//      vouching for anything not yet published)
//   2. the quote appears in the stored text of that document, verbatim after
//      normalising whitespace, punctuation and case: a paraphrased quote is the
//      case where the claim came from the model's memory instead of the source
//   3. the quote is long enough to be evidence and short enough to be a short
//      fact rather than a copied paragraph (HARD RULE 5, copyright)
//   4. every number in the claim appears in the quote
//
// Then the gate, before rendering: every content slide states at least one
// verified fact, and every number on any slide, the cover or the caption appears
// in a quote the post cites. "Verified" means traceable: if the source is wrong
// this repeats it faithfully. It never means invented.

/** Normalise for comparison: letters and digits of any script, single-spaced, lowercase. */
export function normalise(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[‘’ʼ׳`]/g, "'")
    .replace(/[“”״]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/[^\p{L}\p{N}%.]+/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000, million: 1e6, billion: 1e9,
};
const ORDINALS = { third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
const WORD_RE = new RegExp(`\\b(${[...Object.keys(WORDS), ...Object.keys(ORDINALS)].join('|')})\\b`, 'gi');

// Hebrew counting words, three and up. One and two (אחד, שני, שתי) are left out on
// purpose: "אחד הצמחים" and "יום שני" are not numbers, and a guard that refuses
// correct Hebrew is a broken guard. Up to two prefix letters are allowed ("ובשלושת").
const HE_NUM = {
  שלוש: 3, שלושה: 3, שלושת: 3, ארבע: 4, ארבעה: 4, ארבעת: 4, חמש: 5, חמישה: 5, חמשת: 5, שש: 6, שישה: 6, ששת: 6,
  שבע: 7, שבעה: 7, שבעת: 7, שמונה: 8, שמונת: 8, תשע: 9, תשעה: 9, תשעת: 9, עשר: 10, עשרה: 10, עשרת: 10,
  עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70, שמונים: 80, תשעים: 90,
};
const HE_RE = new RegExp(`(?<![\\p{L}])[ובלהמש]{0,2}(${Object.keys(HE_NUM).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}])`, 'gu');

/**
 * The numbers a text states, normalised: "1,000" and "1000" are the same number.
 * words: also English number words and ordinals ("five", "fourteenth"), for quotes.
 * hebrew: also Hebrew counting words ("חמש", "שלושה"), for slide text.
 */
export function numbersIn(text, { words = false, hebrew = false } = {}) {
  const s = String(text || '');
  const out = new Set();
  for (const m of s.matchAll(/\d+(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.add(String(n));
  }
  if (words) for (const m of s.matchAll(WORD_RE)) out.add(String(WORDS[m[1].toLowerCase()] ?? ORDINALS[m[1].toLowerCase()]));
  // "באר שבע" is a city, not the number seven.
  if (hebrew) for (const m of s.matchAll(HE_RE)) if (!(m[1] === 'שבע' && /באר\s*$/.test(s.slice(0, m.index)))) out.add(String(HE_NUM[m[1]]));
  return out;
}

const wordCount = (s) => normalise(s).split(' ').filter(Boolean).length;

export const MIN_QUOTE_WORDS = 4;

/**
 * Verify one fact against the database. Returns { ok, error }.
 * fact: { claim, quote, document_id }; account: the account id; opts.maxQuoteWords from rules.json.
 */
export function verifyFact(db, fact, { accountId, maxQuoteWords = 40 } = {}) {
  const fail = (error) => ({ ok: false, error });
  if (!fact?.document_id) return fail('no source document');
  const doc = db.get(
    `SELECT d.text, d.url, d.expires_at, s.account_id, s.status, s.name FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?`,
    fact.document_id
  );
  if (!doc) return fail('the source document is not stored');
  if (doc.account_id !== accountId) return fail(`the source belongs to another account (${doc.account_id})`);
  if (doc.status !== 'approved') return fail(`the source "${doc.name}" is not approved (${doc.status})`);
  // Hand-checked facts stop being evidence on their expiry date, until checked again.
  if (doc.expires_at && israelDate(now()) > doc.expires_at) return fail(`a hand-checked fact here expired on ${doc.expires_at}: check it again on the website`);
  const quote = String(fact.quote || '').trim();
  if (!quote) return fail('no quote');
  if (/\.\.\.|…/.test(quote)) return fail('the quote is cut with an ellipsis');
  const n = wordCount(quote);
  if (n < MIN_QUOTE_WORDS) return fail(`the quote is ${n} words, too short to be evidence of anything`);
  if (n > maxQuoteWords) return fail(`the quote is ${n} words, more than ${maxQuoteWords}: a short fact, not a copied passage`);
  if (!normalise(doc.text).includes(normalise(quote))) return fail('the quote is not in the source document, word for word');
  const inQuote = numbersIn(quote, { words: true, hebrew: true });
  const missing = [...numbersIn(fact.claim, { hebrew: true })].filter((x) => !inQuote.has(x));
  if (missing.length) return fail(`the claim states ${missing.join(', ')}, which the quote does not`);
  if (!String(fact.claim || '').trim()) return fail('no claim');
  return { ok: true, error: null };
}

/**
 * The gate before rendering. slides: [{ kind, title, body, factKeys }]; facts:
 * [{ key, quote, verified }]; caption: string. Returns { ok, problems, token }.
 *
 * `token` is a hash of exactly what was checked. The renderer refuses a post
 * whose text no longer hashes to its token, so an edit after the check cannot
 * reach a rendered slide without passing the gate again.
 */
export function gate({ slides, facts, caption = '', hook = '', sub = '' }) {
  const problems = [];
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const items = slides.filter((s) => s.kind === 'item');
  const allQuoteNums = new Set(facts.filter((f) => f.verified).flatMap((f) => [...numbersIn(f.quote, { words: true, hebrew: true })]));
  const count = String(items.length);

  items.forEach((s, i) => {
    const where = `slide ${i + 1}`;
    const keys = s.factKeys || [];
    if (!keys.length) problems.push(`${where}: states no sourced fact`);
    const cited = keys.map((k) => byKey.get(k));
    keys.forEach((k, x) => {
      if (!cited[x]) problems.push(`${where}: cites "${k}", which is not one of the post's facts`);
      else if (!cited[x].verified) problems.push(`${where}: cites "${k}", which failed verification (${cited[x].error || 'unverified'})`);
    });
    const nums = new Set(cited.filter((f) => f?.verified).flatMap((f) => [...numbersIn(f.quote, { words: true, hebrew: true })]));
    // A count written in Hebrew words ("חמש") is held to its quotes like one written in digits.
    for (const x of numbersIn(`${s.title} ${s.body}`, { hebrew: true })) if (!nums.has(x)) problems.push(`${where}: the number ${x} is not in the quotes it cites`);
  });
  for (const [where, text] of [
    ['the cover', `${hook} ${sub}`],
    ['the caption', caption],
  ]) {
    for (const x of numbersIn(text)) if (x !== count && !allQuoteNums.has(x)) problems.push(`${where}: the number ${x} is not in any cited quote`);
  }
  const token = tokenOf({ slides, caption, hook, sub });
  return { ok: problems.length === 0, problems, token };
}

/** A hash of exactly the text that was checked. */
export function tokenOf({ slides, caption = '', hook = '', sub = '' }) {
  const body = JSON.stringify({ hook, sub, caption, slides: slides.map((s) => [s.kind, s.title || '', s.body || '', s.factKeys || []]) });
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}
