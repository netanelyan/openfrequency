import { COMPLIANCE } from '../rules/compliance.js';
import { CONNECTIVES, FILLER, FORMAL } from '../voice/tells.js';
import { focusText } from '../sources/text.js';
import { contentRange, groupOf, hookPatterns, kindName, kindOf, shapesPrompt } from '../formats/kinds.js';

// The drafting calls' prompts and schemas, built from the pack.
//
// Prompts are in English (the model follows instructions best there) and ask for
// Hebrew output. Every rule here is also a check in code: the prompt is how the
// model gets it right the first time, the check is how a draft that did not is
// never shown.
//
// THE ORDER IS THE CACHE. A prompt is cached as a prefix, so it is built from
// the most stable part down:
//   1. the pack: who the account is, its voice guide, all its formats with their
//      cover patterns, the shape of every kind of post it uses, the Hebrew rules
//      and the law. The same for every call about this account (outline,
//      slides, rewrite), so they share one cached prefix.
//   2. the task's instructions: the same for every outline, or every slides call.
//   3. the user turn: this post's format, its cover pattern, its documents or facts.
// Nothing that changes per post (a date, a count, a format name) goes above the
// user turn. The schemas are the same for every kind of post for the same reason.

const SUBJECT = {
  type: 'object',
  properties: { a: { type: 'string' }, b: { type: 'string' }, answer: { type: 'string' }, date: { type: 'string' } },
  required: ['a', 'b', 'answer', 'date'],
  additionalProperties: false,
};

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    usable: { type: 'boolean' },
    why: { type: 'string' },
    topic: { type: 'string' },
    subject: SUBJECT,
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, claim: { type: 'string' }, quote: { type: 'string' }, doc: { type: 'string' } },
        required: ['id', 'claim', 'quote', 'doc'],
        additionalProperties: false,
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { role: { type: 'string' }, point: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } },
        required: ['role', 'point', 'facts'],
        additionalProperties: false,
      },
    },
    imageQuery: { type: 'string' },
  },
  required: ['usable', 'why', 'topic', 'subject', 'facts', 'items', 'imageQuery'],
  additionalProperties: false,
};

export const SLIDES_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string' },
    sub: { type: 'string' },
    hookPattern: { type: 'string' },
    subject: SUBJECT,
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          a: { type: 'string' },
          b: { type: 'string' },
          facts: { type: 'array', items: { type: 'string' } },
        },
        required: ['role', 'title', 'body', 'a', 'b', 'facts'],
        additionalProperties: false,
      },
    },
    caption: { type: 'string' },
    captionShort: { type: 'string' },
    question: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['hook', 'sub', 'hookPattern', 'subject', 'slides', 'caption', 'captionShort', 'question', 'keywords'],
  additionalProperties: false,
};

export const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    rewrites: {
      type: 'array',
      items: { type: 'object', properties: { index: { type: 'integer' }, text: { type: 'string' } }, required: ['index', 'text'], additionalProperties: false },
    },
  },
  required: ['rewrites'],
  additionalProperties: false,
};

const compliance = (pack) =>
  (pack.meta.compliance || [])
    .map((id) => `- ${COMPLIANCE[id].about}. This is law and a code check enforces it: explain how things work, never recommend.`)
    .join('\n');

/** The voice guide with at most `max` example lines under each examples heading. */
export function trimVoice(md, max = 5) {
  let into = false;
  let n = 0;
  return String(md || '')
    .split(/\r?\n/)
    .filter((line) => {
      const h = /^#{2,3}\s*(.+)$/.exec(line);
      if (h) {
        into = /טוב|רע|good|bad/i.test(h[1]);
        n = 0;
        return true;
      }
      if (into && /^\s*[-*]\s+/.test(line)) return ++n <= max;
      return true;
    })
    .join('\n')
    .trim();
}

/** "a story", "an iceberg", "an on-this-day": the kind with its article. */
const aKind = (f) => `${/^[aeio]/.test(kindName(f)) ? 'an' : 'a'} ${kindName(f)}`;

/** One format, as the pack block lists it: its kind, its size and its cover patterns. */
function formatLine(f) {
  const [lo, hi] = contentRange(f);
  const hooks = hookPatterns(f)
    .map((h) => `[${h.id}] ${h.pattern}${h.examples.length ? ` (e.g. ${h.examples.map((x) => `"${x}"`).join(', ')})` : ''}`)
    .join(' / ');
  return `- ${f.id}: "${f.name}", ${aKind(f)} post, ${lo} to ${hi} content slides. ${f.about || ''} Cover patterns (adapt, never copy word for word): ${hooks}`;
}

/**
 * Block 1: the pack. Stable for every call about this account. `ttl` is the
 * cache duration: '1h' for batches (their rounds can be more than five minutes
 * apart), '5m' for direct calls.
 */
export function packBlock(pack, { ttl = '5m' } = {}) {
  const banned = [...CONNECTIVES, ...FORMAL, ...FILLER].map((t) => t.p).concat(pack.rules.bannedPhrases || []);
  const legacy = (pack.formats.formats || []).every((f) => kindName(f) === 'list');
  return {
    cache: ttl,
    text: `You plan and write Hebrew social slideshow posts for one account, from source documents.

THE ACCOUNT: "${pack.meta.displayName}" (@${pack.meta.handle}). It is about: ${(pack.meta.topics || []).join(', ')}. Its audience: ${pack.meta.audience || 'Hebrew speakers in Israel'}.
${pack.meta.description || ''}

THE ACCOUNT'S VOICE (its own guide, follow it):
${trimVoice(pack.voice)}

ITS FORMATS (every post is one of them; the request names which, and which cover pattern to follow):
${(pack.formats.formats || []).map(formatLine).join('\n')}

THE SHAPES (what each kind of post is made of; "role" names a content slide's job):
${shapesPrompt(pack)}

The kind of question its captions end with (examples of the tone, not lines to copy): ${(pack.formats.caption?.questions || []).join(' / ')}
${
  legacy
    ? ''
    : `
EVERY POST:
- 5 to 8 slides with the cover. One idea per slide. The payoff is on the last slide, and the design draws the call to action on it: never write one yourself.
- The cover is one bold claim or one question, narrow and specific, with a famous name in it when there is one. It can tease; it never promises what the post does not deliver.
- Facts in every kind of post come from the documents: a story, a quiz or an opinion holds only facts the quotes support.
- keywords: 3 to 6 words people would search for, shown on the slides: names, the topic, the competition. At least one in Hebrew and one in English letters.
- caption: the TikTok caption, 200 to 600 characters: what the post is about in the words people search for, plus something the slides do not say. captionShort: the Instagram caption, 60 to 200 characters (the design puts the cover line before it). Neither has hashtags, links or a question.
`
}
HEBREW, ALWAYS:
- Spoken, correct Hebrew. Short sentences. Address the audience in the plural (אתם, תנסו, שמרו), never in the singular.
- No exclamation marks, no long dashes, no semicolons, no ellipsis, at most one emoji per slide.
- Never claim to have tried, bought, used, visited or seen anything. The account explains; it does not have experiences.
- Never mention another account, a follower count, views, a badge or "official".
- Never these words: ${banned.join(', ')}.
${compliance(pack)}`,
  };
}

const OUTLINE_TASK = {
  cache: '5m',
  text: `TASK: PLAN ONE POST.

The request names the post's format and its kind, how many content slides it has, and gives the source documents. Decide whether the documents can carry this post honestly, and extract the facts it will stand on.

Facts:
- A fact is something a slide will state. Each fact has a quote copied character for character from ONE document (doc: its id, D1, D2...): its exact words, 4 to {maxQuote} words (8 or more where the document allows), no ellipsis, no paraphrase, no translation, no joining two sentences or two lines. A table row is one line, its cells joined with " | ": quote the row as it is written. Pick quotes that contain every number the claim states, written as digits where the document has digits.
- The claim is the fact in plain spoken Hebrew, as the account would say it. It may translate or simplify the quote; it may never add to it. A term it translates (a weight class, a title, a legal term) takes its own Hebrew name, never a neighbouring one: the slides follow the claim.
- Never state anything the documents do not say. Never add a number that is not in the quote. A date is a number too: a claim that says when something happened or changed needs a quote that contains that date, or it leaves the date out.
- Prefer facts that are specific, surprising and new to most people over general statements.

Items: the content slides in order, each { role, point: what the slide says in a few Hebrew words, facts: the fact ids it states }. The roles follow the kind's shape (THE SHAPES). Every item states at least one fact, except the roles the shape says carry none.

subject: what the kind needs, "" for the rest: a and b (the two sides of a head-to-head; a alone for what-happened), answer (guess-who), date (on-this-day, in Hebrew with the year).
topic: the post's subject in a few Hebrew words.
imageQuery: 2 to 5 English words for a licensed photograph that would suit the post (a famous person or place by name is fine where the account's rules allow it; never a logo, a crest, a badge, a screen, an injury); or "" if none would.

If the documents cannot carry this post with real, specific facts, return usable=false with the reason, and empty facts and items.`,
};

const SLIDES_TASK = {
  cache: '5m',
  text: `TASK: WRITE ONE POST'S TEXT.

The request names the format and its kind, the content slides with their roles, the verified facts, the outline and the cover pattern to follow. Write:
- hook: the cover line. 3 to 11 words, after the cover pattern the request names (adapt it to this post, never copy it word for word). A number only if it is the number of content slides, a top 5 or 10, or it appears in a fact's quote. hookPattern: that pattern's id.
- sub: one short line under the cover line, or "".
- subject: as in the outline (you may shorten a name).
- slides: exactly the outline's content slides, the same roles in the same order, each { role, title: up to 60 characters, body: up to 230 characters in one to three short sentences (or short lines, one per line, where the shape says so), a and b: the two values on a head-to-head stat slide and "" everywhere else, facts: the ids of the facts it states }. Every number on a slide, dates and years included, must appear in the quotes of the facts it lists.
- caption, captionShort, keywords: as the account's rules say. For a legacy list post, captionShort and keywords may be empty.
- question: one short question about this post's own subject that a reader could answer from their own life, or "" when none would sound natural. Never a line that fits any post ("ידעתם את זה?", "מה דעתכם?", "למי זה יכול לעזור?"): those are dropped.`,
};

const REWRITE_TASK = {
  cache: '5m',
  text: `TASK: REWRITE FLAGGED TEXTS.

A reader flagged some texts of a post: as sounding like a bot (and said what gave each away), or as saying more than the post's facts support (a FACT PROBLEM). Rewrite each flagged text so a person would have written it, in the account's voice: natural spoken Hebrew, plural address, no exclamation marks, no long dashes. Where there is a FACT PROBLEM, say only what the facts support: drop or soften the part that goes beyond them. Keep every fact and every number that is supported; add none; keep about the same length. Return { index, text } for each flagged text you were given, using its index.`,
};

export function outlinePrompt(pack, { ttl = '5m' } = {}) {
  const maxQ = pack.rules.maxQuoteWords || 40;
  return { system: [packBlock(pack, { ttl }), { ...OUTLINE_TASK, text: OUTLINE_TASK.text.replace('{maxQuote}', maxQ) }], schema: OUTLINE_SCHEMA };
}

/** What the request says about the format: its id, name and kind, and the size of the post. */
function formatHead(format, n = null) {
  const [lo, hi] = contentRange(format);
  return `FORMAT: ${format.base || format.id} ("${format.name}"), ${aKind(format)} post, ${n ? `exactly ${n}` : `${lo} to ${hi}`} content slides.`;
}

/**
 * The outline's user turn: this post's format, then the documents, narrowed to
 * their content. `day` (on-this-day): the date the post goes out on; `subject`:
 * a subject the post must be about (a fight week's main event).
 */
export function outlineUser(format, docs, { avoid = [], maxChars = 7000, day = null, subject = null } = {}) {
  const per = docs.length > 1 ? Math.max(2500, Math.floor(maxChars / docs.length)) : maxChars;
  return [
    `${formatHead(format)}${format.trend ? ` ${format.about}` : ''}`,
    day && kindName(format) === 'on-this-day' ? `THE POST GOES OUT ON: ${day}. Pick a moment that happened on this day and month in an earlier year.` : '',
    subject ? `SUBJECT: ${subject}. The post is about this.` : '',
    ...docs.map((d) => `<document id="${d.ref}" source="${d.sourceName}" url="${d.url}">\n${d.title ? `# ${d.title}\n` : ''}${focusText(d.text, { maxChars: per, numbersFirst: groupOf(format) === 'number' })}\n</document>`),
    avoid.length ? `Topics this account posted recently (do not repeat them): ${avoid.join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function slidesPrompt(pack, { ttl = '5m' } = {}) {
  return { system: [packBlock(pack, { ttl }), SLIDES_TASK], schema: SLIDES_SCHEMA };
}

export function slidesUser({ format, n, outline, facts, edits = [], problems = [], hook = null, cta = null }) {
  const legacy = kindName(format) === 'list';
  return [
    `${formatHead(format, n)}`,
    hook ? `COVER PATTERN: [${hook.id}] ${hook.pattern}${hook.examples?.length ? ` (e.g. ${hook.examples.map((x) => `"${x}"`).join(', ')})` : ''}` : '',
    format.trend ? `Cover lines that fit this post: ${format.hooks.join(' / ')}` : '',
    cta && !legacy ? `The design ends the last slide with this call to action, so the slides do not say it: "${cta.text}"` : '',
    `TOPIC: ${outline.topic}`,
    !legacy && outline.subject ? `SUBJECT: ${Object.entries(outline.subject).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ') || '(none)'}` : '',
    'FACTS (state only these; cite their ids):',
    ...facts.map((f) => `- ${f.key}: ${f.claim}  [quote: "${f.quote}"]`),
    'OUTLINE:',
    ...outline.items.map((it, i) => `${i + 1}. ${legacy ? '' : `${it.role || 'item'}: `}${it.point} (facts: ${(it.facts || []).join(', ') || 'none'})`),
    edits.length ? `\nLines the account's owner rewrote by hand recently (write like the AFTER versions):\n${edits.map((e) => `- before: ${e.before}\n  after: ${e.after}`).join('\n')}` : '',
    problems.length ? `\nTHE LAST DRAFT WAS REFUSED BY THE CHECKS. Fix exactly these and keep everything else:\n${problems.map((p) => `- ${p}`).join('\n')}` : '',
  ]
    .filter((x) => x !== '')
    .join('\n');
}

export function rewritePrompt(pack, { ttl = '5m' } = {}) {
  return { system: [packBlock(pack, { ttl }), REWRITE_TASK], schema: REWRITE_SCHEMA };
}

export function rewriteUser({ flagged, facts }) {
  return [
    'FACTS THE POST STANDS ON (each with what the source says):',
    ...facts.map((f) => `- ${f.claim}${f.quote ? ` (source: "${f.quote}")` : ''}`),
    '',
    'FLAGGED TEXTS:',
    ...flagged.map((x) => `[${x.index}] (${x.where}${x.botScore >= 4 ? `, gave away: ${(x.tells || []).join(', ') || 'too polished'}` : ''}${x.factProblem ? `, FACT PROBLEM: ${x.factProblem}` : ''}) ${x.text}`),
  ].join('\n');
}

/** The kind's own instructions, for tests and tools that show one. */
export const kindPrompt = (format) => kindOf(format).prompt;
