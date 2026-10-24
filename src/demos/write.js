import { askJson } from '../llm/index.js';
import { HEBREW } from '../pipeline/prompts.js';
import { gate, normalise, numbersIn, MIN_QUOTE_WORDS } from '../verify/claims.js';
import { tellsIn } from '../voice/tells.js';
import { catalogueLines } from './store.js';

// A demo's slideshow, as the store's own account would post it: not an advert for a product, but a post about the
// store's field that people in it stop for, a hook, three slides of content, and a last slide that sends them to the
// store. Two model calls:
//
//   chooseTopic  the store's catalogue in, a topic from its field out: the angle, the Wikipedia articles that hold
//                its facts, the products whose photographs fit it
//   writeDemo    the articles and the store's catalogue in, the slideshow out
//
// Code then checks it as Teder checks every post (HARD RULE 3, src/verify/claims.js): every quote is in the document
// it names, word for word; every number on a slide is in a quote the slide cites; every content slide stands on a
// fact; every line passes the Hebrew tells (src/voice/tells.js). A draft that fails goes back once with its problems.

export const ITEMS = 3;
const MAX_QUOTE_WORDS = 40;
// What fits a slide of style A (src/render/styles/tokens.js) at its smallest size, in characters with the spaces:
// the renderer refuses anything longer, so the writer is held to it first.
export const FIT = { hook: 40, sub: 80, title: 30, body: 130, ctaTitle: 30, ctaBody: 70, caption: 240 };

// ---------------------------------------------------------------- the topic

const TOPIC_SYSTEM = `You choose the topic of one sample slideshow for an online store's TikTok and Instagram account. The store's owner will see it as an example of what the account could post.

It is NOT about a product and NOT an advert. It is about the store's field: something the store's customers care about and would stop scrolling for. A story, how something came to be, how something works, a record, a turning point, a myth and the truth, the most surprising thing about it. Narrow and specific beats broad: "the shirt that made a club's colours" beats "football".

Its facts come from Wikipedia, so name 1 to 3 articles that hold them, each by its exact title, Hebrew Wikipedia first ("he"), English only where Hebrew has no article on it ("en"). Pick articles you are confident exist under that title.

Then pick up to 5 product ids from the catalogue whose photographs fit the topic best: the slides are drawn on them.

niche: the subject in two to five Hebrew words, as it reads after "מצגת על" ("הצהוב של דורטמונד", "קפה טורקי"). angle: one English sentence, what the slideshow tells and in what order.`;

export const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    niche: { type: 'string' },
    angle: { type: 'string' },
    articles: { type: 'array', items: { type: 'object', properties: { lang: { type: 'string', enum: ['he', 'en'] }, title: { type: 'string' } }, required: ['lang', 'title'], additionalProperties: false } },
    products: { type: 'array', items: { type: 'string' } },
  },
  required: ['niche', 'angle', 'articles', 'products'],
  additionalProperties: false,
};

/** The topic for a store's demo: { niche, angle, articles: [{ lang, title }], products: [id] }. `skip`: angles taken. */
export async function chooseTopic(ctx, { store, skip = [] }) {
  const { data } = await askJson({ ...ctx, pack: null, postId: null }, {
    task: 'demo-topic',
    role: 'draft',
    system: [{ text: TOPIC_SYSTEM, cache: '5m' }],
    user: `THE STORE: ${store.name} (${store.domain})${store.collections?.length ? `\nITS CATEGORIES: ${store.collections.slice(0, 30).join(', ')}` : ''}
ITS CATALOGUE (id | title | type | tags):
${catalogueLines(store)}${skip.length ? `\n\nNOT THESE ANGLES, ALREADY USED:\n${skip.map((s) => `- ${s}`).join('\n')}` : ''}`,
    schema: TOPIC_SCHEMA,
    meta: {},
  });
  const articles = (data?.articles || []).filter((a) => ['he', 'en'].includes(a?.lang) && String(a.title || '').trim()).slice(0, 3);
  return { niche: String(data?.niche || '').trim(), angle: String(data?.angle || '').trim(), articles, products: (data?.products || []).map(String).slice(0, 5) };
}

// ---------------------------------------------------------------- the slideshow

const SYSTEM = `You write one Hebrew slideshow for an online store's own TikTok and Instagram account, as a sample for the store's owner. It is about the store's field, on the topic and angle given, from the documents given. It is not an advert: the store comes in only on the last slide.

THE FACTS: every fact is a claim plus a quote copied word for word from one of the documents (name its key), ${MIN_QUOTE_WORDS} to ${MAX_QUOTE_WORDS} words, no ellipsis. Every number in a claim is in its quote. Nothing the documents do not say.

THE SLIDES:
- hook: the cover's line, at most ${FIT.hook} characters. A real hook for someone in this field: a surprise, a question the slides answer, something they did not know they wanted to know. Not the store's name, not a product, no "did you know". sub: one short line under it, at most ${FIT.sub}.
- items: exactly ${ITEMS} content slides, the topic told in order, each one point and each citing the ids of the facts it states (from the articles). title at most ${FIT.title} characters, body one or two short sentences, at most ${FIT.body}.
- every number on a slide (a year, a count, a price) is in a quote that slide cites.
- cta: the last slide, from the topic to the store: why someone who cares about this would want to see what the store has, and where (its domain). It may cite facts from the store's catalogue (key "store"); no number the catalogue does not say. title at most ${FIT.ctaTitle} characters, body at most ${FIT.ctaBody}.
- caption: two or three short sentences, ending with a real question to the reader. No hashtags.
Speak as the store's account to its followers, in the plural (אתם). No exclamation marks, no emoji.

${HEBREW}`;

export const DEMO_SCHEMA = {
  type: 'object',
  properties: {
    facts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, doc: { type: 'string' }, claim: { type: 'string' }, quote: { type: 'string' } }, required: ['id', 'doc', 'claim', 'quote'], additionalProperties: false } },
    hook: { type: 'string' },
    sub: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body', 'facts'], additionalProperties: false } },
    cta: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } }, required: ['title', 'body', 'facts'], additionalProperties: false },
    caption: { type: 'string' },
  },
  required: ['facts', 'hook', 'sub', 'items', 'cta', 'caption'],
  additionalProperties: false,
};

const userOf = ({ store, docs, topic }, problems) => `THE STORE: ${store.name} (${store.domain})
THE TOPIC: ${topic.niche}
THE ANGLE: ${topic.angle}

THE DOCUMENTS (quote only from these, word for word, and name the key):
${docs.map((d) => `[${d.key}] ${d.title} (${d.url})\n"""\n${d.text}\n"""`).join('\n\n')}${problems?.length ? `\n\nYOUR LAST DRAFT FAILED THESE CHECKS. Write it again so that none of them is true:\n${problems.map((p) => `- ${p}`).join('\n')}` : ''}`;

/** One fact against its document. { ok, error }. Pure. */
export function checkFact(doc, fact) {
  const quote = String(fact.quote || '').trim();
  if (!doc) return { ok: false, error: `no document "${fact.doc}"` };
  if (!String(fact.claim || '').trim()) return { ok: false, error: 'no claim' };
  if (!quote) return { ok: false, error: 'no quote' };
  if (/\.\.\.|…/.test(quote)) return { ok: false, error: 'the quote is cut with an ellipsis' };
  const words = normalise(quote).split(' ').filter(Boolean).length;
  if (words < MIN_QUOTE_WORDS) return { ok: false, error: `the quote is ${words} words, too short to be evidence` };
  if (words > MAX_QUOTE_WORDS) return { ok: false, error: `the quote is ${words} words, more than ${MAX_QUOTE_WORDS}` };
  if (!normalise(doc.text).includes(normalise(quote))) return { ok: false, error: `the quote is not in "${doc.key}", word for word` };
  const inQuote = numbersIn(quote, { words: true, hebrew: true });
  const missing = [...numbersIn(fact.claim, { hebrew: true })].filter((x) => !inQuote.has(x));
  if (missing.length) return { ok: false, error: `the claim states ${missing.join(', ')}, which the quote does not` };
  return { ok: true, error: null };
}

/** A draft from the model, as Teder's slides and facts, checked. { post, problems }. Pure. */
export function checkDraft(docs, draft, { domain }) {
  const byKey = new Map(docs.map((d) => [d.key, d]));
  const facts = (draft.facts || []).map((f) => {
    const doc = byKey.get(String(f.doc));
    const r = checkFact(doc, f);
    return { key: String(f.id), doc: String(f.doc || ''), url: doc?.url || null, source: doc?.title || null, claim: String(f.claim || ''), quote: String(f.quote || ''), verified: r.ok, error: r.error };
  });
  const items = (draft.items || []).slice(0, ITEMS);
  const keys = (x) => (x?.facts || []).map(String);
  const slides = [
    { kind: 'cover', role: 'cover', title: '', body: '', factKeys: [] },
    ...items.map((s) => ({ kind: 'item', role: 'item', title: String(s.title || '').trim(), body: String(s.body || '').trim(), factKeys: keys(s) })),
    { kind: 'item', role: 'cta', title: String(draft.cta?.title || '').trim(), body: String(draft.cta?.body || '').trim(), factKeys: keys(draft.cta) },
  ];
  // The last slide's line in the accent colour: the store's address, written by code.
  const extra = { cta: domain };
  const post = { hook: String(draft.hook || '').trim(), sub: String(draft.sub || '').trim(), caption: String(draft.caption || '').trim(), extra, slides, facts };
  const problems = [];
  if (items.length !== ITEMS) problems.push(`there are ${items.length} content slides, not ${ITEMS}`);
  for (const f of facts) if (!f.verified) problems.push(`fact ${f.key}: ${f.error}`);
  for (const s of slides.filter((x) => x.role === 'item')) {
    if (s.factKeys.some((k) => facts.find((f) => f.key === k)?.doc === 'store')) problems.push(`"${s.title}": a content slide stands on the articles, not on the store's catalogue`);
  }
  const g = gate({ slides, facts, caption: post.caption, hook: post.hook, sub: post.sub, extra, factFree: (role) => role === 'cta' });
  problems.push(...g.problems);
  const lines = [['cover', post.hook], ['sub', post.sub], ['captionShort', post.caption], ...slides.slice(1).flatMap((s) => [['slideTitle', s.title], ['slideBody', s.body]])];
  for (const [kind, text] of lines) for (const t of tellsIn(text, { kind })) problems.push(`"${text}": ${t.msg}`);
  const long = (what, text, max) => text.length > max && problems.push(`${what} is ${text.length} characters, more than the ${max} that fit: "${text}"`);
  long('the hook', post.hook, FIT.hook);
  long('the sub', post.sub, FIT.sub);
  long('the caption', post.caption, FIT.caption);
  for (const s of slides.filter((x) => x.role === 'item')) {
    long('a slide title', s.title, FIT.title);
    long('a slide body', s.body, FIT.body);
  }
  const cta = slides.at(-1);
  if (!cta.title || !cta.body) problems.push('the last slide has no title or no line');
  long('the last slide title', cta.title, FIT.ctaTitle);
  long('the last slide body', cta.body, FIT.ctaBody);
  post.token = g.token;
  return { post, problems };
}

/**
 * Write a demo's slideshow: one call, and once more with its problems. { post, problems } (problems empty: ready).
 * `before`: problems found after an earlier draft passed here (the renderer's refusal), for the first call to fix.
 */
export async function writeDemo(ctx, { store, docs, topic, before = [] }) {
  let last = before.length ? { problems: before } : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await askJson({ ...ctx, pack: null, postId: null }, {
      task: 'demo',
      role: 'draft',
      system: [{ text: SYSTEM, cache: '5m' }],
      user: userOf({ store, docs, topic }, last?.problems),
      schema: DEMO_SCHEMA,
      meta: { attempt },
    });
    last = checkDraft(docs, data || {}, { domain: store.domain });
    if (!last.problems.length) return last;
  }
  return last;
}
