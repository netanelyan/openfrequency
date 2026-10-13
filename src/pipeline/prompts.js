import { COMPLIANCE } from '../rules/compliance.js';
import { CONNECTIVES, FILLER, FORMAL } from '../voice/tells.js';
import { focusText } from '../sources/text.js';

// The drafting calls' prompts and schemas, built from the pack.
//
// Prompts are in English (the model follows instructions best there) and ask for
// Hebrew output. Every rule here is also a check in code: the prompt is how the
// model gets it right the first time, the check is how a draft that did not is
// never shown.
//
// THE ORDER IS THE CACHE. A prompt is cached as a prefix, so it is built from
// the most stable part down:
//   1. the pack: who the account is, its voice guide, all its formats, the
//      Hebrew rules and the law. The same for every call about this account
//      (outline, slides, rewrite), so they share one cached prefix.
//   2. the task's instructions: the same for every outline, or every slides call.
//   3. the user turn: the format of this post, its documents or facts.
// Nothing that changes per post (a date, a count, a format name) goes above the
// user turn.

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    usable: { type: 'boolean' },
    why: { type: 'string' },
    topic: { type: 'string' },
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
        properties: { point: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } },
        required: ['point', 'facts'],
        additionalProperties: false,
      },
    },
    imageQuery: { type: 'string' },
  },
  required: ['usable', 'why', 'topic', 'facts', 'items', 'imageQuery'],
  additionalProperties: false,
};

export const SLIDES_SCHEMA = {
  type: 'object',
  properties: {
    hook: { type: 'string' },
    sub: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } } },
        required: ['title', 'body', 'facts'],
        additionalProperties: false,
      },
    },
    caption: { type: 'string' },
    question: { type: 'string' },
  },
  required: ['hook', 'sub', 'slides', 'caption', 'question'],
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

/**
 * Block 1: the pack. Stable for every call about this account. `ttl` is the
 * cache duration: '1h' for batches (their rounds can be more than five minutes
 * apart), '5m' for direct calls.
 */
export function packBlock(pack, { ttl = '5m' } = {}) {
  const banned = [...CONNECTIVES, ...FORMAL, ...FILLER].map((t) => t.p).concat(pack.rules.bannedPhrases || []);
  const formats = pack.formats.formats
    .map((f) => `- ${f.id}: "${f.name}". ${f.about || ''} ${f.items[0]} to ${f.items[1]} content slides. Cover lines that fit (patterns to adapt, never to copy word for word): ${f.hooks.join(' / ')}`)
    .join('\n');
  return {
    cache: ttl,
    text: `You plan and write Hebrew social slideshow posts for one account, from source documents.

THE ACCOUNT: "${pack.meta.displayName}" (@${pack.meta.handle}). It is about: ${(pack.meta.topics || []).join(', ')}. Its audience: ${pack.meta.audience || 'Hebrew speakers in Israel'}.
${pack.meta.description || ''}

THE ACCOUNT'S VOICE (its own guide, follow it):
${trimVoice(pack.voice)}

ITS FORMATS (every post is one of them; the request names which):
${formats}

The kind of question its captions end with (examples of the tone, not lines to copy): ${(pack.formats.caption?.questions || []).join(' / ')}

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

The request names the post's format, how many content slides it has, and gives the source documents. Decide whether the documents can carry this format honestly, and extract the facts the post will stand on.

Facts:
- A fact is something a slide will state. Each fact has a quote copied character for character from ONE document: its exact words, 8 to {maxQuote} words, no ellipsis, no paraphrase, no translation, no joining two sentences or two lines. Pick quotes that contain every number the claim states, written as digits where the document has digits.
- The claim is the fact in plain spoken Hebrew, as the account would say it. It may translate or simplify the quote; it may never add to it.
- Never state anything the documents do not say. Never add a number that is not in the quote. A date is a number too: a claim that says when something happened or changed needs a quote that contains that date, or it leaves the date out.
- Prefer facts that are practical, specific and new to most people over general statements.

Items: the content slides in order, each { point: what the slide says in a few Hebrew words, facts: the fact ids it states }. Every item states at least one fact.

topic: the post's subject in a few Hebrew words.
imageQuery: 2 to 5 English words for a photograph that would suit the cover without showing a brand, a logo, a person's face or a screen; or "" if none would.

If the documents cannot carry this format with real, specific facts, return usable=false with the reason, and empty facts and items.`,
};

const SLIDES_TASK = {
  cache: '5m',
  text: `TASK: WRITE ONE POST'S TEXT.

The request names the format, the number of content slides, the verified facts and the outline. Write:
- hook: the cover line. 3 to 11 words. A specific promise or a specific problem, said the way a person would say it. A number only if it is the number of content slides or it appears in a fact's quote.
- sub: one short line under the cover line, or "".
- slides: exactly the number of content slides the request gives, in the order of the outline, each { title: up to 60 characters, body: up to 230 characters in one to three short sentences, facts: the ids of the facts it states }. Every number on a slide, dates and years included, must appear in the quotes of the facts it lists.
- caption: one or two short sentences that add something the slides do not say. No hashtags, no links, no "link in bio".
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

/** The outline's user turn: this post's format, then the documents, narrowed to their content. */
export function outlineUser(format, docs, { avoid = [], maxChars = 7000 } = {}) {
  return [
    `FORMAT: ${format.base || format.id} ("${format.name}"), ${format.items[0]} to ${format.items[1]} content slides.${format.trend ? ` ${format.about}` : ''}`,
    ...docs.map((d) => `<document id="${d.ref}" source="${d.sourceName}" url="${d.url}">\n${d.title ? `# ${d.title}\n` : ''}${focusText(d.text, { maxChars })}\n</document>`),
    avoid.length ? `Topics this account posted recently (do not repeat them): ${avoid.join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function slidesPrompt(pack, { ttl = '5m' } = {}) {
  return { system: [packBlock(pack, { ttl }), SLIDES_TASK], schema: SLIDES_SCHEMA };
}

export function slidesUser({ format, n, outline, facts, edits = [], problems = [] }) {
  return [
    `FORMAT: ${format.base || format.id} ("${format.name}"). Write exactly ${n} content slides.`,
    format.trend ? `Cover lines that fit this post: ${format.hooks.join(' / ')}` : '',
    `TOPIC: ${outline.topic}`,
    'FACTS (state only these; cite their ids):',
    ...facts.map((f) => `- ${f.key}: ${f.claim}  [quote: "${f.quote}"]`),
    'OUTLINE:',
    ...outline.items.map((it, i) => `${i + 1}. ${it.point} (facts: ${it.facts.join(', ')})`),
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
    'FACTS THE POST STANDS ON:',
    ...facts.map((f) => `- ${f.claim}`),
    '',
    'FLAGGED TEXTS:',
    ...flagged.map((x) => `[${x.index}] (${x.where}${x.botScore >= 4 ? `, gave away: ${(x.tells || []).join(', ') || 'too polished'}` : ''}${x.factProblem ? `, FACT PROBLEM: ${x.factProblem}` : ''}) ${x.text}`),
  ].join('\n');
}
