import { COMPLIANCE } from '../rules/compliance.js';
import { CONNECTIVES, FILLER, FORMAL } from '../voice/tells.js';

// The two drafting calls' prompts and schemas, built from the pack.
//
// Prompts are in English (the model follows instructions best there) and ask for
// Hebrew output. Every rule here is also a check in code: the prompt is how the
// model gets it right the first time, the check is how a draft that did not is
// never shown. The system prompt is stable per pack and format, so it caches.

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

const account = (pack) =>
  `The account: "${pack.meta.displayName}" (@${pack.meta.handle}). It is about: ${(pack.meta.topics || []).join(', ')}. Its audience: ${pack.meta.audience || 'Hebrew speakers in Israel'}.`;

const compliance = (pack) =>
  (pack.meta.compliance || [])
    .map((id) => `- ${COMPLIANCE[id].about}. This is law and a code check enforces it: explain how things work, never recommend.`)
    .join('\n');

export function outlinePrompt(pack, format) {
  const maxQ = pack.rules.maxQuoteWords || 40;
  return {
    system: `You plan one Hebrew social slideshow from source documents.

${account(pack)}

The format of this post: "${format.name}". ${format.about || ''}
It has ${format.items[0]} to ${format.items[1]} content slides, each stating one point.

Your job: decide whether the documents can carry this format honestly, and extract the facts the post will stand on.

Facts:
- A fact is something a slide will state. Each fact has a quote copied character for character from ONE document: its exact words, 8 to ${maxQ} words, no ellipsis, no paraphrase, no translation, no joining two sentences. Pick quotes that contain every number the claim states, written as digits where the document has digits.
- The claim is the fact in plain spoken Hebrew, as the account would say it. It may translate or simplify the quote; it may never add to it.
- Never state anything the documents do not say. Never add a number that is not in the quote.
- Prefer facts that are practical, specific and new to most people over general statements.
${compliance(pack)}

Items: the content slides in order, each { point: what the slide says in a few Hebrew words, facts: the fact ids it states }. Every item states at least one fact.

topic: the post's subject in a few Hebrew words.
imageQuery: 2 to 5 English words for a photograph that would suit the cover without showing a brand, a logo, a person's face or a screen; or "" if none would.

If the documents cannot carry this format with real, specific facts, return usable=false with the reason, and empty facts and items.`,
    schema: OUTLINE_SCHEMA,
  };
}

export function outlineUser(docs, { avoid = [] } = {}) {
  return [
    ...docs.map((d) => `<document id="${d.ref}" source="${d.sourceName}" url="${d.url}">\n${d.title ? `# ${d.title}\n` : ''}${d.text.slice(0, 12_000)}\n</document>`),
    avoid.length ? `\nTopics this account posted recently (do not repeat them): ${avoid.join(' · ')}` : '',
  ].join('\n\n');
}

export function slidesPrompt(pack, format, { n }) {
  const banned = [...CONNECTIVES, ...FORMAL, ...FILLER].map((t) => t.p).concat(pack.rules.bannedPhrases || []);
  return {
    system: `You write the Hebrew text of one slideshow post.

${account(pack)}

THE ACCOUNT'S VOICE (its own guide, follow it):
${pack.voice}

THE FORMAT: "${format.name}". ${format.about || ''}
Cover lines that fit this format (patterns to adapt, never to copy word for word): ${format.hooks.join(' / ')}

Write:
- hook: the cover line. 3 to 11 words. A specific promise or a specific problem, said the way a person would say it. A number only if it is ${n} (the number of slides) or it appears in a fact's quote.
- sub: one short line under the cover line, or "".
- slides: exactly ${n} content slides in the order of the outline, each { title: up to 60 characters, body: up to 230 characters in one to three short sentences, facts: the ids of the facts it states }. Every number on a slide must appear in the quotes of the facts it lists.
- caption: one or two short sentences that add something the slides do not say. No hashtags, no links, no "link in bio".
- question: one short question to end the caption, close to one of these: ${(pack.formats.caption?.questions || []).join(' / ')}

Hebrew, always:
- Spoken, correct Hebrew. Short sentences. Address the audience in the plural (אתם, תנסו, שמרו), never in the singular.
- No exclamation marks, no long dashes, no semicolons, no ellipsis, at most one emoji per slide.
- Never claim to have tried, bought, used, visited or seen anything. The account explains; it does not have experiences.
- Never mention another account, a follower count, views, a badge or "official".
- Never these words: ${banned.join(', ')}.
${compliance(pack)}`,
    schema: SLIDES_SCHEMA,
  };
}

export function slidesUser({ outline, facts, edits = [], problems = [] }) {
  return [
    `TOPIC: ${outline.topic}`,
    'FACTS (state only these; cite their ids):',
    ...facts.map((f) => `- ${f.key}: ${f.claim}  [quote: "${f.quote}"]`),
    'OUTLINE:',
    ...outline.items.map((it, i) => `${i + 1}. ${it.point} (facts: ${it.facts.join(', ')})`),
    edits.length ? `\nLines the account's owner rewrote by hand recently (write like the AFTER versions):\n${edits.map((e) => `- before: ${e.before}\n  after: ${e.after}`).join('\n')}` : '',
    problems.length ? `\nTHE LAST DRAFT WAS REFUSED BY THE CHECKS. Fix exactly these and keep everything else:\n${problems.map((p) => `- ${p}`).join('\n')}` : '',
  ].join('\n');
}
